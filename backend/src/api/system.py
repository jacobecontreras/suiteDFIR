import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, File, UploadFile
from fastapi.responses import Response

from core.models import (
    FilePathResponse,
    HealthResponse,
    KmlFilesResponse,
    KmlImportResponse,
    MessageResponse,
    RootResponse,
    StorageUsage,
    SystemHealthMetrics,
)
from core.state import event_clients
from services.spatial_manager import spatial_manager
from services.system_manager import system_manager
from utils.sse import create_client_sse_response, create_sse_response

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/api",
    tags=["system"]
)


# Root & Health

@router.get("/", response_model=RootResponse)
async def root():
    return RootResponse.model_validate(await system_manager.get_root_info())


@router.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse.model_validate(await system_manager.get_health_check())


# File Dialogs

@router.post("/browse-files", response_model=FilePathResponse)
async def browse_files():
    """Open native file dialog to select forensic files."""
    result = await system_manager.open_file_dialog()
    return FilePathResponse(**result)


@router.post("/browse-folders", response_model=FilePathResponse)
async def browse_folders():
    """Open native folder dialog to select output directory."""
    result = await system_manager.open_folder_dialog()
    return FilePathResponse(**result)


# System Metrics

@router.get("/system/health", response_model=SystemHealthMetrics)
async def get_system_health():
    return SystemHealthMetrics.model_validate(await system_manager.get_health_metrics())


@router.get("/system/storage", response_model=StorageUsage)
async def get_storage_usage(case_id: Optional[int] = None):
    return StorageUsage.model_validate(await system_manager.get_storage_usage(case_id))


# SSE Streaming

@router.get("/stream")
async def stream_events():
    """Unified SSE endpoint for real-time updates"""
    return create_client_sse_response(event_clients)


# Spatial / KML

@router.get("/spatial/kml-files", response_model=KmlFilesResponse)
async def get_kml_files(case_id: Optional[int] = None):
    """Scan reports directory for KML files, optionally filtered by case_id."""
    files = await spatial_manager.get_kml_files(case_id)
    return KmlFilesResponse(files=files)


@router.get("/spatial/kml-data")
async def get_kml_data(path: str):
    """Fetch and enrich KML data with TSV content."""
    try:
        kml_bytes = await spatial_manager.get_kml_data(path)
        return Response(
            content=kml_bytes,
            media_type="application/vnd.google-earth.kml+xml"
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="KML file not found")
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))


@router.post("/spatial/import", response_model=KmlImportResponse)
async def import_kml_file(
    file: UploadFile = File(...),
):
    """Upload and save a KML/KMZ file to the imports directory."""
    if not file.filename.lower().endswith(('.kml', '.kmz')):
        raise HTTPException(status_code=400, detail="Only .kml and .kmz files are allowed")

    try:
        content = await file.read()
        saved_name = await spatial_manager.save_imported_file(content, file.filename)
        return KmlImportResponse(message="File imported successfully", filename=saved_name)
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))
    except Exception as e:
        logger.error(f"Import failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to save file")


@router.delete("/spatial/import/{filename}", response_model=MessageResponse)
async def delete_imported_file(filename: str):
    """Delete a file from the imports directory."""
    try:
        deleted = await spatial_manager.delete_imported_file(filename)
        if not deleted:
            raise HTTPException(status_code=404, detail="File not found")
        return MessageResponse(message="File deleted successfully")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete file")


# Shutdown

@router.post("/shutdown", response_model=MessageResponse)
async def shutdown():
    """Gracefully shutdown the backend server"""
    return MessageResponse.model_validate(await system_manager.shutdown_backend())
