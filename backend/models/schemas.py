"""
All Pydantic models / schemas for Persona.

Organised into logical groups:
  - Config models     (LDAPSettings, LocalAdmin, AppConfig, FullConfig)
  - Auth models       (LoginRequest, TokenResponse, UserInfo)
  - Settings routes   (SettingsStatusResponse, TestConnectionRequest,
                       TestConnectionResponse, SetupRequest)
  - AD models         (ADNode, ADTreeResponse, ADUser)
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Config models
# ---------------------------------------------------------------------------


class LDAPSettings(BaseModel):
    host: str
    port: int = 389
    use_ssl: bool = False
    base_dn: str
    service_account_dn: str
    service_account_password: str


class LocalAdmin(BaseModel):
    """Local break-glass admin account.  password_hash is bcrypt — never plain text."""

    username: str
    password_hash: str


class AppConfig(BaseModel):
    """The 'app' section of config.json."""

    site_name: str = "Persona"


class FullConfig(BaseModel):
    """
    In-memory representation of the full config.json structure.
    Used internally; never returned directly to the client (contains secrets).
    """

    ldap: Optional[LDAPSettings] = None
    local_admin: Optional[LocalAdmin] = None
    local_admin_created: bool = False
    ldap_configured: bool = False
    app: AppConfig = Field(default_factory=AppConfig)


# ---------------------------------------------------------------------------
# Auth models
# ---------------------------------------------------------------------------


class LoginRequest(BaseModel):
    username: str
    password: str


class UserInfo(BaseModel):
    display_name: str
    username: str
    role: str  # "local_admin" | "helpdesk"
    dn: Optional[str] = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserInfo


# ---------------------------------------------------------------------------
# Settings route models
# ---------------------------------------------------------------------------


class SettingsStatusResponse(BaseModel):
    local_admin_created: bool
    ldap_configured: bool
    setup_complete: bool
    site_name: str = "Persona"


class TestConnectionRequest(BaseModel):
    host: str
    port: int = 389
    use_ssl: bool = False
    base_dn: str
    service_account_dn: str
    service_account_password: str


class TestConnectionResponse(BaseModel):
    success: bool
    message: str


class SetupRequest(BaseModel):
    """
    Sent by the Setup Wizard to save LDAP config and mark setup complete.
    After this request succeeds, POST /settings/setup returns 403.
    """

    ldap: LDAPSettings
    site_name: str = "Persona"


class LDAPSettingsUpdate(BaseModel):
    """
    Used by PUT /settings/ldap (settings page).
    service_account_password is optional — when None/absent, the backend
    keeps the currently stored password so the UI doesn't need to handle
    the plaintext secret.
    """

    host: str
    port: int = 389
    use_ssl: bool = False
    base_dn: str
    service_account_dn: str
    service_account_password: Optional[str] = None


class BootstrapRequest(BaseModel):
    """
    Sent in the first wizard step to create the local admin account.
    Only accepted when local_admin_created = false.
    """

    username: str
    password: str
    confirm_password: str


# ---------------------------------------------------------------------------
# AD models
# ---------------------------------------------------------------------------


class ADNode(BaseModel):
    """One node in the directory tree (OU, container, or user)."""

    dn: str
    name: str
    type: str  # "ou" | "container" | "user"
    has_children: bool


class ADTreeResponse(BaseModel):
    dn: str
    children: list[ADNode]


class ADUser(BaseModel):
    """Full attribute set for a single AD user object."""

    dn: str
    sam_account_name: str
    upn: Optional[str] = None
    display_name: Optional[str] = None
    given_name: Optional[str] = None
    surname: Optional[str] = None
    mail: Optional[str] = None
    telephone_number: Optional[str] = None
    mobile: Optional[str] = None
    title: Optional[str] = None
    department: Optional[str] = None
    company: Optional[str] = None
    manager_dn: Optional[str] = None
    manager_display_name: Optional[str] = None  # resolved from manager_dn
    member_of: list[str] = Field(default_factory=list)  # group display names
    account_expires: Optional[str] = None  # ISO 8601 or "Never"
    pwd_last_set: Optional[str] = None  # ISO 8601
    lockout_time: Optional[str] = None  # ISO 8601 or None
    bad_pwd_count: Optional[int] = None
    account_status: str = "Enabled"  # "Enabled" | "Disabled" | "Locked Out"
    when_created: Optional[str] = None  # ISO 8601
    when_changed: Optional[str] = None  # ISO 8601
