"""Tests for services.profile_manager.ProfileManager.

Uses real SQLite (fresh_db). Exercises JSON round-trip of modules and the
UNIQUE(name, tool) constraint defined in the profiles schema.
"""

from __future__ import annotations

import pytest


async def test_create_profile_persists_modules(fresh_db):
    from services.profile_manager import profile_manager

    result = await profile_manager.create_profile(
        name="default",
        tool="ileapp",
        modules=["mod_a", "mod_b"],
    )
    assert result["name"] == "default"
    assert result["tool"] == "ileapp"
    assert result["modules"] == ["mod_a", "mod_b"]
    assert isinstance(result["id"], int)


async def test_get_profiles_scoped_by_tool(fresh_db):
    from services.profile_manager import profile_manager

    await profile_manager.create_profile("p1", "ileapp", ["x"])
    await profile_manager.create_profile("p2", "ileapp", ["y", "z"])
    await profile_manager.create_profile("p1", "aleapp", ["q"])  # same name, different tool: OK

    ileapp = await profile_manager.get_profiles("ileapp")
    aleapp = await profile_manager.get_profiles("aleapp")

    assert {p["name"] for p in ileapp} == {"p1", "p2"}
    assert all(p["tool"] == "ileapp" for p in ileapp)
    # JSON round-trip
    by_name = {p["name"]: p for p in ileapp}
    assert by_name["p2"]["modules"] == ["y", "z"]

    assert len(aleapp) == 1
    assert aleapp[0]["modules"] == ["q"]


async def test_create_profile_duplicate_name_tool_raises(fresh_db):
    from services.profile_manager import profile_manager

    await profile_manager.create_profile("dup", "ileapp", ["a"])
    with pytest.raises(ValueError, match="already exists"):
        await profile_manager.create_profile("dup", "ileapp", ["b"])


async def test_load_profile_returns_selection(fresh_db):
    from services.profile_manager import profile_manager

    created = await profile_manager.create_profile("load-me", "ileapp", ["m1", "m2", "m3"])
    loaded = await profile_manager.load_profile(created["id"], "ileapp")

    assert loaded is not None
    assert loaded["profile_name"] == "load-me"
    assert loaded["profile_id"] == created["id"]
    assert loaded["selected_count"] == 3
    assert set(loaded["modules"]) == {"m1", "m2", "m3"}


async def test_load_profile_missing_returns_none(fresh_db):
    from services.profile_manager import profile_manager

    assert await profile_manager.load_profile(9999, "ileapp") is None


async def test_load_profile_updates_in_memory_modules(fresh_db):
    from core.state import available_modules
    from services.profile_manager import profile_manager

    # Stage some plugin module state for the tool
    available_modules["ileapp"] = {
        "m1": {"name": "m1", "selected": False},
        "m2": {"name": "m2", "selected": True},
        "m3": {"name": "m3", "selected": False},
    }

    try:
        created = await profile_manager.create_profile("sel", "ileapp", ["m1", "m3"])
        await profile_manager.load_profile(created["id"], "ileapp")

        assert available_modules["ileapp"]["m1"]["selected"] is True
        assert available_modules["ileapp"]["m2"]["selected"] is False
        assert available_modules["ileapp"]["m3"]["selected"] is True
    finally:
        available_modules.pop("ileapp", None)


async def test_delete_profile_removes_row(fresh_db):
    from services.profile_manager import profile_manager

    created = await profile_manager.create_profile("kill", "ileapp", ["a"])
    assert await profile_manager.delete_profile(created["id"]) is True
    assert await profile_manager.delete_profile(created["id"]) is False
    assert await profile_manager.get_profiles("ileapp") == []


async def test_select_modules_uninitialised_tool_raises(fresh_db):
    from core.state import available_modules
    from services.profile_manager import profile_manager

    available_modules.pop("ileapp", None)
    with pytest.raises(ValueError, match="not initialized"):
        await profile_manager.select_modules("ileapp", {"m1": True})


async def test_select_modules_updates_count(fresh_db):
    from core.state import available_modules
    from services.profile_manager import profile_manager

    available_modules["ileapp"] = {
        "m1": {"name": "m1", "selected": False},
        "m2": {"name": "m2", "selected": False},
    }
    try:
        n = await profile_manager.select_modules("ileapp", {"m1": True, "m2": True})
        assert n == 2
        n = await profile_manager.select_modules("ileapp", {"m2": False})
        assert n == 1
    finally:
        available_modules.pop("ileapp", None)
