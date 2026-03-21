import logging
import os
import shutil
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Response
from fastapi.responses import FileResponse

from core.config import REPORTS_DIR
from core.models import MessageResponse, Report
from services.report_manager import report_manager
from utils.helpers import handle_open_path_request

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/reports",
    tags=["reports"]
)


@router.get("", response_model=list[Report])
async def get_reports(case_id: Optional[int] = None):
    """Get list of reports from database"""
    rows = await report_manager.get_reports(case_id)
    return [Report.model_validate(row) for row in rows]


@router.delete("/{id}", response_model=MessageResponse)
async def delete_report(id: int):
    """Delete a report from database and filesystem"""
    try:
        return MessageResponse.model_validate(await report_manager.delete_report(id))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        logger.error(f"Error deleting report: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{id}/open", response_model=MessageResponse)
async def open_report(id: int):
    """Open report folder in system file explorer"""
    report = await report_manager.get_report(id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
        
    return MessageResponse.model_validate(handle_open_path_request(report['path'], REPORTS_DIR, "Report"))


@router.get("/{id}/download")
async def download_report(id: int, background_tasks: BackgroundTasks):
    """Zip and download report directory"""
    try:
        result = await report_manager.create_zip_archive(id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Schedule cleanup of the temp directory containing the zip
    zip_path = result["zip_path"]
    temp_dir = os.path.dirname(zip_path)
    background_tasks.add_task(shutil.rmtree, temp_dir, ignore_errors=True)

    return FileResponse(
        zip_path,
        media_type='application/zip',
        filename=result["filename"]
    )

@router.post("/{id}/open-log", response_model=MessageResponse)
async def open_report_log(id: int):
    """Open the processing.log file for a report in the system's default text editor."""
    report = await report_manager.get_report(id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    log_path = os.path.join(report['path'], "processing.log")
    if not os.path.exists(log_path):
        raise HTTPException(status_code=404, detail="Log file not found for this report")

    return MessageResponse.model_validate(
        handle_open_path_request(log_path, REPORTS_DIR, "Log file")
    )


@router.get("/{id}/view/{file_path:path}")
async def serve_report_file(id: int, file_path: str):
    """Serve report files with scroll tracking script injection for HTML files"""
    try:
        result = await report_manager.prepare_report_file(id, file_path)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except RuntimeError as e:
         raise HTTPException(status_code=500, detail=str(e))

    if result.get("is_html"):
        return Response(
            content=result["content"],
            media_type=result["media_type"],
            headers=result["headers"]
        )

    return FileResponse(result["file_path"], media_type=result["media_type"])
