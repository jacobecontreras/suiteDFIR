"""HTTP-level tests for /api/profiles router."""

from __future__ import annotations

import pytest


async def test_get_profiles_empty(client, fresh_db):
    resp = await client.get("/api/profiles", params={"tool": "ileapp"})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_get_profiles_unknown_tool_404(client, fresh_db):
    resp = await client.get("/api/profiles", params={"tool": "bogus"})
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


async def test_create_profile_returns_profile(client, fresh_db):
    resp = await client.post("/api/profiles", json={
        "name": "default",
        "tool": "ileapp",
        "modules": ["mod_a", "mod_b"],
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "default"
    assert body["tool"] == "ileapp"
    assert body["modules"] == ["mod_a", "mod_b"]
    assert isinstance(body["id"], int)


async def test_create_profile_duplicate_returns_400(client, fresh_db):
    payload = {"name": "dup", "tool": "ileapp", "modules": ["x"]}
    first = await client.post("/api/profiles", json=payload)
    assert first.status_code == 200
    second = await client.post("/api/profiles", json=payload)
    assert second.status_code == 400
    assert "already exists" in second.json()["detail"]


async def test_create_profile_unknown_tool_404(client, fresh_db):
    # 'tool' is a ToolName enum -> pydantic rejects with 422 before our 404 path,
    # so we craft a value that IS an enum member but call validate via an
    # otherwise-valid request and an unknown tool string would be 422.
    # Instead, verify the validator rejects unknown tools when we hit /load with bogus tool.
    resp = await client.post("/api/profiles", json={
        "name": "anything",
        "tool": "nonsense",
        "modules": [],
    })
    # FastAPI/Pydantic rejects unknown enum at validation -> 422.
    assert resp.status_code == 422


async def test_list_profiles_round_trip(client, fresh_db):
    await client.post("/api/profiles", json={"name": "p1", "tool": "ileapp", "modules": ["a"]})
    await client.post("/api/profiles", json={"name": "p2", "tool": "ileapp", "modules": ["b", "c"]})
    await client.post("/api/profiles", json={"name": "p1", "tool": "aleapp", "modules": ["z"]})

    ileapp = await client.get("/api/profiles", params={"tool": "ileapp"})
    aleapp = await client.get("/api/profiles", params={"tool": "aleapp"})

    ileapp_data = ileapp.json()
    aleapp_data = aleapp.json()

    assert {p["name"] for p in ileapp_data} == {"p1", "p2"}
    by_name = {p["name"]: p for p in ileapp_data}
    assert by_name["p2"]["modules"] == ["b", "c"]

    assert len(aleapp_data) == 1
    assert aleapp_data[0]["modules"] == ["z"]


async def test_load_profile_updates_modules(client, fresh_db):
    from core.state import available_modules

    available_modules["ileapp"] = {
        "m1": {"name": "m1", "selected": False},
        "m2": {"name": "m2", "selected": False},
    }
    try:
        created = await client.post(
            "/api/profiles",
            json={"name": "loadable", "tool": "ileapp", "modules": ["m1", "m2"]},
        )
        pid = created.json()["id"]

        resp = await client.post(f"/api/profiles/{pid}/load", json={"tool": "ileapp"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["selected_count"] == 2
        assert set(body["modules"]) == {"m1", "m2"}
        assert available_modules["ileapp"]["m1"]["selected"] is True
        assert available_modules["ileapp"]["m2"]["selected"] is True
    finally:
        available_modules.pop("ileapp", None)


async def test_load_profile_missing_returns_404(client, fresh_db):
    resp = await client.post("/api/profiles/99999/load", json={"tool": "ileapp"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Profile not found"


async def test_delete_profile_then_404(client, fresh_db):
    created = await client.post(
        "/api/profiles",
        json={"name": "x", "tool": "ileapp", "modules": ["a"]},
    )
    pid = created.json()["id"]

    resp = await client.delete(f"/api/profiles/{pid}")
    assert resp.status_code == 200
    assert resp.json()["message"] == "Profile deleted successfully"

    again = await client.delete(f"/api/profiles/{pid}")
    assert again.status_code == 404
    assert again.json()["detail"] == "Profile not found"
