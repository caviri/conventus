"""Password hashing, stateless session tokens, and stored-secret sealing.

We keep dependencies tiny: PBKDF2 from the stdlib for per-user passwords,
itsdangerous for signed, expiring session tokens, and Fernet (from
``cryptography``, already required by webpush) to encrypt bot API keys at
rest. No server-side session store is needed, which keeps the whole thing
single-container friendly.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
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


# --- stored secrets (bot API keys) ----------------------------------------
# Secrets in the database carry a prefix telling how to resolve them:
#   enc:…   Fernet ciphertext, keyed off SECRET_KEY (only when it's pinned —
#           a per-boot random key would orphan the ciphertext on restart)
#   env:X   a pointer to environment variable X, resolved at call time —
#           the secret itself never touches the database or exports
# Anything else is legacy plaintext, still honored (and upgraded on startup
# when SECRET_KEY is set).

ENC_PREFIX = "enc:"
ENV_PREFIX = "env:"


def _fernet():
    from cryptography.fernet import Fernet

    digest = hashlib.sha256(f"conventus-secrets:{config.SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def seal_secret(value: str) -> str:
    """Prepare a secret for storage: encrypt when possible, pass refs through."""
    value = (value or "").strip()
    if not value or value.startswith((ENC_PREFIX, ENV_PREFIX)):
        return value
    if not config.SECRET_KEY_SET:
        return value  # no stable key to encrypt under — stored as-is
    return ENC_PREFIX + _fernet().encrypt(value.encode()).decode()


def resolve_secret(value: Optional[str]) -> str:
    """Stored form → usable plaintext, at call time."""
    value = (value or "").strip()
    if not value:
        return ""
    if value.startswith(ENV_PREFIX):
        return os.environ.get(value[len(ENV_PREFIX):].strip(), "").strip()
    if value.startswith(ENC_PREFIX):
        try:
            return _fernet().decrypt(value[len(ENC_PREFIX):].encode()).decode()
        except Exception:  # wrong or rotated SECRET_KEY
            return ""
    return value


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
