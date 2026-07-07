"""API tests for src/api/tiles.py.

All outbound httpx is stubbed with MockTransport. A fake Google Maps API key
is seeded into the real settings store via settings_manager (no DB mocking).
"""

from __future__ import annotations

import time
from typing import Callable

import httpx
import pytest


_FAKE_KEY = "AIzaSyD-FakeKeyForTestingOnly1234567890"


def _patch(tile_manager, handler: Callable[[httpx.Request], httpx.Response]):
    transport = httpx.MockTransport(handler)
    tile_manager._http_client = httpx.AsyncClient(transport=transport)


async def _reset_manager():
    from services.tile_manager import tile_manager
    with tile_manager._cache_lock:
        tile_manager._session_cache.clear()
        tile_manager._geocode_cache.clear()
        tile_manager._autocomplete_cache.clear()
        tile_manager._geocode_request_times.clear()
        tile_manager._autocomplete_request_times.clear()
    if tile_manager._http_client is not None:
        try:
            await tile_manager._http_client.aclose()
        except Exception:
            pass
        tile_manager._http_client = None


# ---------------------------------------------------------------------------
# POST /api/spatial/tile-session
# ---------------------------------------------------------------------------
async def test_create_tile_session_success(client, fresh_db):
    from services.settings_manager import settings_manager
    from services.tile_manager import tile_manager

    await _reset_manager()
    await settings_manager.set_setting("google_maps_api_key", _FAKE_KEY)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "session": "sess-1",
            "expiry": int(time.time()) + 86400,
            "tileWidth": 256,
            "tileHeight": 256,
        })

    _patch(tile_manager, handler)

    resp = await client.post("/api/spatial/tile-session", json={"mapType": "roadmap"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["session"] == "sess-1"
    assert body["key"] == _FAKE_KEY
    assert body["tileWidth"] == 256


async def test_create_tile_session_no_api_key_400(client, fresh_db):
    await _reset_manager()
    # No api key + the handler defaults to FastAPI exception_handler -> 400
    resp = await client.post("/api/spatial/tile-session", json={"mapType": "roadmap"})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# DELETE /api/spatial/tile-session
# ---------------------------------------------------------------------------
async def test_invalidate_tile_session_no_cache(client, fresh_db):
    await _reset_manager()
    resp = await client.request(
        "DELETE",
        "/api/spatial/tile-session",
        json={"mapType": "roadmap"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "No cached" in body["message"]
    assert "cacheKey" in body


async def test_invalidate_tile_session_existing(client, fresh_db):
    from services.settings_manager import settings_manager
    from services.tile_manager import tile_manager

    await _reset_manager()
    await settings_manager.set_setting("google_maps_api_key", _FAKE_KEY)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "session": "sess-X",
            "expiry": int(time.time()) + 86400,
            "tileWidth": 256,
            "tileHeight": 256,
        })

    _patch(tile_manager, handler)
    # Create then invalidate
    await client.post("/api/spatial/tile-session", json={"mapType": "roadmap"})
    resp = await client.request(
        "DELETE", "/api/spatial/tile-session", json={"mapType": "roadmap"}
    )
    assert resp.status_code == 200
    assert "invalidated" in resp.json()["message"].lower()


# ---------------------------------------------------------------------------
# GET /api/spatial/tile-session/status
# ---------------------------------------------------------------------------
async def test_tile_session_status_empty(client, fresh_db):
    await _reset_manager()
    resp = await client.get("/api/spatial/tile-session/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["cachedSessions"] == 0
    assert body["sessions"] == {}


async def test_tile_session_status_after_create(client, fresh_db):
    from services.settings_manager import settings_manager
    from services.tile_manager import tile_manager

    await _reset_manager()
    await settings_manager.set_setting("google_maps_api_key", _FAKE_KEY)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "session": "sess-2",
            "expiry": int(time.time()) + 86400,
            "tileWidth": 256,
            "tileHeight": 256,
        })

    _patch(tile_manager, handler)
    await client.post("/api/spatial/tile-session", json={"mapType": "roadmap"})

    resp = await client.get("/api/spatial/tile-session/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["cachedSessions"] == 1


# ---------------------------------------------------------------------------
# GET /api/spatial/search (nominatim path, mocked)
# ---------------------------------------------------------------------------
async def test_search_location_nominatim(client, fresh_db):
    from services.tile_manager import tile_manager

    await _reset_manager()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[
            {"lat": "1.0", "lon": "2.0", "display_name": "Loc 1"},
        ])

    _patch(tile_manager, handler)
    resp = await client.get("/api/spatial/search", params={"q": "anywhere"})
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    assert body[0]["display_name"] == "Loc 1"


async def test_search_location_missing_query_422(client, fresh_db):
    await _reset_manager()
    resp = await client.get("/api/spatial/search")
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET /api/spatial/autocomplete (defaults to empty without google key)
# ---------------------------------------------------------------------------
async def test_autocomplete_no_key_returns_empty(client, fresh_db):
    await _reset_manager()
    resp = await client.get("/api/spatial/autocomplete", params={"q": "hello world here"})
    assert resp.status_code == 200
    assert resp.json() == []
