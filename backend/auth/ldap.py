"""
backend/auth/ldap.py — LDAP / Active Directory operations for Persona.

All functions are SYNCHRONOUS.  FastAPI callers MUST wrap every call in
    await run_in_threadpool(func, *args)
to avoid blocking the async event loop.

Passwords are NEVER logged or included in exception detail strings.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import ldap3
from fastapi import HTTPException
from ldap3 import ALL, BASE, LEVEL, RESTARTABLE, SUBTREE, Connection, Server
from ldap3.utils.conv import escape_filter_chars

from backend.app_config import get_ldap_settings as _load_ldap_settings
from backend.models.schemas import ADUser, LDAPSettings, TestConnectionResponse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Windows FILETIME helpers
# ---------------------------------------------------------------------------

# 100-nanosecond ticks between 1601-01-01 (Windows epoch) and 1970-01-01 (Unix epoch)
_FILETIME_EPOCH_DELTA: int = 116_444_736_000_000_000
# Sentinel value meaning "never expires"
_FILETIME_NEVER: int = 9_223_372_036_854_775_807  # 0x7FFFFFFFFFFFFFFF


def _filetime_to_iso(value: Optional[int]) -> Optional[str]:
    """
    Convert a Windows FILETIME integer to an ISO 8601 UTC string.

    Returns:
        "Never"  — when value equals the sentinel never-expires value.
        None     — when value is 0 (not set) or cannot be parsed.
        ISO str  — for all valid timestamps.
    """
    if value is None:
        return None
    try:
        v = int(value)
    except (TypeError, ValueError):
        return None

    if v == 0:
        return None
    if v == _FILETIME_NEVER:
        return "Never"

    try:
        epoch_seconds = (v - _FILETIME_EPOCH_DELTA) / 10_000_000
        dt = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=epoch_seconds)
        return dt.isoformat()
    except (OSError, OverflowError, ValueError):
        return None


def _decode_account_status(uac: Optional[int], lockout_time_raw: Optional[int]) -> str:
    """
    Determine the human-readable account status.

    Precedence: Locked Out → Disabled → Enabled.
    Lockout is determined by lockoutTime > 0, not the UAC LOCKOUT bit
    (the UAC bit is unreliable across domain functional levels).
    """
    try:
        lt = int(lockout_time_raw) if lockout_time_raw is not None else 0
    except (TypeError, ValueError):
        lt = 0

    if lt > 0:
        return "Locked Out"

    if uac is not None:
        try:
            if int(uac) & 0x0002:  # ACCOUNTDISABLE flag
                return "Disabled"
        except (TypeError, ValueError):
            pass

    return "Enabled"


# ---------------------------------------------------------------------------
# ldap3 attribute extraction helpers
# ---------------------------------------------------------------------------


def _str(entry: ldap3.Entry, attr: str) -> Optional[str]:
    """Safely extract a single string value from an ldap3 Entry attribute."""
    try:
        val = entry[attr].value
        if val is None:
            return None
        if isinstance(val, datetime):
            return val.isoformat()
        return str(val)
    except Exception:
        return None


def _int(entry: ldap3.Entry, attr: str) -> Optional[int]:
    """Safely extract a single integer value from an ldap3 Entry attribute."""
    try:
        val = entry[attr].value
        if val is None:
            return None
        return int(val)
    except Exception:
        return None


def _list(entry: ldap3.Entry, attr: str) -> list[str]:
    """
    Safely extract a multi-valued attribute as a list of strings.

    ldap3 returns a scalar for single values and a list for multiple values,
    so both cases are handled explicitly.
    """
    try:
        val = entry[attr].value
        if val is None:
            return []
        if isinstance(val, list):
            return [str(v) for v in val]
        return [str(val)]
    except Exception:
        return []


def _object_classes(entry: ldap3.Entry) -> list[str]:
    """Return objectClass values as a lowercase list."""
    try:
        return [c.lower() for c in entry["objectClass"].values]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Server factory
# ---------------------------------------------------------------------------


def _make_server(cfg: LDAPSettings) -> Server:
    return Server(cfg.host, port=cfg.port, use_ssl=cfg.use_ssl, get_info=ALL)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def authenticate_user(username: str, password: str) -> dict:
    """
    Authenticate an AD user by sAMAccountName + password.

    Steps:
        1. Bind with the service account.
        2. Resolve the user's full DN from sAMAccountName.
        3. Bind with the resolved DN and the supplied password.
        4. Return a minimal user-info dict on success.

    Raises:
        HTTPException 503 — LDAP not configured, or service account bind fails.
        HTTPException 401 — User not found, or credentials incorrect.
                            Message is intentionally generic — never reveals which.

    Password is NEVER logged.
    Caller MUST use run_in_threadpool.
    """
    ldap_cfg = _load_ldap_settings()
    if ldap_cfg is None:
        raise HTTPException(status_code=503, detail="LDAP not configured")

    server = _make_server(ldap_cfg)

    # Step 1 — bind as service account to resolve the user's DN
    try:
        svc_conn = Connection(
            server,
            user=ldap_cfg.service_account_dn,
            password=ldap_cfg.service_account_password,
            auto_bind=True,
        )
    except Exception:
        logger.warning("Service account bind failed during authenticate_user")
        raise HTTPException(status_code=503, detail="Directory service unavailable")

    # Step 2 — search for the user by sAMAccountName
    safe_username = escape_filter_chars(username)
    search_filter = f"(&(objectClass=user)(sAMAccountName={safe_username}))"

    svc_conn.search(
        search_base=ldap_cfg.base_dn,
        search_filter=search_filter,
        search_scope=SUBTREE,
        attributes=["distinguishedName", "displayName", "sAMAccountName"],
    )

    if not svc_conn.entries:
        svc_conn.unbind()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_dn = svc_conn.entries[0].entry_dn
    display_name = _str(svc_conn.entries[0], "displayName") or username
    svc_conn.unbind()

    # Step 3 — bind as the user to verify the supplied password
    try:
        user_conn = Connection(
            server,
            user=user_dn,
            password=password,
            auto_bind=True,
        )
        user_conn.unbind()
    except Exception:
        # Never log the password or expose why authentication failed
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return {
        "dn": user_dn,
        "sam_account_name": username,
        "display_name": display_name,
    }


def get_service_connection() -> ldap3.Connection:
    """
    Return an active RESTARTABLE connection bound with the service account.

    The RESTARTABLE strategy reconnects automatically if the connection drops,
    which is important for long-running tree traversal sessions.

    Raises:
        HTTPException 503 — LDAP not configured, or bind fails.

    Caller MUST use run_in_threadpool.
    """
    ldap_cfg = _load_ldap_settings()
    if ldap_cfg is None:
        raise HTTPException(status_code=503, detail="LDAP not configured")

    server = _make_server(ldap_cfg)

    try:
        conn = Connection(
            server,
            user=ldap_cfg.service_account_dn,
            password=ldap_cfg.service_account_password,
            client_strategy=RESTARTABLE,
            auto_bind=True,
        )
        return conn
    except Exception:
        logger.warning("Service account bind failed in get_service_connection")
        raise HTTPException(status_code=503, detail="Directory service unavailable")


def test_ldap_connection(settings: LDAPSettings) -> TestConnectionResponse:
    """
    Perform a live LDAP bind using the provided settings and report results.

    Does NOT persist anything — this is a test-only operation.
    Used by the Setup Wizard "Test Connection" button and the Settings page.

    Returns a TestConnectionResponse — never raises.
    Password is NEVER logged.
    Caller MUST use run_in_threadpool.
    """
    server = _make_server(settings)

    try:
        conn = Connection(
            server,
            user=settings.service_account_dn,
            password=settings.service_account_password,
            auto_bind=True,
        )
    except ldap3.core.exceptions.LDAPSocketOpenError:
        return TestConnectionResponse(
            success=False,
            message="Connection refused. Check the host address and port.",
        )
    except ldap3.core.exceptions.LDAPBindError:
        return TestConnectionResponse(
            success=False,
            message="Bind failed. Check the service account DN and password.",
        )
    except ldap3.core.exceptions.LDAPSocketReceiveError:
        return TestConnectionResponse(
            success=False,
            message="Network error. The host did not respond.",
        )
    except Exception as exc:
        # Name only — never include a message that might echo back a password
        return TestConnectionResponse(
            success=False,
            message=f"Connection failed ({type(exc).__name__}). Check settings and try again.",
        )

    # Count objects in the base DN to give meaningful feedback
    try:
        conn.search(
            search_base=settings.base_dn,
            search_filter="(objectClass=*)",
            search_scope=SUBTREE,
            attributes=[],
            size_limit=0,
        )
        count = len(conn.entries)
    except Exception:
        count = 0
    finally:
        conn.unbind()

    return TestConnectionResponse(
        success=True,
        message=f"Connected successfully. Found {count:,} objects.",
    )


def query_tree(dn: str) -> list[dict]:
    """
    Return one level of children for the given DN.

    Each child is a dict:
        { dn, name, type: "ou"|"container"|"user", has_children: bool }

    Sorted: OUs and containers first (alphabetical), then users (alphabetical).
    has_children is always False for user objects (leaves).
    For OUs and containers a quick one-result probe determines has_children.

    Caller MUST use run_in_threadpool.
    """
    conn = get_service_connection()

    # Include OUs, containers, and AD user/person objects.
    # The objectCategory=person filter excludes computer accounts, which also
    # carry objectClass=user in Active Directory.
    tree_filter = (
        "(|"
        "(objectClass=organizationalUnit)"
        "(objectClass=container)"
        "(&(objectClass=user)(objectCategory=person))"
        ")"
    )

    conn.search(
        search_base=dn,
        search_filter=tree_filter,
        search_scope=LEVEL,
        attributes=["objectClass", "name", "distinguishedName"],
    )

    raw_entries = list(conn.entries)  # snapshot before subsequent searches

    results: list[dict] = []
    for entry in raw_entries:
        entry_dn = entry.entry_dn
        classes = _object_classes(entry)
        name = _str(entry, "name") or entry_dn

        if "organizationalunit" in classes:
            node_type = "ou"
        elif "person" in classes or "user" in classes:
            node_type = "user"
        else:
            node_type = "container"

        # Probe for children (OUs/containers only — users are always leaves)
        has_children = False
        if node_type != "user":
            conn.search(
                search_base=entry_dn,
                search_filter=tree_filter,
                search_scope=LEVEL,
                attributes=[],
                size_limit=1,
            )
            has_children = len(conn.entries) > 0

        results.append(
            {
                "dn": entry_dn,
                "name": name,
                "type": node_type,
                "has_children": has_children,
            }
        )

    conn.unbind()

    # OUs/containers first (alpha), users second (alpha)
    ous = sorted(
        [r for r in results if r["type"] in ("ou", "container")],
        key=lambda r: r["name"].lower(),
    )
    users = sorted(
        [r for r in results if r["type"] == "user"],
        key=lambda r: r["name"].lower(),
    )
    return ous + users


def query_user(dn: str) -> ADUser:
    """
    Return a fully populated ADUser model for the given user DN.

    Attribute processing:
        - userAccountControl  → account_status ("Enabled"|"Disabled"|"Locked Out")
        - pwdLastSet          → ISO 8601 via Windows FILETIME decoder
        - accountExpires      → ISO 8601, or "Never" for sentinel values
        - lockoutTime         → ISO 8601 when non-zero, else None
        - manager             → resolved to displayName via a second LDAP query
        - memberOf            → resolved to group displayNames via per-group queries

    Raises:
        HTTPException 404 — DN not found.
        HTTPException 503 — (propagated from get_service_connection)

    Caller MUST use run_in_threadpool.
    """
    conn = get_service_connection()

    attributes = [
        "sAMAccountName",
        "userPrincipalName",
        "displayName",
        "givenName",
        "sn",
        "mail",
        "telephoneNumber",
        "mobile",
        "title",
        "department",
        "company",
        "manager",
        "memberOf",
        "accountExpires",
        "pwdLastSet",
        "lockoutTime",
        "badPwdCount",
        "userAccountControl",
        "whenCreated",
        "whenChanged",
    ]

    conn.search(
        search_base=dn,
        search_filter="(objectClass=*)",
        search_scope=BASE,
        attributes=attributes,
    )

    if not conn.entries:
        conn.unbind()
        raise HTTPException(status_code=404, detail="User not found")

    e = conn.entries[0]

    # --- Dates & account status ---
    uac = _int(e, "userAccountControl")
    lockout_raw = _int(e, "lockoutTime")
    account_status = _decode_account_status(uac, lockout_raw)
    pwd_last_set = _filetime_to_iso(_int(e, "pwdLastSet"))
    lockout_time = _filetime_to_iso(lockout_raw) if (lockout_raw and lockout_raw > 0) else None

    account_expires_raw = _int(e, "accountExpires")
    account_expires: Optional[str]
    if account_expires_raw in (0, None, _FILETIME_NEVER):
        account_expires = "Never"
    else:
        account_expires = _filetime_to_iso(account_expires_raw)

    # whenCreated / whenChanged — ldap3 parses GeneralizedTime as datetime objects
    when_created = _str(e, "whenCreated")
    when_changed = _str(e, "whenChanged")

    # --- Resolve manager DN → displayName ---
    manager_dn = _str(e, "manager")
    manager_display_name: Optional[str] = None
    if manager_dn:
        conn.search(
            search_base=manager_dn,
            search_filter="(objectClass=*)",
            search_scope=BASE,
            attributes=["displayName"],
        )
        if conn.entries:
            manager_display_name = _str(conn.entries[0], "displayName")

    # --- Resolve memberOf DNs → group displayNames ---
    member_of_dns = _list(e, "memberOf")
    member_of_names: list[str] = []
    for group_dn in member_of_dns:
        conn.search(
            search_base=group_dn,
            search_filter="(objectClass=*)",
            search_scope=BASE,
            attributes=["displayName", "name"],
        )
        if conn.entries:
            display = _str(conn.entries[0], "displayName") or _str(conn.entries[0], "name")
            if display:
                member_of_names.append(display)

    conn.unbind()

    return ADUser(
        dn=dn,
        sam_account_name=_str(e, "sAMAccountName") or "",
        upn=_str(e, "userPrincipalName"),
        display_name=_str(e, "displayName"),
        given_name=_str(e, "givenName"),
        surname=_str(e, "sn"),
        mail=_str(e, "mail"),
        telephone_number=_str(e, "telephoneNumber"),
        mobile=_str(e, "mobile"),
        title=_str(e, "title"),
        department=_str(e, "department"),
        company=_str(e, "company"),
        manager_dn=manager_dn,
        manager_display_name=manager_display_name,
        member_of=member_of_names,
        account_expires=account_expires,
        pwd_last_set=pwd_last_set,
        lockout_time=lockout_time,
        bad_pwd_count=_int(e, "badPwdCount"),
        account_status=account_status,
        when_created=when_created,
        when_changed=when_changed,
    )
