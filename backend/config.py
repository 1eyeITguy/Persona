"""
Bootstrap settings loaded from .env only.
No LDAP values here — those live in data/config.json (see app_config.py).
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    jwt_secret: str
    jwt_expire_minutes: int = 480
    app_port: int = 8000
    frontend_port: int = 5173
    cors_origins: list[str] = ["http://localhost:5173"]
    data_dir: str = "/app/data"

    # pydantic-settings v2: list fields are parsed as JSON from .env
    # Use CORS_ORIGINS=["http://localhost:5173"] format in .env
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
    )


settings = Settings()
