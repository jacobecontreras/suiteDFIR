"""API tests for src/api/photos.py."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from PIL import Image


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------
def _make_jpeg(path: Path, size=(8, 8), color="green"):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(str(path), "JPEG")


async def _insert_case(name: str = "PhotosApi") -> int:
    from services.case_manager import case_manager
    return await case_manager.create_case({
        "name": name,
        "case_number": "C-API",
        "client_name": "x",
        "client_phone": "+1-555-0123",
        "client_email": "x@example.com",
        "description": "d",
        "status": "Active",
        "priority": "Medium",
    })


async def _insert_extraction(case_id: int, output_path: str, *, status="completed",
                             image_count=0, indexed=0) -> int:
    from core.database import db_execute_return_id
    return await db_execute_return_id(
        "INSERT INTO photo_extractions (case_id, backup_id, device_name, output_path, status, image_count, indexed) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (case_id, 1, "Test Device", output_path, status, image_count, indexed),
    )


# ---------------------------------------------------------------------------
# GET /api/photos/extractions
# ---------------------------------------------------------------------------
async def test_list_extractions_empty(client, fresh_db):
    case_id = await _insert_case()
    resp = await client.get("/api/photos/extractions", params={"case_id": case_id})
    assert resp.status_code == 200
    assert resp.json() == []


async def test_list_extractions_scoped_by_case(client, fresh_db, tmp_data_dir):
    case_a = await _insert_case("A")
    case_b = await _insert_case("B")
    out_a = tmp_data_dir / "data" / "photos" / str(case_a) / "dev"
    out_b = tmp_data_dir / "data" / "photos" / str(case_b) / "dev"
    out_a.mkdir(parents=True, exist_ok=True)
    out_b.mkdir(parents=True, exist_ok=True)
    eid_a = await _insert_extraction(case_a, str(out_a))
    await _insert_extraction(case_b, str(out_b))

    resp = await client.get("/api/photos/extractions", params={"case_id": case_a})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["id"] == eid_a


async def test_list_extractions_requires_case_id(client, fresh_db):
    resp = await client.get("/api/photos/extractions")
    assert resp.status_code == 422  # validation error: missing query param


# ---------------------------------------------------------------------------
# DELETE /api/photos/extractions/{id}
# ---------------------------------------------------------------------------
async def test_delete_extraction_success(client, fresh_db, tmp_data_dir):
    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "to-del"
    out.mkdir(parents=True, exist_ok=True)
    (out / "x.txt").write_text("y")
    eid = await _insert_extraction(case_id, str(out))

    resp = await client.delete(f"/api/photos/extractions/{eid}")
    assert resp.status_code == 200
    assert "Deleted" in resp.json()["message"]
    assert not out.exists()


async def test_delete_extraction_missing_404(client, fresh_db):
    resp = await client.delete("/api/photos/extractions/99999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/photos/extractions/{id}/photos
# ---------------------------------------------------------------------------
async def test_get_photos_returns_list_response(client, fresh_db, tmp_data_dir):
    import json

    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    out.mkdir(parents=True, exist_ok=True)
    manifest = {
        "a": {"relative_path": "a.jpg", "photo_metadata": {"date_created": "2024-01-01T00:00:00", "media_type": "image"}},
        "b": {"relative_path": "b.jpg", "photo_metadata": {"date_created": "2024-02-01T00:00:00", "media_type": "image"}},
    }
    (out / "file_manifest.json").write_text(json.dumps(manifest))
    eid = await _insert_extraction(case_id, str(out))

    resp = await client.get(f"/api/photos/extractions/{eid}/photos")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    assert body["page"] == 0
    assert {p["file_id"] for p in body["photos"]} == {"a", "b"}


async def test_get_photos_invalid_extraction_404(client, fresh_db):
    resp = await client.get("/api/photos/extractions/99999/photos")
    assert resp.status_code == 404


async def test_get_photos_pagination_validation(client, fresh_db):
    # page_size > 500 rejected
    resp = await client.get("/api/photos/extractions/1/photos", params={"page_size": 9999})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# GET thumbnail / image
# ---------------------------------------------------------------------------
async def test_get_thumbnail_serves_jpeg(client, fresh_db, tmp_data_dir):
    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    _make_jpeg(out / "abc.jpg", size=(32, 32))
    eid = await _insert_extraction(case_id, str(out))

    resp = await client.get(f"/api/photos/extractions/{eid}/thumbnail/abc")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"


async def test_get_thumbnail_image_not_found_404(client, fresh_db, tmp_data_dir):
    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    out.mkdir(parents=True, exist_ok=True)
    eid = await _insert_extraction(case_id, str(out))

    resp = await client.get(f"/api/photos/extractions/{eid}/thumbnail/ghost")
    assert resp.status_code == 404


async def test_get_thumbnail_path_traversal_404(client, fresh_db, tmp_data_dir):
    """Encoded traversal in file_id must be rejected — image not found."""
    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    out.mkdir(parents=True, exist_ok=True)
    # Plant an outside file that traversal would try to reach.
    outside = tmp_data_dir / "secret.jpg"
    _make_jpeg(outside)
    eid = await _insert_extraction(case_id, str(out))

    resp = await client.get(f"/api/photos/extractions/{eid}/thumbnail/..%2F..%2Fsecret")
    assert resp.status_code == 404


async def test_get_browser_image_serves_native(client, fresh_db, tmp_data_dir):
    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    _make_jpeg(out / "img.jpg", size=(16, 16))
    eid = await _insert_extraction(case_id, str(out))

    resp = await client.get(f"/api/photos/extractions/{eid}/image/img")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/")


# ---------------------------------------------------------------------------
# POST /extract validation
# ---------------------------------------------------------------------------
async def test_start_extraction_missing_backup_400(client, fresh_db):
    case_id = await _insert_case()
    resp = await client.post(
        "/api/photos/extract",
        json={"backup_id": 99999, "case_id": case_id},
    )
    assert resp.status_code == 400


async def test_start_extraction_validation_error(client, fresh_db):
    resp = await client.post("/api/photos/extract", json={})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# POST /search: requires indexed extraction
# ---------------------------------------------------------------------------
async def test_search_unindexed_400(client, fresh_db, tmp_data_dir):
    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    out.mkdir(parents=True, exist_ok=True)
    eid = await _insert_extraction(case_id, str(out), indexed=0)

    resp = await client.post(
        f"/api/photos/extractions/{eid}/search",
        json={"query": "anything"},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Thumbnails warmup
# ---------------------------------------------------------------------------
async def test_warm_thumbnails_returns_count(client, fresh_db, tmp_data_dir):
    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    out.mkdir(parents=True, exist_ok=True)
    eid = await _insert_extraction(case_id, str(out))

    resp = await client.post(
        f"/api/photos/extractions/{eid}/thumbnails/warm",
        json={"file_ids": ["a", "b"]},
    )
    assert resp.status_code == 200
    assert "Scheduled 2" in resp.json()["message"]


async def test_warm_thumbnails_missing_extraction_404(client, fresh_db):
    resp = await client.post(
        "/api/photos/extractions/99999/thumbnails/warm",
        json={"file_ids": ["a"]},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Model status
# ---------------------------------------------------------------------------
async def test_model_status_shape(client, fresh_db):
    resp = await client.get("/api/photos/model/status")
    assert resp.status_code == 200
    body = resp.json()
    assert "downloaded" in body
    assert "size_mb" in body


# ---------------------------------------------------------------------------
# SSE: unknown task → 404
# ---------------------------------------------------------------------------
async def test_stream_extraction_logs_unknown_task_404(client, fresh_db):
    resp = await client.get("/api/photos/extract/stream/unknown-task-id")
    assert resp.status_code == 404
