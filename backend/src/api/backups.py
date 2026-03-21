import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
import os

from core.config import BACKUPS_DIR
from core.database import db_fetch_one
from core.models import (
    BackupInfo,
    BackupRequest,
    BackupStarted,
    BackupValidation,
    DeviceInfo,
    MessageResponse,
    ValidateBackupRequest,
)
from core.state import backup_tasks
from services.backup_manager import backup_manager
from utils.helpers import handle_open_path_request
from utils.sse import create_task_sse_response

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/backups",
    tags=["backups"]
)


# iOS Device Operations


@router.get("/devices", response_model=list[DeviceInfo])
async def list_devices():
    """List connected iOS devices"""
    return await backup_manager.get_devices()

@router.post("/validate", response_model=BackupValidation)
async def validate_backup(request: ValidateBackupRequest):
    """Validate iOS backup path and check for encryption status."""
    try:
        return await backup_manager.validate_backup(request.input_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))


# Backup Operations

@router.post("", response_model=BackupStarted)
async def start_backup(request: BackupRequest, background_tasks: BackgroundTasks):
    """Start an iOS backup process for a specific device and case."""
    try:
        result = await backup_manager.start_backup(request, background_tasks)
        return BackupStarted.model_validate(result)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{backup_id}/stream")
async def stream_backup_logs(backup_id: int):
    """Stream real-time backup logs and progress via SSE."""
    if backup_id not in backup_tasks:
        raise HTTPException(status_code=404, detail="Backup task not found")

    return create_task_sse_response(
        task_id=backup_id,
        task_dict=backup_tasks,
        terminal_statuses=["completed", "failed", "cancelled"],
        cleanup=False
    )

@router.get("/{backup_id}/log")
async def get_backup_log(backup_id: int):
    """Retrieve the historical processing log for a backup."""
    row = await db_fetch_one("SELECT path FROM backups WHERE id = ?", (backup_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Backup not found")
        
    log_path = os.path.join(row['path'], "processing.log")
    if not os.path.exists(log_path):
        raise HTTPException(status_code=404, detail="Log file not found")
        
    return FileResponse(log_path, media_type="text/plain")

@router.post("/{backup_id}/open-log", response_model=MessageResponse)
async def open_backup_log(backup_id: int):
    """Open the location containing processing.log for a backup in the system file explorer."""
    row = await db_fetch_one("SELECT path FROM backups WHERE id = ?", (backup_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Backup not found")

    log_path = os.path.join(row['path'], "processing.log")
    if not os.path.exists(log_path):
        raise HTTPException(status_code=404, detail="Log file not found for this backup")

    return MessageResponse.model_validate(
        handle_open_path_request(row['path'], BACKUPS_DIR, "Log location")
    )


@router.post("/{backup_id}/stop", response_model=MessageResponse)
async def stop_backup(backup_id: int):
    """Stop an active backup process and update status."""
    result = await backup_manager.stop_backup(backup_id)
    return MessageResponse.model_validate(result)

# Backup Management

@router.get("", response_model=list[BackupInfo])
async def get_backups(case_id: Optional[int] = None):
    """Retrieve a list of backups associated with a specific case."""
    return await backup_manager.get_backups(case_id)

@router.delete("/{backup_id}", response_model=MessageResponse)
async def delete_backup(backup_id: int):
    """Delete a backup record and its associated files from disk."""
    try:
        result = await backup_manager.delete_backup_by_id(backup_id)
        return MessageResponse.model_validate(result)
    except (FileNotFoundError, ValueError):
        raise HTTPException(status_code=404, detail="Backup not found")

@router.post("/open", response_model=MessageResponse)
async def open_backup_location(path: str):
    """Open the backup directory in the system file explorer."""
    return handle_open_path_request(path, BACKUPS_DIR, "Backup")
