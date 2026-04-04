# Architecture: Identity Providers

---

## Overview

The identity provider layer abstracts where user identity lives.
Persona supports three worlds, configured at Setup Wizard time.

---

## Provider Interface

```python
class IdentityProvider(ABC):
    provider_id: str
    display_name: str

    @abstractmethod
    async def authenticate(self, username: str, password: str) -> AuthResult:
        """Verify user credentials. Never log the password."""

    @abstractmethod
    async def get_user(self, identifier: UserIdentifier) -> UnifiedUser | None:
        """Fetch full user object by DN, UPN, or sAMAccountName."""

    @abstractmethod
    async def search_users(self, query: str, tenant_id: UUID) -> list[UnifiedUser]:
        """Search by name, email, or username."""

    @abstractmethod
    async def get_tree(self, dn: str) -> list[TreeNode]:
        """Return one level of children for the given DN."""
```

---

## UnifiedUser Object

Provider-agnostic. UI never knows which provider returned data.

```python
class UnifiedUser(BaseModel):
    # Identity (always present)
    id: str                    # Entra objectId or AD objectGUID
    sam_account_name: str | None
    upn: str | None
    display_name: str | None
    given_name: str | None
    surname: str | None

    # Contact
    mail: str | None
    telephone_number: str | None
    mobile: str | None

    # Organization
    title: str | None
    department: str | None
    company: str | None
    manager_display_name: str | None
    manager_dn: str | None

    # AD-specific (None for Entra-only)
    dn: str | None
    when_created: str | None
    when_changed: str | None
    pwd_last_set: str | None      # ISO 8601
    account_expires: str | None   # ISO 8601 or "Never"
    lockout_time: str | None
    bad_pwd_count: int | None
    account_status: str           # "Enabled"|"Disabled"|"Locked Out"
    member_of: list[str]          # group display names

    # Exchange (populated after SOA resolution)
    exchange_soa: ExchangeSOA | None
    has_mailbox: bool | None

    # Entra-specific (None for AD-only)
    entra_id: str | None
    last_sign_in: str | None
    mfa_registered: bool | None
    sign_in_risk: str | None
    account_enabled_entra: bool | None  # separate from AD enabled state

    # Metadata
    source_provider: str          # "ad"|"entra"|"hybrid"
    tenant_id: UUID
```

---

## AD Provider (ldap3)

```python
class ADIdentityProvider(IdentityProvider):
    provider_id = "active_directory"

    def __init__(self, config: LDAPSettings):
        self.config = config

    async def authenticate(self, username: str, password: str) -> AuthResult:
        # Run in thread pool — ldap3 is synchronous
        return await run_in_threadpool(self._bind_user, username, password)

    def _bind_user(self, username: str, password: str) -> AuthResult:
        # 1. Use service account to resolve full DN from sAMAccountName
        # 2. Attempt bind with user DN + password
        # 3. Discard password immediately after bind
        # 4. Return AuthResult — never raise with credential detail
        ...

    def _get_service_connection(self) -> ldap3.Connection:
        # RESTARTABLE strategy for reliability
        # Connection reused across requests (thread-safe pool)
        ...
```

LDAP operations: always `run_in_threadpool`. Never block the event loop.

---

## Entra Provider (msal + Graph)

```python
class EntraIdentityProvider(IdentityProvider):
    provider_id = "entra_id"

    async def authenticate(self, username: str, password: str) -> AuthResult:
        # Not used for primary auth — Entra users log in via LDAP (hybrid)
        # or MSAL device code flow (Entra-only)
        raise NotImplementedError("Use MSAL flow for Entra-only auth")

    async def get_user(self, identifier: UserIdentifier) -> UnifiedUser | None:
        # GET /v1.0/users/{id or UPN}?$select=...
        # Map Graph response to UnifiedUser
        ...

    def _get_graph_token(self) -> str:
        # Client credentials flow using service principal
        # Token cached and refreshed automatically by msal
        ...
```

---

## Hybrid Provider

```python
class HybridIdentityProvider(IdentityProvider):
    provider_id = "hybrid"

    def __init__(self, ad_provider: ADIdentityProvider,
                 entra_provider: EntraIdentityProvider):
        self.ad = ad_provider
        self.entra = entra_provider

    async def get_user(self, identifier: UserIdentifier) -> UnifiedUser | None:
        # Fetch from both providers, merge
        ad_user = await self.ad.get_user(identifier)
        entra_user = await self.entra.get_user(identifier)

        if ad_user is None:
            return entra_user  # cloud-only user

        if entra_user is None:
            return ad_user  # AD-only (sync may be pending)

        # Merge: AD wins for on-prem attrs, Entra wins for cloud attrs
        return self._merge(ad_user, entra_user)

    def _merge(self, ad: UnifiedUser, entra: UnifiedUser) -> UnifiedUser:
        # AD authoritative: dn, sam_account_name, pwd_last_set,
        #                   lockout, bad_pwd_count, when_created
        # Entra authoritative: last_sign_in, mfa_registered,
        #                      sign_in_risk, account_enabled_entra
        # Prefer AD for display if present, fallback to Entra
        ...
```

---

## Setup Wizard Configuration

```python
class IdentityConfig(BaseModel):
    provider_type: str  # "ad_only"|"entra_only"|"hybrid"

    # AD settings (required for ad_only and hybrid)
    ldap: LDAPSettings | None

    # Entra settings (required for entra_only and hybrid)
    entra: EntraSettings | None
```

Provider is instantiated at startup based on config.
All routes get the correct provider via FastAPI dependency injection.
