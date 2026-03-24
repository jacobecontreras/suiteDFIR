import logging

from fastapi import APIRouter, HTTPException

from core.models import ApiKeyVerificationResponse, SettingValue
from services.settings_manager import settings_manager
from services.tile_manager import tile_manager

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/settings",
    tags=["settings"]
)


@router.post("/verify/google-maps-key", response_model=ApiKeyVerificationResponse)
async def verify_google_maps_api_key(body: SettingValue):
    """Verify a Google Maps API key before persisting it."""
    return ApiKeyVerificationResponse.model_validate(
        await tile_manager.verify_google_maps_api_key(body.value)
    )


@router.get("/{key}")
async def get_setting(key: str):
    """Get a setting by key."""
    value = await settings_manager.get_setting(key)
    if value is None:
        raise HTTPException(status_code=404, detail="Setting not found")
    return {"key": key, "value": value}


@router.put("/{key}")
async def set_setting(key: str, body: SettingValue):
    """Create or update a setting."""
    await settings_manager.set_setting(key, body.value)
    return {"key": key, "value": body.value}


@router.delete("/{key}")
async def delete_setting(key: str):
    """Delete a setting by key. Idempotent: returns 200 whether or not key existed."""
    await settings_manager.delete_setting(key)
    return {"message": "Setting deleted"}
