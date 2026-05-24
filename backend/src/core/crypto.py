"""
Encryption-at-rest for sensitive column values (e.g. iOS backup passwords).

Uses Fernet (AES-128-CBC + HMAC-SHA256) with a per-install master key stored in
the OS keychain on macOS/Windows and a 0600 file on Linux. Ciphertext is base64
ASCII and fits any existing TEXT column without a schema change.
"""

import os
import platform
import logging
from pathlib import Path
from typing import Optional

from cryptography.fernet import Fernet

from core.config import DATA_DIR

logger = logging.getLogger(__name__)

_SERVICE = "suiteDFIR"
_ACCOUNT = "master_key"
_LINUX_KEY_PATH = Path(DATA_DIR) / ".master_key"

_fernet: Optional[Fernet] = None


class MasterKeyStore:
    """Platform-dispatched persistence for the symmetric master key."""

    @staticmethod
    def load() -> Optional[bytes]:
        system = platform.system()
        if system in ("Darwin", "Windows"):
            import keyring
            value = keyring.get_password(_SERVICE, _ACCOUNT)
            return value.encode("ascii") if value else None
        if _LINUX_KEY_PATH.exists():
            return _LINUX_KEY_PATH.read_bytes()
        return None

    @staticmethod
    def save(key: bytes) -> None:
        system = platform.system()
        if system in ("Darwin", "Windows"):
            import keyring
            keyring.set_password(_SERVICE, _ACCOUNT, key.decode("ascii"))
            return
        _LINUX_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
        _LINUX_KEY_PATH.write_bytes(key)
        os.chmod(_LINUX_KEY_PATH, 0o600)


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is not None:
        return _fernet

    key = MasterKeyStore.load()
    if key is None:
        key = Fernet.generate_key()
        MasterKeyStore.save(key)
        logger.info("Generated new master key for encryption-at-rest")
    _fernet = Fernet(key)
    return _fernet


def encrypt(plaintext: str) -> str:
    """Encrypt a UTF-8 string; returns a base64 Fernet token (ASCII)."""
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(ciphertext: str) -> str:
    """Decrypt a token produced by encrypt(); raises on tamper or wrong key."""
    return _get_fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
