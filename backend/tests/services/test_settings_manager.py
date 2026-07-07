"""Tests for services.settings_manager.SettingsManager."""

from __future__ import annotations


async def test_get_setting_missing_returns_none(fresh_db):
    from services.settings_manager import settings_manager

    assert await settings_manager.get_setting("nope") is None


async def test_set_setting_inserts_new(fresh_db):
    from services.settings_manager import settings_manager

    await settings_manager.set_setting("theme", "dark")
    assert await settings_manager.get_setting("theme") == "dark"


async def test_set_setting_upserts_existing(fresh_db):
    from services.settings_manager import settings_manager

    await settings_manager.set_setting("theme", "dark")
    await settings_manager.set_setting("theme", "light")
    assert await settings_manager.get_setting("theme") == "light"


async def test_delete_setting_returns_true_when_present(fresh_db):
    from services.settings_manager import settings_manager

    await settings_manager.set_setting("api_key", "abc")
    assert await settings_manager.delete_setting("api_key") is True
    assert await settings_manager.get_setting("api_key") is None


async def test_delete_setting_returns_false_when_absent(fresh_db):
    from services.settings_manager import settings_manager

    assert await settings_manager.delete_setting("ghost") is False
