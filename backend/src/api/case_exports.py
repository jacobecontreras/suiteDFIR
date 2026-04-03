import logging
import os
from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse

from core.models import ExportStarted
from core.database import db_fetch_one
from services.export_manager import export_manager
from utils.sse import create_task_sse_response
from core.state import export_tasks

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/cases",
    tags=["case_exports"]
)


@router.post("/{case_id}/export", response_model=ExportStarted)
async def create_export(case_id: int, background_tasks: BackgroundTasks):
    """Create a new export job for a case (all completed backups + reports)."""
    try:
        result = await export_manager.create_export_job(case_id)
        job_id = result["job_id"]

        # Start processing in background
        background_tasks.add_task(export_manager.start_export_processing, job_id)

        return ExportStarted(job_id=job_id, message="Export job created")
    except ValueError as e:
        if "already in progress" in str(e):
            raise HTTPException(status_code=409, detail=str(e))
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{case_id}/export/{job_id}/stream")
async def stream_export_status(case_id: int, job_id: int):
    """Stream export job status via SSE."""
    # Verify job belongs to this case
    job = await export_manager.get_export_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    if job['case_id'] != case_id:
        raise HTTPException(status_code=403, detail="Job does not belong to this case")

    # Create a task dict for SSE streaming
    if job_id not in export_tasks:
        export_tasks[job_id] = {
            'queue': None,
            'status': job['status']
        }

    return create_task_sse_response(
        task_id=job_id,
        task_dict=export_tasks,
        terminal_statuses=["completed", "failed"],
        cleanup=False
    )


@router.get("/{case_id}/export/{job_id}/download")
async def download_export(case_id: int, job_id: int):
    """Download the completed export ZIP file."""
    job = await export_manager.get_export_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    if job['case_id'] != case_id:
        raise HTTPException(status_code=403, detail="Job does not belong to this case")

    if job['status'] != 'completed':
        raise HTTPException(status_code=400, detail="Export is not completed yet")

    file_path = job.get('file_path')
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Export file not found (may have expired)")

    # Generate filename from case name
    case = await db_fetch_one('SELECT name FROM cases WHERE id = ?', (case_id,))
    case_name = case['name'] if case else f"case_{case_id}"

    filename = os.path.basename(file_path)

    return FileResponse(
        file_path,
        media_type='application/zip',
        filename=filename
    )
