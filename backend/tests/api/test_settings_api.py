"""HTTP-level tests for /api/settings router."""

from __future__ import annotations


async def test_get_setting_missing_returns_404(client, fresh_db):
    resp = await client.get("/api/settings/unknown_key")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Setting not found"


async def test_put_setting_creates_then_get_returns_value(client, fresh_db):
    put = await client.put("/api/settings/theme", json={"value": "dark"})
    assert put.status_code == 200
    assert put.json() == {"key": "theme", "value": "dark"}

    got = await client.get("/api/settings/theme")
    assert got.status_code == 200
    assert got.json() == {"key": "theme", "value": "dark"}


async def test_put_setting_upserts(client, fresh_db):
    await client.put("/api/settings/theme", json={"value": "dark"})
    await client.put("/api/settings/theme", json={"value": "light"})

    got = await client.get("/api/settings/theme")
    assert got.status_code == 200
    assert got.json()["value"] == "light"


async def test_delete_setting_idempotent(client, fresh_db):
    """DELETE returns 200 whether or not the key existed."""
    await client.put("/api/settings/api_key", json={"value": "abc"})

    first = await client.delete("/api/settings/api_key")
    assert first.status_code == 200
    assert first.json()["message"] == "Setting deleted"

    # GET should now 404
    follow = await client.get("/api/settings/api_key")
    assert follow.status_code == 404

    # Deleting absent key is still 200 (idempotent contract)
    second = await client.delete("/api/settings/api_key")
    assert second.status_code == 200


async def test_independent_keys_do_not_collide(client, fresh_db):
    await client.put("/api/settings/a", json={"value": "1"})
    await client.put("/api/settings/b", json={"value": "2"})

    a = await client.get("/api/settings/a")
    b = await client.get("/api/settings/b")
    assert a.json()["value"] == "1"
    assert b.json()["value"] == "2"
