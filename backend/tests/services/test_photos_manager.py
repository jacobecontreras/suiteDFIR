"""Tests for services.photos_manager.PhotosManager.

CLIP / faiss / open_clip are NEVER actually loaded. The semantic-search and
extraction code paths import photogrep lazily, so we either avoid those paths
or monkeypatch the imported callables.
"""

from __future__ import annotations

import io
import json
import os
from pathlib import Path

import pytest
from PIL import Image


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _make_jpeg(path: Path, size: tuple[int, int] = (8, 8), color: str = "red"):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(str(path), "JPEG")


async def _insert_case(name: str = "PhotoCase") -> int:
    from services.case_manager import case_manager
    return await case_manager.create_case({
        "name": name,
        "case_number": "C-PH",
        "client_name": "x",
        "client_phone": "+1-555-0123",
        "client_email": "x@example.com",
        "description": "d",
        "status": "Active",
        "priority": "Medium",
    })


async def _insert_backup(case_id: int) -> int:
    from core.database import db_execute_return_id
    return await db_execute_return_id(
        "INSERT INTO backups (name, device_udid, device_name, path, status, case_id) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        ("bk", "udid-1", "Test Device", "/tmp/nope", "completed", case_id),
    )


async def _insert_extraction(case_id: int, output_path: str, *, backup_id: int = 1,
                             status: str = "completed", image_count: int = 0,
                             indexed: int = 0) -> int:
    from core.database import db_execute_return_id
    return await db_execute_return_id(
        "INSERT INTO photo_extractions (case_id, backup_id, device_name, output_path, status, image_count, indexed) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (case_id, backup_id, "Test Device", output_path, status, image_count, indexed),
    )


# ---------------------------------------------------------------------------
# extractions: create / list / scope / get / delete
# ---------------------------------------------------------------------------
async def test_get_extractions_scoped_by_case(fresh_db, tmp_data_dir):
    from services.photos_manager import photos_manager

    case_a = await _insert_case("Case A")
    case_b = await _insert_case("Case B")

    out_a = str(tmp_data_dir / "data" / "photos" / str(case_a) / "dev")
    out_b = str(tmp_data_dir / "data" / "photos" / str(case_b) / "dev")
    os.makedirs(out_a, exist_ok=True)
    os.makedirs(out_b, exist_ok=True)

    id_a = await _insert_extraction(case_a, out_a)
    id_b = await _insert_extraction(case_b, out_b)

    rows_a = await photos_manager.get_extractions(case_a)
    rows_b = await photos_manager.get_extractions(case_b)

    assert {r["id"] for r in rows_a} == {id_a}
    assert {r["id"] for r in rows_b} == {id_b}


async def test_get_extraction_returns_row(fresh_db, tmp_data_dir):
    from services.photos_manager import photos_manager

    case_id = await _insert_case()
    out = str(tmp_data_dir / "data" / "photos" / str(case_id) / "dev")
    os.makedirs(out, exist_ok=True)
    eid = await _insert_extraction(case_id, out)

    row = await photos_manager.get_extraction(eid)
    assert row["id"] == eid
    assert row["case_id"] == case_id


async def test_get_extraction_missing_returns_none(fresh_db):
    from services.photos_manager import photos_manager
    assert await photos_manager.get_extraction(99999) is None


async def test_delete_extraction_removes_files_and_row(fresh_db, tmp_data_dir):
    from core.database import db_fetch_one
    from services.photos_manager import photos_manager

    case_id = await _insert_case()
    out_dir = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "stuff.txt").write_text("hi")
    eid = await _insert_extraction(case_id, str(out_dir))

    result = await photos_manager.delete_extraction(eid)
    assert "Deleted" in result["message"]
    assert not out_dir.exists()
    assert await db_fetch_one("SELECT id FROM photo_extractions WHERE id = ?", (eid,)) is None


async def test_delete_extraction_missing_raises(fresh_db):
    from services.photos_manager import photos_manager
    with pytest.raises(ValueError, match="not found"):
        await photos_manager.delete_extraction(12345)


# ---------------------------------------------------------------------------
# manifest / gallery listing / pagination
# ---------------------------------------------------------------------------
def _write_manifest(out: Path, items: dict):
    out.mkdir(parents=True, exist_ok=True)
    (out / "file_manifest.json").write_text(json.dumps(items))


async def test_get_photos_returns_paginated_shape(fresh_db, tmp_data_dir):
    from services.photos_manager import photos_manager

    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    manifest = {
        f"img{i:03d}": {
            "relative_path": f"Media/DCIM/img{i:03d}.jpg",
            "domain": "CameraRollDomain",
            "photo_metadata": {
                "date_created": f"2024-01-{(i % 28) + 1:02d}T00:00:00",
                "media_type": "image",
            },
        }
        for i in range(25)
    }
    _write_manifest(out, manifest)
    eid = await _insert_extraction(case_id, str(out), image_count=25)

    page0 = await photos_manager.get_photos(eid, page=0, page_size=10)
    assert page0["total"] == 25
    assert page0["page"] == 0
    assert page0["page_size"] == 10
    assert len(page0["photos"]) == 10

    # Shape sanity for one photo item
    p = page0["photos"][0]
    assert p["file_id"].startswith("img")
    assert p["thumbnail_url"] == f"/api/photos/extractions/{eid}/thumbnail/{p['file_id']}"
    assert p["full_url"] == f"/api/photos/extractions/{eid}/image/{p['file_id']}"
    assert "metadata" in p

    page2 = await photos_manager.get_photos(eid, page=2, page_size=10)
    assert len(page2["photos"]) == 5


async def test_get_photos_filters_by_media_type(fresh_db, tmp_data_dir):
    from services.photos_manager import photos_manager

    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    manifest = {
        "vid1": {"relative_path": "v.mov", "photo_metadata": {"media_type": "video"}},
        "img1": {"relative_path": "i.jpg", "photo_metadata": {"media_type": "image"}},
    }
    _write_manifest(out, manifest)
    eid = await _insert_extraction(case_id, str(out))

    only_video = await photos_manager.get_photos(eid, media_type="video")
    assert only_video["total"] == 1
    assert only_video["photos"][0]["file_id"] == "vid1"


async def test_get_photos_missing_extraction_raises(fresh_db):
    from services.photos_manager import photos_manager
    with pytest.raises(ValueError, match="not found"):
        await photos_manager.get_photos(987654)


async def test_get_photos_no_manifest_returns_empty(fresh_db, tmp_data_dir):
    from services.photos_manager import photos_manager

    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "empty"
    out.mkdir(parents=True, exist_ok=True)
    eid = await _insert_extraction(case_id, str(out))

    res = await photos_manager.get_photos(eid)
    assert res == {"photos": [], "total": 0, "page": 0, "page_size": 100}


# ---------------------------------------------------------------------------
# thumbnail / image / path-traversal protection
# ---------------------------------------------------------------------------
async def test_get_or_create_thumbnail_generates_file(fresh_db, tmp_data_dir):
    from services.photos_manager import photos_manager

    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    src = out / "img001.jpg"
    _make_jpeg(src, size=(32, 32))
    eid = await _insert_extraction(case_id, str(out))

    thumb_path = await photos_manager.get_or_create_thumbnail(eid, "img001")
    assert Path(thumb_path).exists()
    assert Path(thumb_path).parent.name == ".thumbnails"


async def test_get_or_create_thumbnail_missing_image_raises(fresh_db, tmp_data_dir):
    from services.photos_manager import photos_manager

    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    out.mkdir(parents=True, exist_ok=True)
    eid = await _insert_extraction(case_id, str(out))

    with pytest.raises(FileNotFoundError):
        await photos_manager.get_or_create_thumbnail(eid, "ghost_file")


async def test_get_or_create_thumbnail_missing_extraction_raises(fresh_db):
    from services.photos_manager import photos_manager
    with pytest.raises(ValueError, match="not found"):
        await photos_manager.get_or_create_thumbnail(424242, "x")


async def test_find_image_file_rejects_outside_photos_dir(fresh_db, tmp_data_dir):
    """Path-traversal guard: a request for an image whose resolved location
    sits outside the extraction output_path must not be served. `_find_image_file`
    walks only inside output_path; even if the caller passes a traversal-style
    file_id, the lookup must fail rather than escape PHOTOS_DIR."""
    from services.photos_manager import photos_manager, PhotosManager

    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    out.mkdir(parents=True, exist_ok=True)

    # Plant a file outside the extraction directory (and outside PHOTOS_DIR).
    outsider = tmp_data_dir / "secret.jpg"
    _make_jpeg(outsider, size=(8, 8))

    # Clear cache before testing
    PhotosManager._file_ext_cache.pop(str(out), None)

    # Direct check: traversal file_id should not resolve to anything inside out.
    result = PhotosManager._find_image_file(str(out), "../../../secret")
    if result is not None:
        # If anything is returned, it must NOT be the outside file.
        assert Path(tmp_data_dir / "data" / "photos").resolve() in Path(result).resolve().parents, (
            f"_find_image_file leaked file outside PHOTOS_DIR: {result}"
        )
    else:
        assert result is None

    # And the public thumbnail API must reject it too.
    eid = await _insert_extraction(case_id, str(out))
    with pytest.raises(FileNotFoundError):
        await photos_manager.get_or_create_thumbnail(eid, "../../../secret")


async def test_get_browser_image_returns_native_for_jpeg(fresh_db, tmp_data_dir):
    from services.photos_manager import photos_manager

    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    src = out / "img002.jpg"
    _make_jpeg(src, size=(16, 16))
    eid = await _insert_extraction(case_id, str(out))

    path, media_type = await photos_manager.get_browser_image(eid, "img002")
    assert path == str(src)
    assert media_type == "image/jpeg"


# ---------------------------------------------------------------------------
# metadata parsing via _build_photo_item (mock EXIF / manifest content)
# ---------------------------------------------------------------------------
def test_build_photo_item_maps_metadata():
    from services.photos_manager import photos_manager

    data = {
        "relative_path": "Media/DCIM/100APPLE/IMG_0001.HEIC",
        "domain": "CameraRollDomain",
        "classification": "screenshot",
        "photo_metadata": {
            "date_created": "2024-05-01T10:00:00",
            "latitude": 12.34,
            "longitude": -56.78,
            "media_type": "image",
            "camera_make": "Apple",
            "camera_model": "iPhone 15",
            "width": 4032,
            "height": 3024,
            "favorite": True,
        },
    }
    item = photos_manager._build_photo_item("abc", data, case_id=1, device_name="dev", extraction_id=42)
    assert item["file_id"] == "abc"
    assert item["thumbnail_url"].endswith("/api/photos/extractions/42/thumbnail/abc")
    md = item["metadata"]
    assert md["latitude"] == 12.34
    assert md["camera_make"] == "Apple"
    assert md["original_filename"] == "IMG_0001.HEIC"
    assert md["domain"] == "CameraRollDomain"
    assert md["classification"] == "screenshot"
    assert md["favorite"] is True


# ---------------------------------------------------------------------------
# misc invariants
# ---------------------------------------------------------------------------
def test_sanitize_device_name_strips_unsafe_chars():
    from services.photos_manager import photos_manager
    out = photos_manager._sanitize_device_name("My/Bad:Name*?")
    assert "/" not in out and ":" not in out and "*" not in out and "?" not in out


async def test_search_photos_requires_indexed_extraction(fresh_db, tmp_data_dir):
    """Without a search index we expect a ValueError, no CLIP load attempt."""
    from services.photos_manager import photos_manager

    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    out.mkdir(parents=True, exist_ok=True)
    eid = await _insert_extraction(case_id, str(out), indexed=0)

    with pytest.raises(ValueError, match="index"):
        await photos_manager.search_photos(eid, query="cat")


async def test_schedule_thumbnail_warmup_returns_count(fresh_db, tmp_data_dir):
    from services.photos_manager import photos_manager

    case_id = await _insert_case()
    out = tmp_data_dir / "data" / "photos" / str(case_id) / "dev"
    out.mkdir(parents=True, exist_ok=True)
    eid = await _insert_extraction(case_id, str(out))

    n = await photos_manager.schedule_thumbnail_warmup(eid, ["a", "b", "b", "", "c"])
    assert n == 3


async def test_schedule_thumbnail_warmup_missing_extraction_raises(fresh_db):
    from services.photos_manager import photos_manager
    with pytest.raises(ValueError, match="not found"):
        await photos_manager.schedule_thumbnail_warmup(999, ["a"])
