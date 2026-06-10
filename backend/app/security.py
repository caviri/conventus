"""Password hashing and stateless session tokens.

We keep dependencies tiny: PBKDF2 from the stdlib for per-user passwords, and
itsdangerous for signed, expiring session tokens. No server-side session store
is needed, which keeps the whole thing single-container friendly.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any, Optional

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from . import config

_serializer = URLSafeTimedSerializer(config.SECRET_KEY, salt="conventus-session")

_PBKDF2_ROUNDS = 120_000


def hash_password(password: str) -> str:
    """Return a salted PBKDF2 hash encoded as ``salt$hash``."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), _PBKDF2_ROUNDS
    ).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: Optional[str]) -> bool:
    if not stored or "$" not in stored:
        return False
    salt, digest = stored.split("$", 1)
    candidate = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt.encode(), _PBKDF2_ROUNDS
    ).hex()
    return hmac.compare_digest(candidate, digest)


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def make_token(name: str, is_admin: bool) -> str:
    return _serializer.dumps({"name": name, "is_admin": is_admin})


def read_token(token: str) -> Optional[dict[str, Any]]:
    try:
        data = _serializer.loads(token, max_age=config.SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    if not isinstance(data, dict) or "name" not in data:
        return None
    return data
