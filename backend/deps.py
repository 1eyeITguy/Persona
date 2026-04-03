"""
Shared FastAPI dependencies used across all route modules.

JWT helpers:
  create_access_token(data)  — sign a JWT with the bootstrap secret
  require_jwt                — FastAPI Depends() that returns the decoded payload
                               or raises 401
  optional_jwt               — FastAPI Depends() that returns the payload or None
                               (used by endpoints that are public during setup)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from backend.config import settings

_bearer = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"


def create_access_token(data: dict) -> str:
    """Return a signed JWT.  'exp' is added automatically."""
    payload = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload["exp"] = expire
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_jwt(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    """Dependency that enforces a valid Bearer JWT.  Returns decoded payload."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _decode(credentials.credentials)


def optional_jwt(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[dict]:
    """Dependency that returns decoded payload when a token is present, else None."""
    if credentials is None:
        return None
    try:
        return _decode(credentials.credentials)
    except HTTPException:
        return None
