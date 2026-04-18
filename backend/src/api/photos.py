import asyncio
import logging
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from core.models import (
    PhotoExtractionRequest,
    PhotoExtractionStarted,
    PhotoExtraction,
    PhotoListResponse,
    PhotoSearchRequest,
    PhotoSearchResponse,
    PhotoThumbnailWarmRequest,
    ModelStatusResponse,
    MessageResponse,
)
from core.state import photos_tasks
from services.photos_manager import photos_manager
from utils.sse import create_task_sse_response

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/photos",
    tags=["photos"]
)


@router.post("/extract", response_model=PhotoExtractionStarted)
async def start_extraction(request: PhotoExtractionRequest):
    """Start photo extraction from a backup."""
    try:
        result = await photos_manager.start_extraction(
            backup_id=request.backup_id,
            case_id=request.case_id,
            password=request.password,
            name=request.name,
            selected_artifacts=request.selected_artifacts,
        )
        return PhotoExtractionStarted(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/extract/stream/{task_id}")
async def stream_extraction_logs(task_id: str):
    """SSE endpoint for real-time extraction progress."""
    if task_id not in photos_tasks:
        raise HTTPException(status_code=404, detail="Task not found")

    return create_task_sse_response(
        task_id=task_id,
        task_dict=photos_tasks,
        terminal_statuses=["success", "error"],
        cleanup=False,
    )


@router.get("/extractions", response_model=list[PhotoExtraction])
async def list_extractions(case_id: int = Query(...)):
    """List all photo extractions for a case."""
    rows = await photos_manager.get_extractions(case_id)
    return [PhotoExtraction(**r) for r in rows]


@router.delete("/extractions/{extraction_id}", response_model=MessageResponse)
async def delete_extraction(extraction_id: int):
    """Delete a photo extraction and its files."""
    try:
        result = await photos_manager.delete_extraction(extraction_id)
        return MessageResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/extractions/{extraction_id}/photos", response_model=PhotoListResponse)
async def get_photos(
    extraction_id: int,
    page: int = Query(0, ge=0),
    page_size: int = Query(100, ge=1, le=500),
    sort: str = Query("newest"),
    media_type: Optional[str] = Query(None),
    has_gps: Optional[bool] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    classification: Optional[str] = Query(None),
):
    """Get paginated photos with optional filters."""
    try:
        result = await photos_manager.get_photos(
            extraction_id=extraction_id,
            page=page,
            page_size=page_size,
            sort=sort,
            media_type=media_type,
            has_gps=has_gps,
            date_from=date_from,
            date_to=date_to,
            classification=classification,
        )
        return PhotoListResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/extractions/{extraction_id}/search", response_model=PhotoSearchResponse)
async def search_photos(extraction_id: int, request: PhotoSearchRequest):
    """Semantic search within an extraction using CLIP."""
    try:
        result = await photos_manager.search_photos(
            extraction_id=extraction_id,
            query=request.query,
            threshold=request.threshold,
        )
        return PhotoSearchResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/extractions/{extraction_id}/reindex", response_model=MessageResponse)
async def reindex_extraction(extraction_id: int):
    """Rebuild the CLIP search index for an extraction."""
    try:
        result = await photos_manager.reindex(extraction_id)
        return MessageResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/extractions/{extraction_id}/thumbnails/warm", response_model=MessageResponse)
async def warm_thumbnails(extraction_id: int, request: PhotoThumbnailWarmRequest):
    """Schedule thumbnail generation for a batch of photos."""
    try:
        scheduled = await photos_manager.schedule_thumbnail_warmup(extraction_id, request.file_ids)
        return MessageResponse(message=f"Scheduled {scheduled} thumbnails for warmup")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/extractions/{extraction_id}/thumbnail/{file_id}")
async def get_thumbnail(extraction_id: int, file_id: str):
    """Get or generate a thumbnail for a photo on-demand."""
    try:
        thumb_path = await photos_manager.get_or_create_thumbnail(extraction_id, file_id)
        return FileResponse(
            thumb_path,
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found")


@router.get("/extractions/{extraction_id}/image/{file_id}")
async def get_browser_image(extraction_id: int, file_id: str):
    """Get a browser-safe image for previewing a photo."""
    try:
        image_path, media_type = await photos_manager.get_browser_image(extraction_id, file_id)
        return FileResponse(
            image_path,
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found")




@router.get("/model/status", response_model=ModelStatusResponse)
async def get_model_status():
    """Check if the CLIP model is downloaded."""
    return ModelStatusResponse(**photos_manager.get_model_status())
