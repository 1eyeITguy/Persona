# Architecture: Integration Plugin Framework

---

## Overview

Integration plugins connect Persona to third-party systems.
They are Python packages that implement a defined interface.
Credentials are stored per-tenant in config.json.
Community plugins are installable Python packages.

---

## Base Plugin Interface

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from uuid import UUID

@dataclass
class ConnectionResult:
    success: bool
    message: str
    detail: str | None = None

@dataclass
class ActionResult:
    success: bool
    message: str
    not_found: bool = False
    retryable: bool = False

@dataclass
class ConfigField:
    id: str
    label: str
    type: str        # "text"|"password"|"select"|"boolean"|"url"
    required: bool
    placeholder: str | None = None
    help_text: str | None = None
    options: list[str] | None = None  # for select type

class PersonaPlugin(ABC):
    plugin_id: str          # "sophos-central" — kebab-case, unique
    display_name: str       # "Sophos Central"
    plugin_type: str        # "security"|"remote-access"|"mdm"|"networking"|"itsm"
    version: str            # semver
    icon_url: str | None    # shown in Settings → Integrations UI
    docs_url: str | None    # link to plugin documentation

    @abstractmethod
    def get_config_fields(self) -> list[ConfigField]:
        """Define what credentials/settings the admin must configure."""

    @abstractmethod
    def test_connection(self, config: dict) -> ConnectionResult:
        """
        Verify API credentials work.
        Called from Settings → Integrations → Test button.
        Must not modify any data.
        """
```

---

## Device Plugin Interface

For systems that track devices: EDR, RMM, MDM, remote access tools.

```python
@dataclass
class DeviceIdentifier:
    hostname: str | None = None
    serial_number: str | None = None
    mac_address: str | None = None
    entra_device_id: str | None = None
    intune_device_id: str | None = None

@dataclass
class Device:
    plugin_id: str          # which plugin found this
    native_id: str          # ID in that system
    hostname: str | None
    serial_number: str | None
    status: str | None      # "online"|"offline"|"unknown"
    last_seen: str | None   # ISO 8601
    metadata: dict          # plugin-specific extra data

class DevicePlugin(PersonaPlugin):

    @abstractmethod
    def find_device(self, identifier: DeviceIdentifier,
                    config: dict) -> Device | None:
        """
        Find device by any available identifier.
        Returns None if not found — this is normal, not an error.
        Searches by hostname first, then serial, then other IDs.
        """

    @abstractmethod
    def offboard_device(self, device: Device,
                        config: dict) -> ActionResult:
        """
        Remove device from this system.
        Must be idempotent — safe to call if device not found.
        Returns not_found=True if device was already gone (not an error).
        """

    def onboard_device(self, device: Device,
                       config: dict) -> ActionResult:
        """
        Register device in this system.
        Optional — implement only if plugin supports onboarding.
        Default: raise NotImplementedError
        """
        raise NotImplementedError
```

---

## User Plugin Interface

For systems that track users: ITSM, HR systems, ticketing.

```python
@dataclass
class UserIdentifier:
    sam_account_name: str | None = None
    upn: str | None = None
    email: str | None = None
    entra_id: str | None = None

@dataclass
class PluginUser:
    plugin_id: str
    native_id: str
    display_name: str | None
    email: str | None
    status: str | None
    metadata: dict

class UserPlugin(PersonaPlugin):

    @abstractmethod
    def find_user(self, identifier: UserIdentifier,
                  config: dict) -> PluginUser | None:
        """Find user by any available identifier. Returns None if not found."""

    @abstractmethod
    def offboard_user(self, user: PluginUser,
                      config: dict) -> ActionResult:
        """
        Offboard user from this system (disable, delete, revoke access).
        Idempotent — safe if user not found.
        """
```

---

## Plugin Registration

```python
# backend/plugins/{plugin_id}/__init__.py

from persona.plugins.base import DevicePlugin

class SophosCentralPlugin(DevicePlugin):
    plugin_id = "sophos-central"
    display_name = "Sophos Central"
    plugin_type = "security"
    version = "1.0.0"
    docs_url = "https://github.com/persona-community/integrations/sophos-central"

    def get_config_fields(self) -> list[ConfigField]:
        return [
            ConfigField(
                id="api_host",
                label="API Region",
                type="select",
                required=True,
                options=["https://api.central.sophos.com",
                         "https://api-us03.central.sophos.com"],
            ),
            ConfigField(
                id="client_id",
                label="Client ID",
                type="text",
                required=True,
            ),
            ConfigField(
                id="client_secret",
                label="Client Secret",
                type="password",
                required=True,
            ),
        ]

    def test_connection(self, config: dict) -> ConnectionResult:
        # Attempt OAuth token acquisition + list endpoints (count only)
        ...

    def find_device(self, identifier: DeviceIdentifier,
                    config: dict) -> Device | None:
        # Search Sophos by hostname, then by other identifiers
        ...

    def offboard_device(self, device: Device,
                        config: dict) -> ActionResult:
        # DELETE /endpoint/v1/endpoints/{device.native_id}
        ...


# Plugin auto-discovery — scanned at startup
PERSONA_PLUGIN = SophosCentralPlugin
```

---

## Plugin Credential Storage

```json
// data/tenants/{tenant_id}/config.json
{
  "plugins": {
    "sophos-central": {
      "enabled": true,
      "api_host": "https://api.central.sophos.com",
      "client_id": "abc-123",
      "client_secret": "encrypted-value"
    },
    "cisco-umbrella": {
      "enabled": true,
      "api_key": "encrypted-value",
      "api_secret": "encrypted-value",
      "org_id": "12345"
    }
  }
}
```

Secrets in plugin config are encrypted at rest using a key derived from JWT_SECRET.
Never returned in API responses — redacted in all GET responses.

---

## Settings UI — Integrations Page

```
Settings → Integrations

Installed
─────────────────────────────────────────────────
Sophos Central     ● Connected     [Test] [Edit] [Remove]
Cisco Umbrella     ⚠ Auth error   [Test] [Edit] [Remove]
AnyDesk            ● Connected     [Test] [Edit] [Remove]

Available to Install
─────────────────────────────────────────────────
CrowdStrike Falcon   Security      [Install]
SentinelOne          Security      [Install]
TeamViewer           Remote Access [Install]
Jamf Pro             MDM           [Install]

[Browse Community Integrations →]
```

---

## Built-In Plugin List (Community Targets)

| Plugin ID | Display Name | Type |
|---|---|---|
| sophos-central | Sophos Central | security |
| cisco-umbrella | Cisco Umbrella | networking |
| crowdstrike | CrowdStrike Falcon | security |
| sentinelone | SentinelOne | security |
| defender-endpoint | Microsoft Defender for Endpoint | security |
| anydesk | AnyDesk | remote-access |
| teamviewer | TeamViewer | remote-access |
| connectwise-control | ConnectWise Control | remote-access |
| datto-rmm | Datto RMM | remote-access |
| jamf | Jamf Pro | mdm |
| kandji | Kandji | mdm |
| snipe-it | Snipe-IT | asset-management |
| lansweeper | Lansweeper | asset-management |
