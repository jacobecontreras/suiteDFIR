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
    TileViewportRequest,
    TileViewportResponse,
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
    """Create a Google tile session for the renderer.

    The browser still needs the restricted API key for Google tile requests.
    Session creation and caching remain server-managed.
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
async def search_location(q: str, basemap: str | None = None):
    """Return explicit geocoding results using a basemap-compliant provider."""
    return await tile_manager.search_location(q, basemap)


@router.get("/autocomplete", response_model=List[PlaceSuggestion])
async def autocomplete_location(q: str, session_token: str | None = None, basemap: str | None = None):
    """Return Google Places autocomplete suggestions only when a Google basemap is active."""
    return await tile_manager.autocomplete_location(q, session_token, basemap)


@router.post("/tile-attribution", response_model=TileViewportResponse)
async def get_tile_attribution(body: TileViewportRequest):
    """Return viewport-specific attribution for the active Google tiles."""
    return TileViewportResponse.model_validate(await tile_manager.get_tile_attribution(body))
