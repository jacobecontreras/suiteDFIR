"""Tests for core.crypto encryption-at-rest helpers."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from cryptography.fernet import Fernet, InvalidToken

import core.crypto as crypto_mod
from core.crypto import MasterKeyStore, decrypt, encrypt


# ---------------------------------------------------------------------------
# encrypt / decrypt round-trips (use the test fernet stubbed in conftest)
# ---------------------------------------------------------------------------

class TestEncryptDecrypt:
    def test_round_trip_simple_ascii(self):
        token = encrypt("hello world")
        assert isinstance(token, str)
        assert token != "hello world"
        assert decrypt(token) == "hello world"

    def test_round_trip_unicode(self):
        plain = "passphrase with emoji and accents: cafe naive"
        token = encrypt(plain)
        assert decrypt(token) == plain

    def test_round_trip_empty_string(self):
        token = encrypt("")
        assert decrypt(token) == ""

    def test_token_is_ascii(self):
        token = encrypt("some secret")
        # Should be ASCII base64-safe
        token.encode("ascii")

    def test_distinct_calls_produce_distinct_tokens(self):
        # Fernet includes IV/timestamp so each call differs
        a = encrypt("same")
        b = encrypt("same")
        assert a != b
        assert decrypt(a) == decrypt(b) == "same"

    def test_decrypt_invalid_token_raises(self):
        with pytest.raises(InvalidToken):
            decrypt("not-a-valid-token")

    def test_decrypt_with_different_key_raises(self, monkeypatch):
        token = encrypt("secret")
        # Swap fernet temporarily for an unrelated key
        original = crypto_mod._fernet
        monkeypatch.setattr(crypto_mod, "_fernet", Fernet(Fernet.generate_key()))
        try:
            with pytest.raises(InvalidToken):
                decrypt(token)
        finally:
            crypto_mod._fernet = original


# ---------------------------------------------------------------------------
# MasterKeyStore (macOS / Windows keyring path)
# ---------------------------------------------------------------------------

def _install_fake_keyring(monkeypatch):
    """Install a fake `keyring` module into sys.modules.

    The real `keyring` package is not installed in the test venv (the
    production code only imports it when running on macOS/Windows in a
    real deployment). We provide a minimal shim with get_password /
    set_password attributes that tests can monkeypatch further.
    """
    import sys
    import types

    fake = types.ModuleType("keyring")
    fake.get_password = lambda service, account: None  # type: ignore[attr-defined]
    fake.set_password = lambda service, account, value: None  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "keyring", fake)
    return fake


class TestMasterKeyStoreKeyring:
    def test_load_returns_bytes_when_keyring_has_value(self, monkeypatch):
        monkeypatch.setattr(crypto_mod.platform, "system", lambda: "Darwin")
        keyring = _install_fake_keyring(monkeypatch)

        key_str = Fernet.generate_key().decode("ascii")
        keyring.get_password = lambda service, account: key_str  # type: ignore[attr-defined]

        loaded = MasterKeyStore.load()
        assert loaded == key_str.encode("ascii")

    def test_load_returns_none_when_keyring_empty(self, monkeypatch):
        monkeypatch.setattr(crypto_mod.platform, "system", lambda: "Darwin")
        keyring = _install_fake_keyring(monkeypatch)
        keyring.get_password = lambda service, account: None  # type: ignore[attr-defined]

        assert MasterKeyStore.load() is None

    def test_save_writes_to_keyring(self, monkeypatch):
        monkeypatch.setattr(crypto_mod.platform, "system", lambda: "Darwin")
        keyring = _install_fake_keyring(monkeypatch)

        captured = {}

        def fake_set(service, account, value):
            captured["service"] = service
            captured["account"] = account
            captured["value"] = value

        keyring.set_password = fake_set  # type: ignore[attr-defined]

        key = Fernet.generate_key()
        MasterKeyStore.save(key)

        assert captured["service"] == "suiteDFIR"
        assert captured["account"] == "master_key"
        assert captured["value"] == key.decode("ascii")

    def test_save_on_windows_uses_keyring_too(self, monkeypatch):
        monkeypatch.setattr(crypto_mod.platform, "system", lambda: "Windows")
        keyring = _install_fake_keyring(monkeypatch)

        called = {"count": 0}

        def fake_set(service, account, value):
            called["count"] += 1

        keyring.set_password = fake_set  # type: ignore[attr-defined]

        MasterKeyStore.save(Fernet.generate_key())
        assert called["count"] == 1


# ---------------------------------------------------------------------------
# MasterKeyStore (Linux file path)
# ---------------------------------------------------------------------------

class TestMasterKeyStoreLinuxFile:
    def test_load_returns_none_when_file_missing(self, monkeypatch, tmp_path):
        monkeypatch.setattr(crypto_mod.platform, "system", lambda: "Linux")
        monkeypatch.setattr(crypto_mod, "_LINUX_KEY_PATH", tmp_path / "missing.key")
        assert MasterKeyStore.load() is None

    def test_save_then_load_round_trip(self, monkeypatch, tmp_path):
        monkeypatch.setattr(crypto_mod.platform, "system", lambda: "Linux")
        key_file = tmp_path / "subdir" / ".master_key"
        monkeypatch.setattr(crypto_mod, "_LINUX_KEY_PATH", key_file)

        key = Fernet.generate_key()
        MasterKeyStore.save(key)

        assert key_file.exists()
        assert MasterKeyStore.load() == key

    def test_save_sets_0600_permissions(self, monkeypatch, tmp_path):
        monkeypatch.setattr(crypto_mod.platform, "system", lambda: "Linux")
        key_file = tmp_path / ".master_key"
        monkeypatch.setattr(crypto_mod, "_LINUX_KEY_PATH", key_file)

        MasterKeyStore.save(Fernet.generate_key())

        mode = key_file.stat().st_mode & 0o777
        assert mode == 0o600

    def test_save_creates_parent_directory(self, monkeypatch, tmp_path):
        monkeypatch.setattr(crypto_mod.platform, "system", lambda: "Linux")
        nested = tmp_path / "a" / "b" / "c" / ".master_key"
        monkeypatch.setattr(crypto_mod, "_LINUX_KEY_PATH", nested)

        MasterKeyStore.save(Fernet.generate_key())

        assert nested.exists()
        assert nested.parent.is_dir()
