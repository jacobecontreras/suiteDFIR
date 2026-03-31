import logging

from fastapi import APIRouter, HTTPException, Query

from core.models import (
    DatabaseSchema,
    DatabasesResponse,
    ExportFormat,
    QueryRequest,
    QueryResult,
    TableData,
    TableDataRequest,
)
from services.db_viewer_manager import db_viewer_manager

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/db_viewer/cases/{case_id}",
    tags=["db_viewer"]
)


@router.get("/databases", response_model=DatabasesResponse)
async def get_databases(case_id: int):
    """
    Get all SQLite databases within the specified case's reports.

    Databases are discovered by scanning report directories for files
    with SQLite headers. Returns paths that include report_id prefix.
    """
    try:
        databases = await db_viewer_manager.find_databases(case_id)
        return DatabasesResponse(databases=databases)
    except Exception as e:
        logger.error(f"Error finding databases for case {case_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/databases/schema")
async def get_database_schema(
    case_id: int,
    db_path: str = Query(..., description="Relative path to database (with report_id prefix)"),
):
    """
    Get the complete schema for a specific database.

    Returns tables, indexes, views, and triggers with full metadata.
    The db_path format is "report_id/relative/path/to/database.db".
    """
    try:
        schema = await db_viewer_manager.get_database_schema(case_id, db_path)
        return schema
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting schema for {db_path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/databases/data", response_model=TableData)
async def get_table_data(
    case_id: int,
    db_path: str = Query(..., description="Relative path to database (with report_id prefix)"),
    table_name: str = Query(..., description="Name of the table"),
    page: int = Query(0, ge=0, description="Page number (0-indexed)"),
    page_size: int = Query(50, ge=1, le=1000, description="Rows per page"),
    global_filter: str = Query(None, description="Filter across all columns"),
    sort_column: str = Query(None, description="Column to sort by"),
    sort_direction: str = Query(None, regex="^(asc|desc)$", description="Sort direction"),
):
    """
    Get paginated table data with optional filtering and sorting.

    Supports global text filtering across all columns and column-based sorting.
    """
    try:
        data = await db_viewer_manager.get_table_data(
            case_id=case_id,
            relative_path=db_path,
            table_name=table_name,
            page=page,
            page_size=page_size,
            global_filter=global_filter,
            sort_column=sort_column,
            sort_direction=sort_direction,
        )
        return data
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting table data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/databases/query", response_model=QueryResult)
async def execute_query(case_id: int, request: QueryRequest, db_path: str = Query(..., description="Relative path to database (with report_id prefix)")):
    """
    Execute a read-only SQL query on the selected database.

    Only SELECT, WITH, PRAGMA, and EXPLAIN statements are allowed.
    Query execution is limited to 60 seconds and 10,000 rows for display.
    """
    try:
        result = await db_viewer_manager.execute_query(
            case_id=case_id,
            relative_path=db_path,
            sql=request.sql,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TimeoutError:
        raise HTTPException(status_code=408, detail="Query execution timed out (60s limit)")
    except Exception as e:
        logger.error(f"Error executing query: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/databases/export")
async def export_query(
    case_id: int,
    db_path: str = Query(..., description="Relative path to database (with report_id prefix)"),
    format: ExportFormat = Query(..., description="Export format (csv or json)"),
    request: QueryRequest = ...,
):
    """
    Export query results as CSV or JSON.

    Exports are limited to 100,000 rows for performance.
    Use pagination for larger datasets.
    """
    try:
        exported_data = await db_viewer_manager.export_query(
            case_id=case_id,
            relative_path=db_path,
            sql=request.sql,
            format_type=format.value,
        )
        return {"data": exported_data}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TimeoutError:
        raise HTTPException(status_code=408, detail="Export timed out (60s limit)")
    except Exception as e:
        logger.error(f"Error exporting data: {e}")
        raise HTTPException(status_code=500, detail=str(e))
