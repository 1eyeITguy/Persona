"""
backend/auth/ldap.py — LDAP / Active Directory operations for Persona.

All functions are SYNCHRONOUS.  FastAPI callers MUST wrap every call in
    await run_in_threadpool(func, *args)
to avoid blocking the async event loop.

Passwords are NEVER logged or included in exception detail strings.
"""

from __future__ import annotations

import base64
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import ldap3
from fastapi import HTTPException
from ldap3 import ALL, BASE, LEVEL, RESTARTABLE, SUBTREE, Connection, Server
from ldap3.utils.conv import escape_filter_chars

from backend.app_config import get_ldap_settings as _load_ldap_settings
from backend.models.schemas import ADUser, GroupRef, LDAPSettings, TestConnectionResponse, UserRef

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
# UAC flag decoding
# ---------------------------------------------------------------------------

# Ordered as ADUC displays them (Account tab → Account options section).
_UAC_FLAGS: list[tuple[int, str]] = [
    (0x0002,    "Account is disabled"),
    (0x0020,    "Password not required"),
    (0x0040,    "Password cannot be changed"),
    (0x0080,    "Store password using reversible encryption"),
    (0x10000,   "Password never expires"),
    (0x40000,   "Smart card required for interactive logon"),
    (0x80000,   "Trusted for delegation (Kerberos)"),
    (0x100000,  "Account is sensitive; cannot be delegated"),
    (0x200000,  "Use DES encryption types for this account"),
    (0x400000,  "Do not require Kerberos pre-authentication"),
    (0x800000,  "Password expired"),
    (0x1000000, "Trusted to authenticate for delegation"),
]


def _decode_uac_flags(uac: Optional[int]) -> dict[str, bool]:
    """Return a human-readable map of UAC bit flags → bool."""
    if uac is None:
        return {}
    return {label: bool(uac & mask) for mask, label in _UAC_FLAGS}


# ---------------------------------------------------------------------------
# Binary attribute converters
# ---------------------------------------------------------------------------


def _bytes_to_sid(b: object) -> Optional[str]:
    """Convert a binary Windows SID to its S-x-x-... string representation."""
    try:
        if not isinstance(b, (bytes, bytearray)):
            return str(b) if b else None
        if len(b) < 8:
            return None
        revision = b[0]
        sub_count = b[1]
        authority = int.from_bytes(b[2:8], "big")
        subs = [
            int.from_bytes(b[8 + i * 4 : 12 + i * 4], "little")
            for i in range(sub_count)
        ]
        return "S-{}-{}-{}".format(revision, authority, "-".join(str(s) for s in subs))
    except Exception:
        return None


def _bytes_to_guid(b: object) -> Optional[str]:
    """Convert a 16-byte binary GUID (little-endian) to a UUID string."""
    try:
        if not isinstance(b, (bytes, bytearray)):
            return str(b) if b else None
        return str(uuid.UUID(bytes_le=bytes(b)))
    except Exception:
        return None


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
        if isinstance(val, (bytes, bytearray)):
            return None  # binary — handled by specific converters
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


def _raw_attr_value(entry: ldap3.Entry, attr: str) -> object:
    """Return the raw ldap3 value for an attribute, or None on error."""
    try:
        return entry[attr].value
    except Exception:
        return None


def _photo_data_url(data: bytes) -> str:
    """Convert raw thumbnailPhoto bytes to a base64 data URL."""
    mime = "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        mime = "image/png"
    return f"data:{mime};base64,{base64.b64encode(data).decode('ascii')}"


def _serialize_raw(entry: ldap3.Entry) -> dict[str, str]:
    """
    Serialize all ldap3 entry attributes to strings for the Attribute Editor tab.

    - Binary values are shown as a hex preview.
    - Multi-valued attributes are joined with "; ".
    - datetime values are ISO-formatted.
    - Attributes are sorted alphabetically.
    """
    result: dict[str, str] = {}
    for attr_name in sorted(entry.entry_attributes):
        try:
            val = entry[attr_name].value
            if val is None:
                result[attr_name] = ""
            elif isinstance(val, (bytes, bytearray)):
                preview = bytes(val)[:12].hex()
                result[attr_name] = f"<binary {len(val)} bytes: {preview}…>"
            elif isinstance(val, list):
                parts: list[str] = []
                for v in val:
                    if isinstance(v, (bytes, bytearray)):
                        parts.append(f"<binary {len(v)} bytes>")
                    elif isinstance(v, datetime):
                        parts.append(v.isoformat())
                    else:
                        parts.append(str(v))
                result[attr_name] = "; ".join(parts)
            elif isinstance(val, datetime):
                result[attr_name] = val.isoformat()
            else:
                result[attr_name] = str(val)
        except Exception:
            result[attr_name] = "<error reading attribute>"
    return result


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
        3. Bind with the resolved DN and the supplied password (credential check).
        4. If allowed_group_dn is configured, verify recursive group membership
           using the LDAP_MATCHING_RULE_IN_CHAIN extended filter (OID
           1.2.840.113556.1.4.1941).  This handles nested group membership
           transparently — a user in Group A which is nested inside the
           restricted group will pass.

    The service account connection (svc_conn) is kept open through steps 2–4
    so that the group check reuses the existing bind with no second connection.
    It is closed in every exit path (success and failure).

    Raises:
        HTTPException 503 — LDAP not configured, or service account bind fails.
        HTTPException 401 — User not found, wrong password, or not in the
                            required group.  Message is intentionally generic;
                            the caller cannot distinguish between these cases.

    Password is NEVER logged.
    Caller MUST use run_in_threadpool.
    """
    ldap_cfg = _load_ldap_settings()
    if ldap_cfg is None:
        raise HTTPException(status_code=503, detail="LDAP not configured")

    server = _make_server(ldap_cfg)

    # Step 1 — bind as service account
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

    # Step 2 — resolve the user's full DN from sAMAccountName
    safe_username = escape_filter_chars(username)
    svc_conn.search(
        search_base=ldap_cfg.base_dn,
        search_filter=f"(&(objectClass=user)(sAMAccountName={safe_username}))",
        search_scope=SUBTREE,
        attributes=["distinguishedName", "displayName", "sAMAccountName"],
    )

    if not svc_conn.entries:
        svc_conn.unbind()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_dn = svc_conn.entries[0].entry_dn
    display_name = _str(svc_conn.entries[0], "displayName") or username
    # svc_conn intentionally left open — reused for Step 4 group check.

    # Step 3 — verify the supplied password by binding as the user
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
        svc_conn.unbind()
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Step 4 — group membership check (only when allowed_group_dn is configured)
    if ldap_cfg.allowed_group_dn:
        safe_group_dn = escape_filter_chars(ldap_cfg.allowed_group_dn)
        # LDAP_MATCHING_RULE_IN_CHAIN (OID 1.2.840.113556.1.4.1941) performs a
        # transitive/recursive memberOf walk in Active Directory.  A single
        # search result means the user is a member (directly or via nesting).
        svc_conn.search(
            search_base=ldap_cfg.base_dn,
            search_filter=(
                f"(&(objectClass=user)"
                f"(sAMAccountName={safe_username})"
                f"(memberOf:1.2.840.113556.1.4.1941:={safe_group_dn}))"
            ),
            search_scope=SUBTREE,
            attributes=[],
            size_limit=1,
        )
        if not svc_conn.entries:
            svc_conn.unbind()
            raise HTTPException(status_code=401, detail="Invalid credentials")

    svc_conn.unbind()

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

    Fetches all user-defined LDAP attributes (via '*') plus the operational
    attributes uSNCreated and uSNChanged.  Populates every field in ADUser,
    including those shown only under ADUC's Advanced Features.

    Extra LDAP queries performed:
        - 1 query to resolve manager DN → displayName
        - N queries to resolve memberOf DNs → GroupRef objects
        - M queries to resolve directReports DNs → UserRef objects

    Raises:
        HTTPException 404 — DN not found.
        HTTPException 503 — (propagated from get_service_connection)

    Caller MUST use run_in_threadpool.
    """
    conn = get_service_connection()

    # '*' fetches all user-defined attributes.
    # uSNCreated / uSNChanged are operational attributes — request explicitly.
    conn.search(
        search_base=dn,
        search_filter="(objectClass=*)",
        search_scope=BASE,
        attributes=["*", "uSNCreated", "uSNChanged"],
    )

    if not conn.entries:
        conn.unbind()
        raise HTTPException(status_code=404, detail="User not found")

    e = conn.entries[0]

    # ---- Account status & UAC ----
    uac = _int(e, "userAccountControl")
    lockout_raw = _int(e, "lockoutTime")
    account_status = _decode_account_status(uac, lockout_raw)
    uac_flags = _decode_uac_flags(uac)

    # ---- Dates ----
    pwd_last_set_raw = _int(e, "pwdLastSet")
    must_change_password = pwd_last_set_raw == 0
    pwd_last_set = _filetime_to_iso(pwd_last_set_raw)
    lockout_time = _filetime_to_iso(lockout_raw) if (lockout_raw and lockout_raw > 0) else None
    bad_password_time = _filetime_to_iso(_int(e, "badPasswordTime"))
    last_logon = _filetime_to_iso(_int(e, "lastLogonTimestamp"))

    account_expires_raw = _int(e, "accountExpires")
    if account_expires_raw in (0, None, _FILETIME_NEVER):
        account_expires: Optional[str] = "Never"
    else:
        account_expires = _filetime_to_iso(account_expires_raw)

    # whenCreated / whenChanged — ldap3 parses GeneralizedTime as datetime objects
    when_created = _str(e, "whenCreated")
    when_changed = _str(e, "whenChanged")

    # ---- objectSid: try as string (schema-decoded) then bytes fallback ----
    try:
        sid_raw = e["objectSid"].value
        if isinstance(sid_raw, str):
            object_sid: Optional[str] = sid_raw
        elif isinstance(sid_raw, (bytes, bytearray)):
            object_sid = _bytes_to_sid(sid_raw)
        else:
            object_sid = str(sid_raw) if sid_raw is not None else None
    except Exception:
        object_sid = None

    # ---- objectGUID: try as string then bytes fallback ----
    try:
        guid_raw = e["objectGUID"].value
        if isinstance(guid_raw, str):
            object_guid: Optional[str] = guid_raw
        elif isinstance(guid_raw, (bytes, bytearray)):
            object_guid = _bytes_to_guid(guid_raw)
        else:
            object_guid = str(guid_raw) if guid_raw is not None else None
    except Exception:
        object_guid = None

    # ---- Resolve manager DN → displayName ----
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

    # ---- Resolve memberOf DNs → GroupRef list ----
    member_of_dns = _list(e, "memberOf")
    member_of: list[GroupRef] = []
    for group_dn in member_of_dns:
        conn.search(
            search_base=group_dn,
            search_filter="(objectClass=*)",
            search_scope=BASE,
            attributes=["displayName", "name"],
        )
        if conn.entries:
            display = _str(conn.entries[0], "displayName") or _str(conn.entries[0], "name")
            member_of.append(GroupRef(name=display or group_dn, dn=group_dn))

    # ---- Resolve directReports DNs → UserRef list ----
    direct_report_dns = _list(e, "directReports")
    direct_reports: list[UserRef] = []
    for dr_dn in direct_report_dns:
        conn.search(
            search_base=dr_dn,
            search_filter="(objectClass=*)",
            search_scope=BASE,
            attributes=["displayName", "name"],
        )
        if conn.entries:
            display = _str(conn.entries[0], "displayName") or _str(conn.entries[0], "name")
            if display:
                direct_reports.append(UserRef(name=display, dn=dr_dn))

    # ---- Profile photo ----
    photo: str | None = None
    try:
        photo_raw = e["thumbnailPhoto"].value
        if isinstance(photo_raw, (bytes, bytearray)) and photo_raw:
            photo = _photo_data_url(bytes(photo_raw))
    except Exception:
        pass

    # ---- Raw attributes for Attribute Editor ----
    raw_attributes = _serialize_raw(e)

    conn.unbind()

    return ADUser(
        # Identity
        dn=dn,
        sam_account_name=_str(e, "sAMAccountName") or "",
        upn=_str(e, "userPrincipalName"),
        display_name=_str(e, "displayName"),
        given_name=_str(e, "givenName"),
        surname=_str(e, "sn"),
        initials=_str(e, "initials"),
        description=_str(e, "description"),
        # Contact
        mail=_str(e, "mail"),
        telephone_number=_str(e, "telephoneNumber"),
        mobile=_str(e, "mobile"),
        web_page=_str(e, "wWWHomePage"),
        # Office
        office=_str(e, "physicalDeliveryOfficeName"),
        # Address
        street_address=_str(e, "streetAddress"),
        city=_str(e, "l"),
        state=_str(e, "st"),
        postal_code=_str(e, "postalCode"),
        country=_str(e, "co"),
        # Organization
        title=_str(e, "title"),
        department=_str(e, "department"),
        company=_str(e, "company"),
        manager_dn=manager_dn,
        manager_display_name=manager_display_name,
        direct_reports=direct_reports,
        # Membership
        member_of=member_of,
        primary_group_id=_int(e, "primaryGroupID"),
        # Account
        account_status=account_status,
        uac_raw=uac,
        uac_flags=uac_flags,
        must_change_password=must_change_password,
        account_expires=account_expires,
        pwd_last_set=pwd_last_set,
        lockout_time=lockout_time,
        bad_pwd_count=_int(e, "badPwdCount"),
        bad_password_time=bad_password_time,
        last_logon=last_logon,
        logon_count=_int(e, "logonCount"),
        # Profile
        profile_path=_str(e, "profilePath"),
        logon_script=_str(e, "scriptPath"),
        home_directory=_str(e, "homeDirectory"),
        home_drive=_str(e, "homeDrive"),
        # Object metadata
        object_sid=object_sid,
        object_guid=object_guid,
        usn_created=_int(e, "uSNCreated"),
        usn_changed=_int(e, "uSNChanged"),
        when_created=when_created,
        when_changed=when_changed,
        # Photo
        photo=photo,
        # Attribute Editor
        raw_attributes=raw_attributes,
    )
