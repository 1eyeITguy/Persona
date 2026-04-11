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
# ---------------------------------------------------------------------------
# Entra cloud user models (for Cloud tab in UserDetail)
# ---------------------------------------------------------------------------


class EntraGroupRef(BaseModel):
    """A single Entra group membership entry."""

    name: str
    group_type: str   # "Security" | "M365" | "Dynamic" | "Distribution"
    has_team: bool = False  # True when a Teams team is provisioned on an M365 group


class EntraUserResponse(BaseModel):
    """
    Cloud identity data for a single user.
    Returned by GET /api/v1/entra/users/{upn}.
    """

    found: bool
    entra_object_id: Optional[str] = None
    account_enabled: Optional[bool] = None
    last_sign_in: Optional[str] = None          # ISO datetime or None
    sign_in_risk_level: Optional[str] = None    # "none"|"low"|"medium"|"high" — requires P2
    mfa_methods: list[str] = Field(default_factory=list)
    licenses: list[str] = Field(default_factory=list)
    groups: list[EntraGroupRef] = Field(default_factory=list)


class EntraDevice(BaseModel):
    """
    A device associated with an Entra/Intune user.
    Returned by GET /api/v1/entra/users/{object_id}/devices.
    """

    device_id: str                          # Entra device object ID or Intune device ID
    display_name: Optional[str] = None
    device_type: str = "intune"             # "intune" | "entra"
    operating_system: Optional[str] = None
    os_version: Optional[str] = None
    model: Optional[str] = None
    manufacturer: Optional[str] = None
    compliance_state: Optional[str] = None  # "compliant" | "noncompliant" | "unknown" (Intune only)
    management_state: Optional[str] = None  # "managed" | "retirePending" etc. (Intune only)
    enrolled_date_time: Optional[str] = None   # ISO 8601
    last_sync_date_time: Optional[str] = None  # ISO 8601
    is_managed: bool = True
    trust_type: Optional[str] = None        # "AzureAd" | "Workplace" | "ServerAd" (Entra only)


class EntraOnlyUser(BaseModel):
    """
    A cloud-only Entra user with no AD counterpart (onPremisesSyncEnabled is null/false).
    Returned by GET /api/v1/entra/users-cloud-only.
    """

    entra_object_id: str
    upn: str
    display_name: Optional[str] = None
    given_name: Optional[str] = None
    surname: Optional[str] = None
    mail: Optional[str] = None
    title: Optional[str] = None
    department: Optional[str] = None
    account_enabled: bool = True
    last_sign_in: Optional[str] = None
    mfa_methods: list[str] = Field(default_factory=list)
    licenses: list[str] = Field(default_factory=list)
    groups: list[EntraGroupRef] = Field(default_factory=list)
    photo: Optional[str] = None  # base64 data URL from Graph /photo/$value


# ---------------------------------------------------------------------------
# AD models
# ---------------------------------------------------------------------------


class ADNode(BaseModel):
    """One node in the directory tree (OU, container, or user)."""

    dn: str
    name: str
    type: str  # "ou" | "container" | "user"
    has_children: bool
    photo: Optional[str] = None  # base64 data URL; only set for user nodes that have a thumbnailPhoto
    is_synced: Optional[bool] = None   # True=synced to Entra, False=AD-only, None=unknown
    entra_object_id: Optional[str] = None  # msDS-ExternalDirectoryObjectId value


class ADTreeResponse(BaseModel):
    dn: str
    children: list[ADNode]


class GroupRef(BaseModel):
    """A resolved reference to an AD group returned with the user object."""

    name: str
    dn: str
    group_type: str = "Security"  # "Security" | "Distribution"


class UserRef(BaseModel):
    """A resolved reference to an AD user (manager, direct report)."""

    name: str
    dn: str
    title: Optional[str] = None   # jobTitle / title attribute
    photo: Optional[str] = None   # base64 data URL from thumbnailPhoto


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
    manager_title: Optional[str] = None
    manager_photo: Optional[str] = None  # base64 data URL
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

    # ---- Profile photo ----
    # Base64 data URL (data:image/jpeg;base64,...) from thumbnailPhoto (AD) or
    # Graph API (Entra).  None when no photo is stored.
    photo: Optional[str] = None

    # ---- Sync / hybrid identity ----
    is_synced: bool = False                # True when msDS-ExternalDirectoryObjectId is set
    entra_object_id: Optional[str] = None  # msDS-ExternalDirectoryObjectId

    # ---- Merged Entra data (only populated for synced users via /merged endpoint) ----
    entra_last_sign_in: Optional[str] = None
    entra_account_enabled: Optional[bool] = None
    entra_mfa_methods: list[str] = Field(default_factory=list)
    entra_licenses: list[str] = Field(default_factory=list)
    entra_cloud_groups: list[EntraGroupRef] = Field(default_factory=list)
    entra_photo: Optional[str] = None  # base64 data URL from Graph /photo/$value

    # ---- Attribute Editor ----
    # All LDAP attributes serialized to strings, sorted by name.
    raw_attributes: dict[str, Any] = Field(default_factory=dict)


class ADUserSummary(BaseModel):
    """Lightweight user model returned by the search endpoint."""

    dn: str
    display_name: Optional[str] = None
    sam_account_name: str
    title: Optional[str] = None
    department: Optional[str] = None
    office: Optional[str] = None           # physicalDeliveryOfficeName
    mail: Optional[str] = None
    account_status: str = "Enabled"        # "Enabled" | "Disabled" | "Locked Out"
    photo: Optional[str] = None            # base64 data URL from thumbnailPhoto
    is_synced: bool = False
    entra_object_id: Optional[str] = None


class FilterOptions(BaseModel):
    """Distinct filterable values collected across all user objects plus group/OU lists."""

    departments: list[str]
    offices: list[str]
    groups: list[GroupRef]   # All AD groups (security + distribution), name + dn
    ous: list[GroupRef]      # All organizational units, name + dn


# ---------------------------------------------------------------------------
# Device (computer) models
# ---------------------------------------------------------------------------


class ADComputerSummary(BaseModel):
    """Lightweight computer model returned by the device search endpoint."""

    dn: str
    name: str
    dns_hostname: Optional[str] = None
    operating_system: Optional[str] = None
    description: Optional[str] = None
    account_status: str = "Enabled"


class ADComputer(BaseModel):
    """
    Full attribute set for a single AD computer object.

    Covers all attributes visible in ADUC for computer objects, including
    those shown under Advanced Features.
    """

    # ---- Core identity ----
    dn: str
    name: str
    sam_account_name: str        # machine name + '$'
    dns_hostname: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None

    # ---- Operating System ----
    operating_system: Optional[str] = None
    operating_system_version: Optional[str] = None
    operating_system_service_pack: Optional[str] = None

    # ---- Account status & UAC ----
    account_status: str = "Enabled"
    uac_raw: Optional[int] = None
    uac_flags: dict[str, bool] = Field(default_factory=dict)

    # ---- Account dates ----
    last_logon: Optional[str] = None      # lastLogonTimestamp (replicated, ~14d lag)
    pwd_last_set: Optional[str] = None
    bad_pwd_count: Optional[int] = None
    when_created: Optional[str] = None    # ISO 8601
    when_changed: Optional[str] = None    # ISO 8601

    # ---- Organization ----
    managed_by_dn: Optional[str] = None
    managed_by_display_name: Optional[str] = None
    member_of: list[GroupRef] = Field(default_factory=list)
    primary_group_id: Optional[int] = None

    # ---- Object metadata (Advanced Features) ----
    object_sid: Optional[str] = None
    object_guid: Optional[str] = None
    usn_created: Optional[int] = None
    usn_changed: Optional[int] = None

    # ---- Attribute Editor ----
    raw_attributes: dict[str, Any] = Field(default_factory=dict)


class DeviceFilterOptions(BaseModel):
    """Distinct filterable values for device search dropdowns."""

    operating_systems: list[str]
    ous: list[GroupRef]
