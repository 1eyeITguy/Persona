"""
All Pydantic models / schemas for Persona.

Organised into logical groups:
  - Config models     (LDAPSettings, LocalAdmin, AppConfig, FullConfig)
  - Auth models       (LoginRequest, TokenResponse, UserInfo)
  - Settings routes   (SettingsStatusResponse, TestConnectionRequest,
                       TestConnectionResponse, SetupRequest)
  - Entra models      (EntraConfigUpdate, EntraConfigResponse,
                       TestEntraConnectionRequest, TestEntraConnectionResponse)
  - AD models         (ADNode, ADTreeResponse, GroupRef, UserRef, ADUser)
"""

from __future__ import annotations

from typing import Any, Optional

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
    allowed_group_dn: Optional[str] = None  # if set, only members may log in


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
    entra_configured: bool = False
    entra_secret_expires: Optional[str] = None


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
    entra is optional — users may skip Entra during wizard.
    """

    ldap: LDAPSettings
    site_name: str = "Persona"
    entra: Optional["EntraConfigUpdate"] = None


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
    allowed_group_dn: Optional[str] = None  # empty string normalised to None by the route


class BootstrapRequest(BaseModel):
    """
    Sent in the first wizard step to create the local admin account.
    Only accepted when local_admin_created = false.
    """

    username: str
    password: str
    confirm_password: str


# ---------------------------------------------------------------------------
# Entra models
# ---------------------------------------------------------------------------


class TestEntraConnectionRequest(BaseModel):
    """Credentials to test against the Microsoft Graph API."""

    tenant_id: str
    client_id: str
    client_secret: str


class TestEntraConnectionResponse(BaseModel):
    success: bool
    message: str
    user_count: Optional[int] = None


class EntraConfigUpdate(BaseModel):
    """
    Used by the Setup Wizard (optional step) and PUT /entra/config.
    client_secret is always required when saving — the backend never
    returns it so the frontend cannot omit it on update.
    """

    tenant_id: str
    client_id: str
    client_secret: str
    secret_expires: Optional[str] = None  # ISO date string, e.g. "2027-04-01"


class EntraConfigResponse(BaseModel):
    """Entra config safe for API responses — secret is always redacted."""

    tenant_id: str
    client_id: str
    secret_expires: Optional[str] = None
    connected: bool = True


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


class GroupRef(BaseModel):
    """A resolved reference to an AD group returned with the user object."""

    name: str
    dn: str


class UserRef(BaseModel):
    """A resolved reference to an AD user (manager, direct report)."""

    name: str
    dn: str


class ADUser(BaseModel):
    """
    Full attribute set for a single AD user object.

    Covers all attributes visible in ADUC (including those normally hidden
    behind Advanced Features), plus a raw_attributes dump for the
    Attribute Editor view.
    """

    # ---- Core identity ----
    dn: str
    sam_account_name: str
    upn: Optional[str] = None
    display_name: Optional[str] = None
    given_name: Optional[str] = None
    surname: Optional[str] = None
    initials: Optional[str] = None
    description: Optional[str] = None

    # ---- Contact ----
    mail: Optional[str] = None
    telephone_number: Optional[str] = None
    mobile: Optional[str] = None
    web_page: Optional[str] = None          # wWWHomePage

    # ---- Office ----
    office: Optional[str] = None            # physicalDeliveryOfficeName

    # ---- Address ----
    street_address: Optional[str] = None
    city: Optional[str] = None              # l
    state: Optional[str] = None             # st
    postal_code: Optional[str] = None
    country: Optional[str] = None           # co

    # ---- Organization ----
    title: Optional[str] = None
    department: Optional[str] = None
    company: Optional[str] = None
    manager_dn: Optional[str] = None
    manager_display_name: Optional[str] = None
    direct_reports: list[UserRef] = Field(default_factory=list)

    # ---- Membership ----
    member_of: list[GroupRef] = Field(default_factory=list)
    primary_group_id: Optional[int] = None  # RID; 513 = Domain Users

    # ---- Account status & UAC ----
    account_status: str = "Enabled"         # "Enabled" | "Disabled" | "Locked Out"
    uac_raw: Optional[int] = None
    uac_flags: dict[str, bool] = Field(default_factory=dict)
    must_change_password: bool = False      # pwdLastSet == 0

    # ---- Account dates ----
    account_expires: Optional[str] = None   # ISO 8601 or "Never"
    pwd_last_set: Optional[str] = None      # ISO 8601
    lockout_time: Optional[str] = None      # ISO 8601 when locked
    bad_pwd_count: Optional[int] = None
    bad_password_time: Optional[str] = None # ISO 8601
    last_logon: Optional[str] = None        # lastLogonTimestamp (replicated, ~14d lag)
    logon_count: Optional[int] = None

    # ---- Profile ----
    profile_path: Optional[str] = None
    logon_script: Optional[str] = None      # scriptPath
    home_directory: Optional[str] = None
    home_drive: Optional[str] = None

    # ---- Object metadata (Advanced Features) ----
    object_sid: Optional[str] = None
    object_guid: Optional[str] = None
    usn_created: Optional[int] = None
    usn_changed: Optional[int] = None
    when_created: Optional[str] = None      # ISO 8601
    when_changed: Optional[str] = None      # ISO 8601

    # ---- Attribute Editor ----
    # All LDAP attributes serialized to strings, sorted by name.
    raw_attributes: dict[str, Any] = Field(default_factory=dict)
