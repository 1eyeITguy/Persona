"""
AD routes — /api/v1/ad/

All endpoints require a valid JWT.
All LDAP calls use run_in_threadpool (ldap3 is synchronous).

GET /api/v1/ad/tree
  Query param: dn (optional — defaults to base_dn from config)
  Returns: { dn, children: [...] }

GET /api/v1/ad/ou/{encoded_dn}/children
  DN is URL-encoded.  Same response shape as /tree children array.

GET /api/v1/ad/user/{encoded_dn}
  DN is URL-encoded.  Returns full ADUser model.
"""

from __future__ import annotations

from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from backend.app_config import get_ldap_settings
from backend.auth.ldap import (
    get_device_filter_options,
    get_filter_options,
    query_computer,
    query_tree,
    query_user,
    query_user_devices,
    search_computers,
    search_users,
)
from backend.deps import require_jwt
from backend.models.schemas import (
    ADComputer,
    ADComputerSummary,
    ADNode,
    ADTreeResponse,
    ADUser,
    ADUserSummary,
    DeviceFilterOptions,
    FilterOptions,
)

router = APIRouter(prefix="/ad", tags=["ad"])


def _require_ldap() -> None:
    """Raise 503 if LDAP has not been configured yet."""
    if get_ldap_settings() is None:
        raise HTTPException(status_code=503, detail="LDAP not configured")


@router.get("/tree", response_model=ADTreeResponse)
async def get_tree(
    dn: str | None = Query(default=None, description="DN to list; defaults to base_dn"),
    mode: str = Query(default="users", description="users | synced-users | ad-only | devices"),
    _token: dict = Depends(require_jwt),
) -> ADTreeResponse:
    """
    Return one level of the directory tree for the given DN.
    Falls back to base_dn when no dn query parameter is supplied.
    OUs/containers containing no objects of the requested mode are omitted.

    mode "synced-users" — all users; is_synced/entra_object_id populated.
    mode "ad-only"      — only users without an Entra counterpart.
    """
    _require_ldap()
    cfg = get_ldap_settings()

    target_dn = dn if dn else cfg.base_dn  # type: ignore[union-attr]

    children_raw = await run_in_threadpool(query_tree, target_dn, mode)
    children = [ADNode(**c) for c in children_raw]
    return ADTreeResponse(dn=target_dn, children=children)


@router.get("/ou/{encoded_dn}/children", response_model=list[ADNode])
async def get_ou_children(
    encoded_dn: str,
    mode: str = Query(default="users", description="users | synced-users | ad-only | devices"),
    _token: dict = Depends(require_jwt),
) -> list[ADNode]:
    """
    Return one level of children for a specific OU or container DN.
    The DN must be URL-encoded in the path segment.
    OUs/containers containing no objects of the requested mode are omitted.
    """
    _require_ldap()
    dn = unquote(encoded_dn)
    children_raw = await run_in_threadpool(query_tree, dn, mode)
    return [ADNode(**c) for c in children_raw]


@router.get("/search", response_model=list[ADUserSummary])
async def search_users_endpoint(
    q: str | None = Query(default=None, description="Name or sAMAccountName substring"),
    department: str | None = Query(default=None),
    office: str | None = Query(default=None),
    account_status: str | None = Query(default=None, description="enabled | disabled | locked"),
    must_change_password: bool = Query(default=False),
    account_expiry: str | None = Query(default=None, description="never | expired | soon"),
    group_dn: str | None = Query(default=None, description="Require recursive membership in this group DN"),
    last_logon: str | None = Query(default=None, description="never | 30 | 90 | 180 (days)"),
    ou_dn: str | None = Query(default=None, description="Scope search to this OU DN"),
    sync_filter: str | None = Query(default=None, description="synced | ad-only"),
    _token: dict = Depends(require_jwt),
) -> list[ADUserSummary]:
    """
    Search AD users with optional filters.  Returns up to 500 results sorted
    alphabetically.  All parameters are optional — omitting all returns every user.

    sync_filter "synced"  — only users synced to Entra (msDS-ExternalDirectoryObjectId set).
    sync_filter "ad-only" — only users with no Entra counterpart.
    """
    _require_ldap()
    return await run_in_threadpool(
        search_users,
        q=q,
        department=department,
        office=office,
        account_status=account_status,
        must_change_password=must_change_password,
        account_expiry=account_expiry,
        group_dn=group_dn,
        last_logon=last_logon,
        ou_dn=ou_dn,
        sync_filter=sync_filter,
    )


@router.get("/filter-options", response_model=FilterOptions)
async def get_filter_options_endpoint(
    _token: dict = Depends(require_jwt),
) -> FilterOptions:
    """
    Return distinct filterable values from all user objects, plus all groups
    and OUs.  Used to populate dropdown menus in the search bar.
    """
    _require_ldap()
    return await run_in_threadpool(get_filter_options)


@router.get("/device-search", response_model=list[ADComputerSummary])
async def device_search(
    q: str | None = Query(default=None, description="Computer name or hostname substring"),
    operating_system: str | None = Query(default=None),
    account_status: str | None = Query(default=None, description="enabled | disabled"),
    last_logon: str | None = Query(default=None, description="never | 30 | 90 | 180 (days)"),
    ou_dn: str | None = Query(default=None, description="Scope search to this OU DN"),
    _token: dict = Depends(require_jwt),
) -> list[ADComputerSummary]:
    """
    Search AD computer objects with optional filters. Returns up to 500 results
    sorted alphabetically.
    """
    _require_ldap()
    return await run_in_threadpool(
        search_computers,
        q=q,
        operating_system=operating_system,
        account_status=account_status,
        last_logon=last_logon,
        ou_dn=ou_dn,
    )


@router.get("/device-filter-options", response_model=DeviceFilterOptions)
async def get_device_filter_options_endpoint(
    _token: dict = Depends(require_jwt),
) -> DeviceFilterOptions:
    """
    Return distinct operating system values and all OUs for device search dropdowns.
    """
    _require_ldap()
    return await run_in_threadpool(get_device_filter_options)


@router.get("/computer/{encoded_dn}", response_model=ADComputer)
async def get_computer(
    encoded_dn: str,
    _token: dict = Depends(require_jwt),
) -> ADComputer:
    """
    Return the full ADComputer attribute set for the given computer DN.
    The DN must be URL-encoded in the path segment.
    """
    _require_ldap()
    dn = unquote(encoded_dn)
    return await run_in_threadpool(query_computer, dn)


@router.get("/user-devices", response_model=list[ADComputerSummary])
async def get_user_devices(
    user_dn: str = Query(..., description="DN of the user to find devices for"),
    _token: dict = Depends(require_jwt),
) -> list[ADComputerSummary]:
    """
    Return computer objects where managedBy = user_dn.
    Used by the Devices tab in the user detail panel.
    """
    _require_ldap()
    return await run_in_threadpool(query_user_devices, user_dn)


@router.get("/user/{encoded_dn}/merged", response_model=ADUser)
async def get_user_merged(
    encoded_dn: str,
    _token: dict = Depends(require_jwt),
) -> ADUser:
    """
    Return a fully populated ADUser with Entra data merged in for synced users.
    If the user is synced and Entra is configured, makes Graph API calls to fetch
    last sign-in, MFA methods, licenses, cloud groups, and profile photo.
    Falls back to plain AD data when Entra is not configured or the user is AD-only.
    """
    _require_ldap()
    dn = unquote(encoded_dn)
    user = await run_in_threadpool(query_user, dn)

    if user.is_synced:
        from backend.app_config import get_entra_settings  # type: ignore
        from backend.auth.msal import get_entra_user, get_entra_user_photo  # type: ignore
        from backend.models.schemas import AuthMethod, EntraGroupRef, UserLicense  # type: ignore

        entra_cfg = get_entra_settings()
        if entra_cfg:
            try:
                entra_data = await run_in_threadpool(
                    get_entra_user,
                    entra_cfg["tenant_id"],
                    entra_cfg["client_id"],
                    entra_cfg["client_secret"],
                    user.upn,
                    user.mail,
                )
                if entra_data.get("found"):
                    obj_id = entra_data.get("entra_object_id") or user.entra_object_id
                    entra_photo: str | None = None
                    if obj_id:
                        entra_photo = await run_in_threadpool(
                            get_entra_user_photo,
                            entra_cfg["tenant_id"],
                            entra_cfg["client_id"],
                            entra_cfg["client_secret"],
                            obj_id,
                        )
                    user = user.model_copy(update={
                        "entra_last_sign_in": entra_data.get("last_sign_in"),
                        "entra_account_enabled": entra_data.get("account_enabled"),
                        "entra_default_mfa_method": entra_data.get("default_mfa_method"),
                        "entra_mfa_methods": [
                            AuthMethod(**m) for m in entra_data.get("mfa_methods", [])
                        ],
                        "entra_licenses": [
                            UserLicense(**l) for l in entra_data.get("licenses", [])
                        ],
                        "entra_cloud_groups": [
                            EntraGroupRef(**g) for g in entra_data.get("groups", [])
                        ],
                        "entra_photo": entra_photo,
                    })
            except Exception:
                pass  # Entra unavailable — return plain AD data

    return user


@router.get("/user/{encoded_dn}", response_model=ADUser)
async def get_user(
    encoded_dn: str,
    _token: dict = Depends(require_jwt),
) -> ADUser:
    """
    Return the full ADUser attribute set for the given user DN.
    The DN must be URL-encoded in the path segment.
    """
    _require_ldap()
    dn = unquote(encoded_dn)
    return await run_in_threadpool(query_user, dn)
