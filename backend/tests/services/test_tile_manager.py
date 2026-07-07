"""Tests for services.tile_manager.TileManager.

All outbound httpx calls are stubbed via a MockTransport so tests never touch
the real Google / Nominatim APIs. The Google Maps API key is seeded into the
real settings store (no DB mocking).
"""

from __future__ import annotations

import json
import time
from typing import Callable

import httpx
import pytest

from core.models import TileSessionRequest


_FAKE_KEY = "AIzaSyD-FakeKeyForTestingOnly1234567890"


def _patch_http_client(tile_manager, handler: Callable[[httpx.Request], httpx.Response]):
    """Replace the manager's HTTP client with one backed by MockTransport."""
    # Close any existing real client (none in fresh tests, but be safe)
    transport = httpx.MockTransport(handler)
    tile_manager._http_client = httpx.AsyncClient(transport=transport)
    return tile_manager._http_client


async def _reset_manager(tile_manager):
    """Clear caches between tests since manager is a module-level singleton."""
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
# Session creation: hits Google → caches → second call returns cached
# ---------------------------------------------------------------------------
async def test_create_tile_session_calls_google_and_caches(fresh_db):
    from services.settings_manager import settings_manager
    from services.tile_manager import tile_manager

    await _reset_manager(tile_manager)
    await settings_manager.set_setting("google_maps_api_key", _FAKE_KEY)

    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        assert "tile.googleapis.com" in request.url.host
        return httpx.Response(200, json={
            "session": "session-token-abc",
            "expiry": int(time.time()) + 86400,
            "tileWidth": 256,
            "tileHeight": 256,
        })

    _patch_http_client(tile_manager, handler)

    req = TileSessionRequest(mapType="roadmap")
    result = await tile_manager.create_tile_session(req)

    assert result["session"] == "session-token-abc"
    assert result["key"] == _FAKE_KEY
    assert result["tileWidth"] == 256
    assert call_count["n"] == 1

    # Second call: cache hit — no new HTTP call
    result2 = await tile_manager.create_tile_session(req)
    assert result2["session"] == "session-token-abc"
    assert call_count["n"] == 1, "Second call should be cached, not re-fetch"


async def test_create_tile_session_missing_api_key_raises(fresh_db):
    from fastapi import HTTPException
    from services.tile_manager import tile_manager

    await _reset_manager(tile_manager)

    # No api key in settings
    with pytest.raises(HTTPException) as excinfo:
        await tile_manager.create_tile_session(TileSessionRequest(mapType="roadmap"))
    assert excinfo.value.status_code == 400
    assert "API key" in excinfo.value.detail


async def test_create_tile_session_google_error_502(fresh_db):
    from fastapi import HTTPException
    from services.settings_manager import settings_manager
    from services.tile_manager import tile_manager

    await _reset_manager(tile_manager)
    await settings_manager.set_setting("google_maps_api_key", _FAKE_KEY)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403, json={"error": "forbidden"})

    _patch_http_client(tile_manager, handler)

    with pytest.raises(HTTPException) as excinfo:
        await tile_manager.create_tile_session(TileSessionRequest(mapType="roadmap"))
    assert excinfo.value.status_code == 502


# ---------------------------------------------------------------------------
# Invalidation + status
# ---------------------------------------------------------------------------
async def test_invalidate_tile_session_removes_cache_entry(fresh_db):
    from services.settings_manager import settings_manager
    from services.tile_manager import tile_manager

    await _reset_manager(tile_manager)
    await settings_manager.set_setting("google_maps_api_key", _FAKE_KEY)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "session": "tok",
            "expiry": int(time.time()) + 86400,
            "tileWidth": 256,
            "tileHeight": 256,
        })

    _patch_http_client(tile_manager, handler)
    req = TileSessionRequest(mapType="roadmap")
    await tile_manager.create_tile_session(req)
    assert len(tile_manager._session_cache) == 1

    out = await tile_manager.invalidate_tile_session(req)
    assert "invalidated" in out["message"].lower()
    assert len(tile_manager._session_cache) == 0

    # Invalidating again: not found
    out2 = await tile_manager.invalidate_tile_session(req)
    assert "no cached" in out2["message"].lower()


async def test_status_reports_cache_count(fresh_db):
    from services.settings_manager import settings_manager
    from services.tile_manager import tile_manager, MAX_SESSIONS

    await _reset_manager(tile_manager)
    await settings_manager.set_setting("google_maps_api_key", _FAKE_KEY)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "session": "tok",
            "expiry": int(time.time()) + 86400,
            "tileWidth": 256,
            "tileHeight": 256,
        })

    _patch_http_client(tile_manager, handler)
    await tile_manager.create_tile_session(TileSessionRequest(mapType="roadmap"))

    status = await tile_manager.get_tile_session_status()
    assert status["cachedSessions"] == 1
    assert status["maxSessions"] == MAX_SESSIONS
    assert len(status["sessions"]) == 1
    sole = list(status["sessions"].values())[0]
    assert sole["isValid"] is True
    assert sole["remainingSeconds"] > 0


# ---------------------------------------------------------------------------
# Session expiry math
# ---------------------------------------------------------------------------
def test_is_session_valid_true_when_far_from_expiry():
    from services.tile_manager import CachedSession, tile_manager, EXPIRY_SAFETY_BUFFER

    cached = CachedSession(
        session="x", key="k",
        expiry=int(time.time()) + EXPIRY_SAFETY_BUFFER + 100,
        map_type="roadmap", tile_width=256, tile_height=256,
    )
    assert tile_manager._is_session_valid(cached) is True


def test_is_session_valid_false_within_safety_buffer():
    from services.tile_manager import CachedSession, tile_manager, EXPIRY_SAFETY_BUFFER

    cached = CachedSession(
        session="x", key="k",
        expiry=int(time.time()) + EXPIRY_SAFETY_BUFFER - 60,  # inside buffer
        map_type="roadmap", tile_width=256, tile_height=256,
    )
    assert tile_manager._is_session_valid(cached) is False


def test_is_session_valid_false_when_expired():
    from services.tile_manager import CachedSession, tile_manager

    cached = CachedSession(
        session="x", key="k",
        expiry=int(time.time()) - 5,
        map_type="roadmap", tile_width=256, tile_height=256,
    )
    assert tile_manager._is_session_valid(cached) is False


async def test_expired_sessions_cleaned_on_create(fresh_db):
    from services.settings_manager import settings_manager
    from services.tile_manager import CachedSession, tile_manager

    await _reset_manager(tile_manager)
    await settings_manager.set_setting("google_maps_api_key", _FAKE_KEY)

    # Seed an expired session under a different cache key
    expired = CachedSession(
        session="old", key=_FAKE_KEY,
        expiry=int(time.time()) - 10,
        map_type="satellite", tile_width=256, tile_height=256,
    )
    tile_manager._session_cache["satellite:en-US:US::"] = expired

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "session": "fresh",
            "expiry": int(time.time()) + 86400,
            "tileWidth": 256,
            "tileHeight": 256,
        })

    _patch_http_client(tile_manager, handler)
    await tile_manager.create_tile_session(TileSessionRequest(mapType="roadmap"))

    # The expired one should have been swept
    assert "satellite:en-US:US::" not in tile_manager._session_cache


# ---------------------------------------------------------------------------
# Geocoding via Nominatim (HTTP mocked)
# ---------------------------------------------------------------------------
async def test_search_location_nominatim_returns_results(fresh_db):
    from services.tile_manager import tile_manager

    await _reset_manager(tile_manager)
    # No API key -> Nominatim path

    def handler(request: httpx.Request) -> httpx.Response:
        assert "nominatim.openstreetmap.org" in request.url.host
        return httpx.Response(200, json=[
            {"lat": "40.7128", "lon": "-74.0060", "display_name": "New York, NY, USA"},
            {"lat": "40.71", "lon": "-74.0", "display_name": "Manhattan"},
        ])

    _patch_http_client(tile_manager, handler)

    results = await tile_manager.search_location("New York")
    assert len(results) == 2
    assert results[0].lat == "40.7128"
    assert results[0].display_name == "New York, NY, USA"


async def test_search_location_cached_within_ttl(fresh_db):
    from services.tile_manager import tile_manager

    await _reset_manager(tile_manager)

    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        return httpx.Response(200, json=[
            {"lat": "1.0", "lon": "2.0", "display_name": "Foo"},
        ])

    _patch_http_client(tile_manager, handler)

    r1 = await tile_manager.search_location("foo")
    r2 = await tile_manager.search_location("foo")
    assert r1 == r2
    assert call_count["n"] == 1, "Second call should be served from cache"


async def test_autocomplete_returns_empty_without_google_key(fresh_db):
    from services.tile_manager import tile_manager

    await _reset_manager(tile_manager)
    # No API key + provider defaults to nominatim → autocomplete returns empty
    results = await tile_manager.autocomplete_location("hello world here", basemap="osm")
    assert results == []
