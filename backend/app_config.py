"""
Runtime configuration — reads and writes data/config.json.

All writes are atomic: written to a temp file then renamed into place
so a crash mid-write never leaves a corrupt config.

Service account passwords are NEVER logged anywhere in this module.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Optional

from backend.config import settings


def _config_path() -> Path:
    return Path(settings.data_dir) / "config.json"


def load_config() -> dict:
    """Return parsed config.json, or an empty dict if the file does not exist."""
    path = _config_path()
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def save_config(config: dict) -> None:
    """Atomically write config dict to data/config.json."""
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    fd, tmp_path = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(config, fh, indent=2)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def is_setup_complete() -> bool:
    """
    True only when both the local admin account AND LDAP have been configured.
    Both must be present for the app to be fully operational.
    """
    config = load_config()
    return bool(config.get("local_admin_created", False)) and bool(
        config.get("ldap_configured", False)
    )


def get_ldap_settings():
    """
    Return a typed LDAPSettings object from config.json, or None if LDAP
    has not been configured yet.

    Import is deferred to avoid a circular dependency at module load time.
    """
    from backend.models.schemas import LDAPSettings  # noqa: PLC0415

    config = load_config()
    if not config.get("ldap_configured", False):
        return None
    ldap_data = config.get("ldap")
    if not ldap_data:
        return None
    return LDAPSettings(**ldap_data)


def get_local_admin():
    """
    Return a typed LocalAdmin object from config.json, or None if the
    local admin account has not been created yet.

    Import is deferred to avoid a circular dependency at module load time.
    """
    from backend.models.schemas import LocalAdmin  # noqa: PLC0415

    config = load_config()
    if not config.get("local_admin_created", False):
        return None
    admin_data = config.get("local_admin")
    if not admin_data:
        return None
    return LocalAdmin(**admin_data)


def get_entra_settings() -> dict | None:
    """
    Return the entra section from config.json as a dict, or None if Entra
    has not been configured or is marked disconnected.
    """
    config = load_config()
    entra = config.get("entra")
    if not entra or not entra.get("connected", False):
        return None
    return entra


def is_entra_configured() -> bool:
    """True when Entra credentials have been saved and are marked connected."""
    return get_entra_settings() is not None
