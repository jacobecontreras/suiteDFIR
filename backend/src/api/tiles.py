import atexit
import logging
from typing import List

from fastapi import APIRouter

from core.models import (
    GeocodeResult,
    InvalidateSessionResponse,
    PlaceSuggestion,
    TileSessionRequest,
    TileSessionResponse,
    TileSessionStatusResponse,
)
from services.tile_manager import tile_manager

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/spatial",
    tags=["spatial"]
)


def _sync_close_on_exit():
    """Synchronous wrapper for atexit. Best-effort cleanup on process exit."""
    tile_manager.sync_close_on_exit()


atexit.register(_sync_close_on_exit)


@router.post("/tile-session", response_model=TileSessionResponse)
async def create_tile_session(body: TileSessionRequest):
    """Proxy Google Maps Tile API session creation. Keeps API key server-side.

    Uses in-memory LRU caching with server-provided expiry for efficiency.
    """
    return await tile_manager.create_tile_session(body)


@router.delete("/tile-session", response_model=InvalidateSessionResponse)
async def invalidate_tile_session(body: TileSessionRequest):
    """Invalidate cached session. Call when tile requests fail with session errors."""
    return await tile_manager.invalidate_tile_session(body)


@router.get("/tile-session/status", response_model=TileSessionStatusResponse)
async def get_tile_session_status():
    """Get status of cached tile sessions (for debugging/monitoring)."""
    return await tile_manager.get_tile_session_status()


@router.get("/search", response_model=List[GeocodeResult])
async def search_location(q: str):
    """Return explicit, submit-based geocoding results using the configured provider."""
    return await tile_manager.search_location(q)


@router.get("/autocomplete", response_model=List[PlaceSuggestion])
async def autocomplete_location(q: str, session_token: str | None = None):
    """Return Google Places autocomplete suggestions when Google geocoding is active."""
    return await tile_manager.autocomplete_location(q, session_token)
