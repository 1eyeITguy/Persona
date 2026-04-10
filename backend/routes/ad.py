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
from backend.auth.ldap import get_filter_options, query_tree, query_user, search_users
from backend.deps import require_jwt
from backend.models.schemas import ADNode, ADTreeResponse, ADUser, ADUserSummary, FilterOptions

router = APIRouter(prefix="/ad", tags=["ad"])


def _require_ldap() -> None:
    """Raise 503 if LDAP has not been configured yet."""
    if get_ldap_settings() is None:
        raise HTTPException(status_code=503, detail="LDAP not configured")


@router.get("/tree", response_model=ADTreeResponse)
async def get_tree(
    dn: str | None = Query(default=None, description="DN to list; defaults to base_dn"),
    _token: dict = Depends(require_jwt),
) -> ADTreeResponse:
    """
    Return one level of the directory tree for the given DN.
    Falls back to base_dn when no dn query parameter is supplied.
    """
    _require_ldap()
    cfg = get_ldap_settings()

    target_dn = dn if dn else cfg.base_dn  # type: ignore[union-attr]

    children_raw = await run_in_threadpool(query_tree, target_dn)
    children = [ADNode(**c) for c in children_raw]
    return ADTreeResponse(dn=target_dn, children=children)


@router.get("/ou/{encoded_dn}/children", response_model=list[ADNode])
async def get_ou_children(
    encoded_dn: str,
    _token: dict = Depends(require_jwt),
) -> list[ADNode]:
    """
    Return one level of children for a specific OU or container DN.
    The DN must be URL-encoded in the path segment.
    """
    _require_ldap()
    dn = unquote(encoded_dn)
    children_raw = await run_in_threadpool(query_tree, dn)
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
    _token: dict = Depends(require_jwt),
) -> list[ADUserSummary]:
    """
    Search AD users with optional filters.  Returns up to 500 results sorted
    alphabetically.  All parameters are optional — omitting all returns every user.
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
