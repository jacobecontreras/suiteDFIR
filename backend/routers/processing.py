from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Dict
import asyncio
import subprocess
import os
import shutil
import uuid
import json
import sys
import sqlite3
from datetime import datetime
import logging
from database import get_db_connection

logger = logging.getLogger(__name__)
from models import ProcessRequest
from database import DB_PATH
from config import TOOLS_CONFIG
from state import plugin_loaders, available_modules, processing_tasks
from utils import broadcast_event
from tool_manager import tool_manager

router = APIRouter(
    prefix="/api/process",
    tags=["processing"]
)

@router.post("/start")
async def start_processing(request: ProcessRequest, background_tasks: BackgroundTasks):
    """Start processing with selected modules"""
    tool = request.tool.value
    if tool not in TOOLS_CONFIG:
        raise HTTPException(status_code=404, detail=f"Tool '{tool}' not found")
        
    config = TOOLS_CONFIG[tool]
    
    # Verify input path
    if not os.path.exists(request.input_path):
        raise HTTPException(status_code=400, detail="Input path does not exist")
        
    # Create output directory
    output_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports", f"{tool}-reports", request.case_name)
    os.makedirs(output_dir, exist_ok=True)
    
    # Create temporary profile file for module selection
    import tempfile
    
    # Use request.selected_modules if provided, otherwise fallback to state
    # The frontend sends selected_modules in the request, so we should prioritize that.
    modules_to_run = request.selected_modules
    if not modules_to_run and tool in available_modules:
        # Fallback to state if request list is empty (though frontend should send it)
        for module_name, module_data in available_modules[tool].items():
            if module_data.get("selected", False):
                modules_to_run.append(module_name)
    
    profile_path = None
    if modules_to_run:
        try:
            # Create temp file
            fd, profile_path = tempfile.mkstemp(suffix=config["profile_ext"], text=True)
            with os.fdopen(fd, 'w') as f:
                json.dump({
                    "leapp": tool,
                    "format_version": 1,
                    "plugins": modules_to_run
                }, f)
            logger.debug(f"Created temp profile at {profile_path} with {len(modules_to_run)} modules")
        except Exception as e:
            logger.error(f"Error creating temp profile: {e}")
            # Fallback? If we fail to create profile, we might run all modules which is not desired.
            raise HTTPException(status_code=500, detail=f"Failed to create processing profile: {e}")

    # Construct command using ToolManager path if available
    tool_path = tool_manager.get_tool_path(tool)
    if not tool_path:
        # Fallback to config path (development)
        tool_script_path = os.path.join(config["path"], config["script"])
    else:
        tool_script_path = os.path.join(str(tool_path), config["script"])

    # Build command based on environment:
    # - In bundled mode (PyInstaller): sys.executable IS the backend binary which handles --wrapper
    # - In development mode: we need to run main.py with --wrapper flag
    is_bundled = getattr(sys, 'frozen', False)
    
    if is_bundled:
        # Bundled: sys.executable is the VDF Tools Backend binary
        cmd = [
            sys.executable,
            "--wrapper",
            tool_script_path,
            "--input_path", request.input_path,
            "--output_path", output_dir
        ]
    else:
        # Development: Run main.py with wrapper flag
        main_py_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "main.py")
        cmd = [
            sys.executable,
            "-u",
            main_py_path,
            "--wrapper",
            tool_script_path,
            "--input_path", request.input_path,
            "--output_path", output_dir
        ]
    
    if profile_path:
        cmd.extend(["-m", profile_path])

    # Determine input type
    input_type = "fs"  # Default
    if os.path.isfile(request.input_path):
        lower_path = request.input_path.lower()
        if lower_path.endswith(".zip"):
            input_type = "zip"
        elif lower_path.endswith(".tar"):
            input_type = "tar"
        elif lower_path.endswith(".gz"):
            input_type = "gz"
        else:
            # iLEAPP supports 'file', aLEAPP might not. 
            if tool == "ileapp":
                input_type = "file"
    elif os.path.isdir(request.input_path):
        if tool == "ileapp":
            # Check for iTunes backup indicators
            if os.path.exists(os.path.join(request.input_path, "Manifest.plist")) or \
               os.path.exists(os.path.join(request.input_path, "Manifest.db")):
                input_type = "itunes"
            else:
                input_type = "fs"
        else:
            input_type = "fs"
            
    cmd.extend(["-t", input_type])
    
    logger.info(f"Executing {tool} command: {' '.join(cmd)}")

    if request.password:
        cmd.extend(["--itunes_password", request.password])
    
    if request.timezone:
        cmd.extend(["--timezone", request.timezone])
    
    # Generate Task ID
    task_id = str(uuid.uuid4())
    
    # Initialize task state
    processing_tasks[task_id] = {
        "queue": asyncio.Queue(),
        "status": "in_progress",
        "tool": tool,
        "case": request.case_name
    }
    
    # Start processing in background
    background_tasks.add_task(run_processing_job, task_id, cmd, tool, request.case_name, output_dir, request.case_id, profile_path, request.report_name)
    
    return {"message": f"Started {config['name']} processing", "case": request.case_name, "task_id": task_id}

async def run_processing_job(task_id, cmd, tool, case_name, output_dir, case_id, profile_path=None, user_report_name=None):
    """Run the processing job and stream logs"""
    # Track existing directories to identify the new one
    existing_dirs = set()
    if os.path.exists(output_dir):
        existing_dirs = set(os.listdir(output_dir))

    try:
        # Prepare environment with unbuffered output
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env
        )
        
        # Store process for stopping
        if task_id in processing_tasks:
            processing_tasks[task_id]["process"] = process
        
        # Stream output
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            
            log_message = line.decode().strip()
            
            # Broadcast globally
            await broadcast_event("log", {
                "tool": tool,
                "case": case_name,
                "message": log_message
            })
            
            # Send to specific task queue
            if task_id in processing_tasks:
                await processing_tasks[task_id]["queue"].put(log_message)
            
        await process.wait()
        
        # Check if cancelled
        is_cancelled = False
        if task_id in processing_tasks and processing_tasks[task_id]["status"] == "cancelled":
            is_cancelled = True

        status = "success" if process.returncode == 0 and not is_cancelled else "error"
        if is_cancelled:
            status = "cancelled"

        error_msg = None
        
        if status == "error":
            stderr_data = await process.stderr.read()
            error_msg = stderr_data.decode()
            logger.error(f"Execution failed for {tool} on {case_name}: {error_msg}")
        
        # Identify the new report directory
        new_report_path = None
        if os.path.exists(output_dir):
            current_dirs = set(os.listdir(output_dir))
            new_dirs = current_dirs - existing_dirs
            # Filter for directories only
            new_dirs = [d for d in new_dirs if os.path.isdir(os.path.join(output_dir, d))]
            if new_dirs:
                # Assuming the one with latest mtime is ours if multiple (unlikely)
                new_report_path = os.path.join(output_dir, max(new_dirs, key=lambda d: os.path.getmtime(os.path.join(output_dir, d))))

        if status == "success":
            if new_report_path:
                # Use user provided name if available, otherwise fallback to folder name
                report_name = user_report_name if user_report_name else os.path.basename(new_report_path)
                
                # Save to database
                conn = sqlite3.connect(DB_PATH)
                cursor = conn.cursor()
                try:
                    cursor.execute(
                        'INSERT INTO reports (name, path, tool, case_id) VALUES (?, ?, ?, ?)',
                        (report_name, new_report_path, tool, case_id)
                    )
                    conn.commit()
                    logger.debug(f"Saved report {report_name} to database")
                except sqlite3.IntegrityError:
                    logger.debug(f"Report {report_name} already exists in database")
                finally:
                    conn.close()
            else:
                logger.debug("No new report directory found after success")
        
        elif status in ["cancelled", "error"]:
            # Cleanup partial report
            if new_report_path and os.path.exists(new_report_path):
                try:
                    import shutil
                    shutil.rmtree(new_report_path)
                    logger.debug(f"Removed partial report directory: {new_report_path}")
                except Exception as e:
                    logger.error(f"Error removing partial report {new_report_path}: {e}")
            
            # Cleanup parent case directory if empty
            if os.path.exists(output_dir) and not os.listdir(output_dir):
                try:
                    os.rmdir(output_dir)
                    logger.debug(f"Removed empty case directory: {output_dir}")
                except Exception as e:
                    logger.error(f"Error removing empty case directory {output_dir}: {e}")

        # Notify completion
        if task_id in processing_tasks:
            await processing_tasks[task_id]["queue"].put(f"Processing {status}")
            processing_tasks[task_id]["status"] = status
            
        await broadcast_event("complete", {
            "tool": tool,
            "case": case_name,
            "status": status,
            "error": error_msg
        })
            
    except Exception as e:
        logger.error(f"Error running processing job: {e}")
        if task_id in processing_tasks:
             await processing_tasks[task_id]["queue"].put(f"Error: {str(e)}")
             processing_tasks[task_id]["status"] = "error"
             
        await broadcast_event("complete", {
            "tool": tool,
            "case": case_name,
            "status": "error",
            "error": str(e)
        })
    finally:
        # Cleanup temp profile
        if profile_path and os.path.exists(profile_path):
            try:
                os.remove(profile_path)
                logger.debug(f"Removed temp profile {profile_path}")
            except Exception as e:
                logger.error(f"Error removing temp profile {profile_path}: {e}")

@router.get("/stream/{task_id}")
async def stream_processing_logs(task_id: str):
    """SSE endpoint for real-time processing logs"""
    if task_id not in processing_tasks:
        raise HTTPException(status_code=404, detail="Task not found")
        
    async def event_generator():
        if task_id not in processing_tasks:
            return
            
        queue = processing_tasks[task_id]["queue"]
        
        while True:
            if task_id not in processing_tasks:
                break
                
            # Check if completed and empty
            if processing_tasks[task_id]["status"] in ["success", "error", "cancelled"] and queue.empty():
                yield f"event: close\ndata: Stream ended\n\n"
                break
                
            try:
                message = await asyncio.wait_for(queue.get(), timeout=1.0)
                yield f"data: {message}\n\n"
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                yield f"data: Error reading log: {str(e)}\n\n"
                break
                
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        }
    )

class StopRequest(BaseModel):
    task_id: Optional[str] = None

@router.post("/stop")
async def stop_processing(request: StopRequest = None):
    """Stop current processing job"""
    task_id = request.task_id if request else None
    
    # If no task_id provided, try to find the most recent active task
    if not task_id:
        active_tasks = [tid for tid, t in processing_tasks.items() if t["status"] == "in_progress"]
        if active_tasks:
            # Pick the last one added (assuming dict preserves insertion order or we just pick one)
            task_id = active_tasks[-1]
    
    if not task_id or task_id not in processing_tasks:
        raise HTTPException(status_code=404, detail="No active task found to stop")
        
    task = processing_tasks[task_id]
    
    if task["status"] != "in_progress":
        return {"message": "Task is not in progress"}
        
    # Mark as cancelled
    task["status"] = "cancelled"
    
    # Terminate process
    if "process" in task and task["process"]:
        try:
            task["process"].terminate()
            logger.debug(f"Terminated process for task {task_id}")
        except Exception as e:
            logger.error(f"Error terminating process: {e}")
            
    return {"message": "Processing stop requested", "task_id": task_id}
