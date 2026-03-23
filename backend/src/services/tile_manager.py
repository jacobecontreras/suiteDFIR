import logging
import re
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Dict, List, Literal, Optional

import httpx
from fastapi import HTTPException

from core.models import GeocodeResult, PlaceSuggestion, TileSessionRequest, TileViewportRequest
from services.settings_manager import settings_manager

logger = logging.getLogger(__name__)

# Nominatim configuration (OpenStreetMap geocoding)
DEFAULT_NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"
DEFAULT_NOMINATIM_USER_AGENT = "suiteDFIR/1.0 (+https://github.com/jacobcontreras/suiteDFIR)"
DEFAULT_GEOCODER_PROVIDER = "nominatim"

# Constants
MAX_SESSIONS = 10
EXPIRY_SAFETY_BUFFER = 3600
MAX_GEOCODE_RESULTS = 5
NOMINATIM_QUERY_CACHE_TTL_SECONDS = 300
MAX_QUERY_CACHE_ENTRIES = 100
RATE_LIMIT_WINDOW_SECONDS = 60
MAX_GEOCODE_REQUESTS = 20
MAX_AUTOCOMPLETE_REQUESTS = 60
GOOGLE_API_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,}$")


@dataclass
class CachedSession:
    """Cached tile session with expiry tracking."""
    session: str
    key: str
    expiry: int
    map_type: str
    tile_width: int
    tile_height: int


@dataclass
class CachedQueryResult:
    """Cached geocode result."""
    value: list
    expiry: float


class TileManager:
    """Manages Google Maps Tile API sessions, caching, and location search."""

    def __init__(self):
        # In-memory LRU cache
        self._session_cache: OrderedDict[str, CachedSession] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._geocode_cache: OrderedDict[str, CachedQueryResult] = OrderedDict()
        self._autocomplete_cache: OrderedDict[str, CachedQueryResult] = OrderedDict()

        # Shared HTTP client for connection pooling
        self._http_client: Optional[httpx.AsyncClient] = None

        # Simple rate limit tracking
        self._geocode_request_times: List[float] = []
        self._autocomplete_request_times: List[float] = []

    def get_http_client(self) -> httpx.AsyncClient:
        """Get or create the shared HTTP client."""
        if self._http_client is None:
            with self._cache_lock:
                if self._http_client is None:
                    self._http_client = httpx.AsyncClient(
                        timeout=httpx.Timeout(10.0, connect=5.0),
                        limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
                    )
        return self._http_client

    async def close_http_client(self):
        """Close the shared HTTP client."""
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None
            logger.debug("TileManager HTTP client closed")

    def sync_close_on_exit(self):
        """Synchronous wrapper for clean up."""
        if self._http_client is not None:
            self._http_client = None

    def _get_cache_key(self, request: TileSessionRequest) -> str:
        """Generate cache key from session configuration parameters."""
        layer_types_str = ",".join(sorted(request.layerTypes)) if request.layerTypes else ""
        overlay_str = str(request.overlay) if request.overlay is not None else ""
        return f"{request.mapType}:{request.language}:{request.region}:{layer_types_str}:{overlay_str}"

    def _is_session_valid(self, cached: CachedSession) -> bool:
        """Check if cached session is still valid."""
        current_time = int(time.time())
        return current_time < (int(cached.expiry) - EXPIRY_SAFETY_BUFFER)

    def _cleanup_expired(self):
        """Remove expired sessions from cache."""
        expired_keys = [k for k, v in self._session_cache.items() if not self._is_session_valid(v)]
        for key in expired_keys:
            self._session_cache.pop(key, None)
        if expired_keys:
            logger.debug(f"Cleaned up {len(expired_keys)} expired tile sessions")

    def _evict_if_needed(self):
        """LRU eviction: remove oldest entries when cache is full."""
        evicted = 0
        while len(self._session_cache) >= MAX_SESSIONS:
            # popitem(last=False) removes the first inserted (oldest) item
            self._session_cache.popitem(last=False)
            evicted += 1
        if evicted:
            logger.debug(f"LRU evicted {evicted} tile sessions")

    def _normalize_query(self, query: str) -> str:
        return " ".join(query.strip().lower().split())

    def _cleanup_query_cache(self, cache: OrderedDict[str, CachedQueryResult]):
        now = time.time()
        expired_keys = [key for key, value in cache.items() if value.expiry <= now]
        for key in expired_keys:
            cache.pop(key, None)

    def _get_cached_query(self, cache: OrderedDict[str, CachedQueryResult], key: str):
        with self._cache_lock:
            self._cleanup_query_cache(cache)
            cached = cache.get(key)
            if not cached:
                return None
            cache.move_to_end(key)
            return cached.value

    def _set_cached_query(self, cache: OrderedDict[str, CachedQueryResult], key: str, value: list):
        with self._cache_lock:
            self._cleanup_query_cache(cache)
            while len(cache) >= MAX_QUERY_CACHE_ENTRIES:
                cache.popitem(last=False)
            cache[key] = CachedQueryResult(
                value=value,
                expiry=time.time() + NOMINATIM_QUERY_CACHE_TTL_SECONDS,
            )
            cache.move_to_end(key)

    def _check_rate_limit(self, request_times: List[float], max_requests: int):
        """Simple global rate limiting."""
        now = time.time()
        window_start = now - RATE_LIMIT_WINDOW_SECONDS

        with self._cache_lock:
            # Remove timestamps outside the window
            while request_times and request_times[0] < window_start:
                request_times.pop(0)

            if len(request_times) >= max_requests:
                raise HTTPException(
                    status_code=429,
                    detail="Too many spatial requests. Please wait a moment and try again.",
                )
            request_times.append(now)

    def _validate_api_key_format(self, api_key: str):
        if not GOOGLE_API_KEY_PATTERN.match(api_key.strip()):
            raise HTTPException(status_code=400, detail="API key format looks invalid")

    async def _get_nominatim_base_url(self) -> str:
        configured = await settings_manager.get_setting("nominatim_base_url")
        if configured and configured.strip():
            return configured.strip().rstrip("/")
        return DEFAULT_NOMINATIM_BASE_URL

    async def _get_nominatim_user_agent(self) -> str:
        configured = await settings_manager.get_setting("nominatim_user_agent")
        if configured and configured.strip():
            return configured.strip()
        return DEFAULT_NOMINATIM_USER_AGENT

    async def _get_geocoder_provider(self) -> Literal["google", "nominatim"]:
        configured = await settings_manager.get_setting("geocoder_provider")
        if configured in {"google", "nominatim"}:
            return configured
        return DEFAULT_GEOCODER_PROVIDER

    async def _get_effective_geocoder_provider(self, basemap: Optional[str] = None) -> Literal["google", "nominatim"]:
        configured = await self._get_geocoder_provider()
        if basemap == "google":
            return configured
        return "nominatim" if configured == "google" else configured

    async def create_tile_session(self, request: TileSessionRequest) -> dict:
        """Create or return a cached Google Maps Tile session."""
        cache_key = self._get_cache_key(request)

        # 1. Check Cache
        with self._cache_lock:
            self._cleanup_expired()
            if cache_key in self._session_cache:
                cached = self._session_cache[cache_key]
                if self._is_session_valid(cached):
                    self._session_cache.move_to_end(cache_key) # Mark as recently used
                    logger.debug(f"Returning cached tile session for {cache_key}")
                    return {
                        "session": cached.session,
                        "expiry": cached.expiry,
                        "key": cached.key,
                        "tileWidth": cached.tile_width,
                        "tileHeight": cached.tile_height,
                    }

        # 2. Fetch API Key
        api_key = await settings_manager.get_setting("google_maps_api_key")
        if not api_key:
            raise HTTPException(status_code=400, detail="Google Maps API key not configured. Set it in Settings.")

        # 3. Request New Session
        url = f"https://tile.googleapis.com/v1/createSession?key={api_key}"
        payload = {
            "mapType": request.mapType,
            "language": request.language,
            "region": request.region,
        }
        if request.layerTypes:
            payload["layerTypes"] = request.layerTypes
        if request.overlay is not None:
            payload["overlay"] = request.overlay

        client = self.get_http_client()
        try:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()

            # Ensure expiry exists and is valid
            try:
                session_expiry = int(data.get("expiry", time.time() + 86400)) # Default 24h
            except (ValueError, TypeError):
                session_expiry = int(time.time() + 86400)

            tile_width = data.get("tileWidth", 256)
            tile_height = data.get("tileHeight", 256)
            session_token = data.get("session")

            if not session_token:
                raise ValueError("Response missing session token")

            cached_session = CachedSession(
                session=session_token,
                key=api_key,
                expiry=session_expiry,
                map_type=request.mapType,
                tile_width=tile_width,
                tile_height=tile_height,
            )

            # 4. Store in Cache
            with self._cache_lock:
                self._evict_if_needed()
                self._session_cache[cache_key] = cached_session
                self._session_cache.move_to_end(cache_key)

            logger.info(f"Cached new tile session for {cache_key}, expiry: {session_expiry}")

            return {
                "session": session_token,
                "expiry": session_expiry,
                "key": api_key,
                "tileWidth": tile_width,
                "tileHeight": tile_height,
            }

        except httpx.HTTPStatusError as e:
            logger.error(f"Google Tile API error: {e.response.status_code} - {e.response.text}")
            raise HTTPException(status_code=502, detail="Google Maps Tile API error")
        except Exception as e:
            logger.error(f"Tile session creation failed: {e}")
            raise HTTPException(status_code=500, detail="Failed to create tile session")

    async def invalidate_tile_session(self, request: TileSessionRequest) -> dict:
        """Invalidate a specific cached session."""
        cache_key = self._get_cache_key(request)

        with self._cache_lock:
            if cache_key in self._session_cache:
                del self._session_cache[cache_key]
                logger.info(f"Invalidated tile session for {cache_key}")
                return {"message": "Session invalidated", "cacheKey": cache_key}

        return {"message": "No cached session found", "cacheKey": cache_key}

    async def get_tile_session_status(self) -> dict:
        """Get diagnostic status of cached sessions."""
        current_time = int(time.time())

        with self._cache_lock:
            self._cleanup_expired()
            cache_snapshot = dict(self._session_cache)
            cache_count = len(self._session_cache)

        status = {}
        for cache_key, cached in cache_snapshot.items():
            remaining_seconds = cached.expiry - current_time
            status[cache_key] = {
                "mapType": cached.map_type,
                "expiry": cached.expiry,
                "remainingSeconds": remaining_seconds,
                "isValid": self._is_session_valid(cached),
            }

        return {
            "cachedSessions": cache_count,
            "maxSessions": MAX_SESSIONS,
            "sessions": status,
        }

    async def search_location(self, query: str, basemap: Optional[str] = None) -> List[GeocodeResult]:
        """Return geocoding results using a basemap-compliant provider."""
        self._check_rate_limit(self._geocode_request_times, MAX_GEOCODE_REQUESTS)

        cache_key = self._normalize_query(query)
        provider = await self._get_effective_geocoder_provider(basemap)
        should_cache = provider == "nominatim"
        if should_cache:
            cached = self._get_cached_query(self._geocode_cache, cache_key)
            if cached is not None:
                return cached

        api_key = await settings_manager.get_setting("google_maps_api_key")

        if provider == "google" and api_key:
            results = await self._google_geocode(query, api_key)
        else:
            if provider == "google" and not api_key:
                logger.warning("Google geocoder selected without API key; falling back to Nominatim")
            results = await self._nominatim_geocode(query)

        if should_cache:
            self._set_cached_query(self._geocode_cache, cache_key, results)
        return results

    async def autocomplete_location(self, query: str, session_token: Optional[str] = None, basemap: Optional[str] = None) -> List[PlaceSuggestion]:
        """Return autocomplete suggestions only for Google Places."""
        normalized_query = self._normalize_query(query)
        if len(normalized_query) < 3:
            return []

        provider = await self._get_effective_geocoder_provider(basemap)
        api_key = await settings_manager.get_setting("google_maps_api_key")
        if provider != "google" or not api_key:
            return []

        self._check_rate_limit(self._autocomplete_request_times, MAX_AUTOCOMPLETE_REQUESTS)

        client = self.get_http_client()
        try:
            payload = {
                "input": query.strip(),
                "languageCode": "en",
                "includedRegionCodes": ["us"],
            }
            if session_token:
                payload["sessionToken"] = session_token

            response = await client.post(
                "https://places.googleapis.com/v1/places:autocomplete",
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": api_key,
                    "X-Goog-FieldMask": ",".join([
                        "suggestions.placePrediction.placeId",
                        "suggestions.placePrediction.text.text",
                        "suggestions.placePrediction.structuredFormat.mainText.text",
                        "suggestions.placePrediction.structuredFormat.secondaryText.text",
                    ]),
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

            results: List[PlaceSuggestion] = []
            for item in data.get("suggestions", []):
                prediction = item.get("placePrediction")
                if not prediction:
                    continue

                place_id = prediction.get("placeId")
                display_name = prediction.get("text", {}).get("text", "")
                if not place_id or not display_name:
                    continue

                structured = prediction.get("structuredFormat", {})
                results.append(
                    PlaceSuggestion(
                        place_id=place_id,
                        display_name=display_name,
                        primary_text=structured.get("mainText", {}).get("text"),
                        secondary_text=structured.get("secondaryText", {}).get("text"),
                    )
                )

                if len(results) >= MAX_GEOCODE_RESULTS:
                    break
            return results
        except httpx.HTTPStatusError as e:
            logger.error(f"Google Places Autocomplete API error: {e.response.status_code} - {e.response.text}")
            return []
        except Exception as e:
            logger.error(f"Autocomplete proxy failed: {e}")
            return []

    async def get_tile_attribution(self, request: TileViewportRequest) -> dict:
        """Return the current Google Maps viewport attribution string."""
        session = await self.create_tile_session(
            TileSessionRequest(
                mapType=request.mapType,
                language=request.language,
                region=request.region,
                layerTypes=request.layerTypes,
                overlay=request.overlay,
            )
        )
        client = self.get_http_client()
        try:
            response = await client.get(
                "https://tile.googleapis.com/tile/v1/viewport",
                params={
                    "session": session["session"],
                    "key": session["key"],
                    "zoom": request.zoom,
                    "north": request.north,
                    "south": request.south,
                    "east": request.east,
                    "west": request.west,
                },
            )
            response.raise_for_status()
            data = response.json()
            copyright_text = data.get("copyright")
            if not copyright_text:
                raise HTTPException(status_code=502, detail="Google viewport attribution was empty")
            return {"copyright": copyright_text}
        except httpx.HTTPStatusError as e:
            logger.error(f"Google viewport attribution error: {e.response.status_code} - {e.response.text}")
            raise HTTPException(status_code=502, detail="Google viewport attribution failed")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Viewport attribution proxy failed: {e}")
            raise HTTPException(status_code=500, detail="Viewport attribution failed")

    async def _google_geocode(self, query: str, api_key: str) -> List[GeocodeResult]:
        """Query Google Geocoding API."""
        url = "https://maps.googleapis.com/maps/api/geocode/json"
        params = {
            "address": query,
            "key": api_key,
        }

        client = self.get_http_client()
        try:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            if data.get("status") != "OK" or not data.get("results"):
                return []

            results = []
            for result in data["results"][:MAX_GEOCODE_RESULTS]:
                loc = result["geometry"]["location"]
                results.append(GeocodeResult(
                    lat=str(loc["lat"]),
                    lon=str(loc["lng"]),
                    display_name=result.get("formatted_address", ""),
                ))
            return results
        except httpx.HTTPStatusError as e:
            logger.error(f"Google Geocoding API error: {e.response.status_code} - {e.response.text}")
            raise HTTPException(status_code=502, detail="Location search service error")
        except Exception as e:
            logger.error(f"Search proxy failed: {e}")
            raise HTTPException(status_code=500, detail="Location search failed")

    async def _nominatim_geocode(self, query: str) -> List[GeocodeResult]:
        """Query Nominatim (OSM) geocoding API."""
        client = self.get_http_client()
        base_url = await self._get_nominatim_base_url()
        user_agent = await self._get_nominatim_user_agent()
        try:
            response = await client.get(
                f"{base_url}/search",
                params={
                    "q": query,
                    "format": "json",
                    "limit": MAX_GEOCODE_RESULTS,
                },
                headers={"User-Agent": user_agent}
            )
            response.raise_for_status()
            data = response.json()

            if not data:
                return []

            results = []
            for result in data[:MAX_GEOCODE_RESULTS]:
                results.append(GeocodeResult(
                    lat=str(result.get("lat", "")),
                    lon=str(result.get("lon", "")),
                    display_name=result.get("display_name", ""),
                ))
            return results
        except httpx.HTTPStatusError as e:
            logger.error(f"Nominatim geocoding API error: {e.response.status_code}")
            return []
        except Exception as e:
            logger.error(f"Nominatim search proxy failed: {e}")
            return []

    async def verify_google_maps_api_key(self, api_key: str) -> dict:
        """Verify an API key against the Google services used by the spatial view."""
        cleaned_key = api_key.strip()
        self._validate_api_key_format(cleaned_key)

        client = self.get_http_client()

        try:
            # Test tile session creation
            tile_response = await client.post(
                f"https://tile.googleapis.com/v1/createSession?key={cleaned_key}",
                json={"mapType": "roadmap", "language": "en", "region": "US"},
                timeout=5.0,
            )
            tile_response.raise_for_status()
            tile_data = tile_response.json()
            if not tile_data.get("session"):
                return {
                    "valid": False,
                    "message": "API key does not support Maps Tile API.",
                }

            # Test geocoding
            geocode_response = await client.get(
                "https://maps.googleapis.com/maps/api/geocode/json",
                params={"address": "New York, NY", "key": cleaned_key},
                timeout=5.0,
            )
            geocode_response.raise_for_status()
            geocode_data = geocode_response.json()
            if geocode_data.get("status") != "OK":
                return {
                    "valid": False,
                    "message": "API key does not support Geocoding API.",
                }

            # Test places autocomplete
            places_response = await client.post(
                "https://places.googleapis.com/v1/places:autocomplete",
                headers={
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": cleaned_key,
                    "X-Goog-FieldMask": "suggestions.placePrediction.placeId",
                },
                json={"input": "New York"},
                timeout=5.0,
            )
            places_response.raise_for_status()
            places_data = places_response.json()
            if "suggestions" not in places_data:
                return {
                    "valid": False,
                    "message": "API key does not support Places Autocomplete API.",
                }

            return {
                "valid": True,
                "message": "API key verified successfully.",
            }
        except httpx.HTTPStatusError as e:
            logger.error(f"Google API key verification failed: {e.response.status_code}")
            return {
                "valid": False,
                "message": "Google rejected the API key. Please check the key and enable required APIs.",
            }
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"API key verification failed: {e}")
            return {
                "valid": False,
                "message": "Unable to verify the API key right now.",
            }


# Export singleton instance
tile_manager = TileManager()
