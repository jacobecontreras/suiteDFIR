import asyncio
import json
import logging
import os
import sys
import uuid
import shutil
import mimetypes
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional, Dict, Any, List

from core.config import PHOTOS_DIR, PHOTOGREP_PATH
from core.database import db_execute, db_execute_return_id, db_fetch_all, db_fetch_one, db_execute_delete
from core.state import photos_tasks

logger = logging.getLogger(__name__)

# Prevent libomp crash when FAISS and PyTorch both link OpenMP on macOS
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
os.environ.setdefault("OMP_NUM_THREADS", "1")

# Add photoGrep to sys.path for imports
if PHOTOGREP_PATH not in sys.path:
    sys.path.insert(0, PHOTOGREP_PATH)


class PhotosManager:
    """Manages photo extraction, indexing, and search operations."""

    def __init__(self):
        self._semantic_index = None
        self._model_loaded = False
        self._manifest_cache: Dict[str, tuple] = {}  # output_path -> (mtime, manifest)
        self._extraction_cache: Dict[int, tuple] = {}  # extraction_id -> (time, row)
        self._thumbnail_executor = ThreadPoolExecutor(max_workers=min(os.cpu_count() or 4, 8))
        self._thumbnail_jobs: Dict[str, Any] = {}
        self._thumbnail_jobs_lock = threading.Lock()
        self._thumbnail_prewarm_limit = 2000

    async def start_extraction(
        self, backup_id: int, case_id: int, password: Optional[str] = None,
        name: Optional[str] = None, selected_artifacts: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Start photo extraction from a backup."""
        # Fetch backup info
        backup = await db_fetch_one("SELECT * FROM backups WHERE id = ?", (backup_id,))
        if not backup:
            raise ValueError(f"Backup {backup_id} not found")

        if backup["status"] != "completed":
            raise ValueError("Backup must be completed before extracting photos")

        backup_path = backup["path"]
        if not os.path.exists(backup_path):
            raise ValueError(f"Backup path does not exist: {backup_path}")

        # For iOS backups, the actual iTunes backup is inside a UDID subdirectory
        if backup.get("type") == "ios" and backup.get("device_udid"):
            udid = backup["device_udid"]
            udid_path = os.path.join(backup_path, udid)
            if os.path.exists(udid_path):
                backup_path = udid_path

        device_name = name or self._sanitize_device_name(backup.get("device_name", f"device_{backup_id}"))

        # Create output directory
        output_path = os.path.join(PHOTOS_DIR, str(case_id), device_name)
        os.makedirs(output_path, exist_ok=True)

        # Clean up previous failed extractions for this backup
        await db_execute(
            "DELETE FROM photo_extractions WHERE backup_id = ? AND status = 'error'",
            (backup_id,)
        )

        # Block only if there's already an in-progress extraction for this backup
        in_progress = await db_fetch_one(
            "SELECT id FROM photo_extractions WHERE backup_id = ? AND status = 'in_progress'",
            (backup_id,)
        )
        if in_progress:
            raise ValueError("An extraction is already in progress for this backup.")

        # Create DB record
        extraction_id = await db_execute_return_id(
            "INSERT INTO photo_extractions (case_id, backup_id, device_name, output_path, status) VALUES (?, ?, ?, ?, ?)",
            (case_id, backup_id, device_name, output_path, "in_progress")
        )

        # Create task for SSE streaming
        task_id = str(uuid.uuid4())
        photos_tasks[task_id] = {
            "queue": asyncio.Queue(maxsize=1000),
            "status": "in_progress",
            "extraction_id": extraction_id,
        }

        # Launch background extraction
        loop = asyncio.get_running_loop()
        loop.create_task(self._run_extraction(
            task_id, extraction_id, backup_path, output_path, password,
            selected_artifacts=set(selected_artifacts) if selected_artifacts else None,
        ))

        return {
            "task_id": task_id,
            "extraction_id": extraction_id,
            "message": f"Started photo extraction for {device_name}",
        }

    async def _run_extraction(
        self,
        task_id: str,
        extraction_id: int,
        backup_path: str,
        output_path: str,
        password: Optional[str],
        selected_artifacts: Optional[set] = None,
    ):
        """Background task: run photoGrep extraction pipeline."""
        queue = photos_tasks[task_id]["queue"]

        async def send(msg: str):
            try:
                data = json.dumps({"type": "log", "message": msg})
                await asyncio.wait_for(queue.put(data), timeout=1.0)
            except (asyncio.TimeoutError, asyncio.QueueFull):
                pass

        async def send_progress(current: int, total: int, phase: str):
            try:
                data = json.dumps({"type": "progress", "current": current, "total": total, "phase": phase})
                await asyncio.wait_for(queue.put(data), timeout=1.0)
            except (asyncio.TimeoutError, asyncio.QueueFull):
                pass

        loop = asyncio.get_running_loop()

        try:
            await send("Importing photoGrep modules...")
            from photogrep.ios_backup import run_extraction, check_encryption_status

            # Check encryption
            is_encrypted = await loop.run_in_executor(
                None, check_encryption_status, Path(backup_path)
            )

            if is_encrypted and not password:
                raise ValueError("Backup is encrypted but no password was provided.")

            if is_encrypted:
                await send("Backup is encrypted. Verifying password...")
            else:
                await send("Backup is not encrypted. Starting extraction...")

            # Create sync callbacks that bridge to async queue
            # photoGrep callbacks may pass extra args (e.g. filename), so accept *args
            def extract_cb(current, total, *args):
                asyncio.run_coroutine_threadsafe(send_progress(current, total, "extract"), loop)

            def metadata_cb(current, total, *args):
                asyncio.run_coroutine_threadsafe(send_progress(current, total, "metadata"), loop)

            def index_cb(current, total, *args):
                asyncio.run_coroutine_threadsafe(send_progress(current, total, "index"), loop)

            def status_cb(msg):
                asyncio.run_coroutine_threadsafe(send(msg), loop)

            # Run extraction in thread pool (CPU-bound + I/O)
            manifest = await loop.run_in_executor(
                None,
                lambda: run_extraction(
                    backup_path=Path(backup_path),
                    output_path=Path(output_path),
                    password=password,
                    extract_progress=extract_cb,
                    metadata_progress=metadata_cb,
                    index_progress=index_cb,
                    status_update=status_cb,
                    include_artifacts=selected_artifacts,
                )
            )

            if manifest is None:
                await send("No images found in backup.")
                await db_execute(
                    "UPDATE photo_extractions SET status = 'completed', image_count = 0 WHERE id = ?",
                    (extraction_id,)
                )
                photos_tasks[task_id]["status"] = "success"
                return

            image_count = len(manifest)
            await send(f"Extracted {image_count} images.")

            # Start thumbnail generation in the background so scroll performance
            # improves quickly after extraction without blocking completion.
            self._start_thumbnail_prewarm(output_path, manifest)

            # Check if search index was built
            index_path = os.path.join(output_path, ".search_index", "image_index.faiss")
            indexed = os.path.exists(index_path)

            await db_execute(
                "UPDATE photo_extractions SET status = 'completed', image_count = ?, indexed = ? WHERE id = ?",
                (image_count, indexed, extraction_id)
            )

            await send(f"Extraction complete. {image_count} images, indexed={indexed}")
            photos_tasks[task_id]["status"] = "success"

        except ValueError as e:
            await send(f"Error: {str(e)}")
            await db_execute(
                "UPDATE photo_extractions SET status = 'error' WHERE id = ?",
                (extraction_id,)
            )
            photos_tasks[task_id]["status"] = "error"

        except Exception as e:
            logger.error(f"Photo extraction failed: {e}", exc_info=True)
            await send(f"Extraction failed: {str(e)}")
            await db_execute(
                "UPDATE photo_extractions SET status = 'error' WHERE id = ?",
                (extraction_id,)
            )
            photos_tasks[task_id]["status"] = "error"

    async def _get_extraction_cached(self, extraction_id: int) -> Optional[Dict[str, Any]]:
        """Get extraction with short TTL cache to avoid DB hit per thumbnail."""
        import time
        cached = self._extraction_cache.get(extraction_id)
        if cached and time.time() - cached[0] < 60:
            return cached[1]
        row = await self.get_extraction(extraction_id)
        if row:
            self._extraction_cache[extraction_id] = (time.time(), row)
        return row

    async def get_or_create_thumbnail(self, extraction_id: int, file_id: str) -> str:
        """Get a thumbnail path, generating it on-demand if it doesn't exist."""
        extraction = await self._get_extraction_cached(extraction_id)
        if not extraction:
            raise ValueError(f"Extraction {extraction_id} not found")

        output_path = extraction["output_path"]
        thumb_dir = os.path.join(output_path, ".thumbnails")
        thumb_path = os.path.join(thumb_dir, f"{file_id}.jpg")

        # Fast path: thumbnail already exists on disk
        if os.path.exists(thumb_path):
            return thumb_path

        os.makedirs(thumb_dir, exist_ok=True)

        # Find source image
        src = self._find_image_file(output_path, file_id)
        if not src:
            raise FileNotFoundError(f"Image {file_id} not found")

        # Deduplicate concurrent requests for the same thumbnail.
        loop = asyncio.get_running_loop()
        future = self._submit_thumbnail_job(src, thumb_path)
        await asyncio.wrap_future(future, loop=loop)
        if not os.path.exists(thumb_path):
            raise FileNotFoundError(f"Thumbnail for {file_id} could not be generated")
        return thumb_path

    async def get_browser_image(self, extraction_id: int, file_id: str) -> tuple[str, str]:
        """Return a browser-safe image path and media type for preview."""
        extraction = await self._get_extraction_cached(extraction_id)
        if not extraction:
            raise ValueError(f"Extraction {extraction_id} not found")

        output_path = extraction["output_path"]
        src = self._find_image_file(output_path, file_id)
        if not src:
            raise FileNotFoundError(f"Image {file_id} not found")

        ext = Path(src).suffix.lower()
        media_type = mimetypes.guess_type(src)[0]
        browser_safe_exts = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}

        if ext in browser_safe_exts and media_type:
            return src, media_type

        preview_dir = os.path.join(output_path, ".previews")
        preview_path = os.path.join(preview_dir, f"{file_id}.jpg")
        if os.path.exists(preview_path):
            return preview_path, "image/jpeg"

        os.makedirs(preview_dir, exist_ok=True)
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self._create_preview_image, src, preview_path)

        if not os.path.exists(preview_path):
            raise FileNotFoundError(f"Preview for {file_id} could not be generated")

        return preview_path, "image/jpeg"

    THUMB_SIZE = 150

    @staticmethod
    def _create_thumbnail(src: str, dst: str):
        """Generate a 150x150 center-cropped JPEG thumbnail (matches photoGrep)."""
        from PIL import Image
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except ImportError:
            pass

        size = PhotosManager.THUMB_SIZE

        try:
            img = Image.open(src)
            # draft() optimization: request 2x size for faster JPEG decoding
            img.draft("RGB", (size * 2, size * 2))
            img = img.convert("RGB")
        except Exception:
            # Fallback for base64-encoded images from deep extraction
            try:
                import base64, io
                with open(src, "rb") as f:
                    head = f.read(32)
                if head[:4] in (b"/9j/", b"iVBO"):
                    with open(src, "rb") as f:
                        raw = f.read()
                    decoded = base64.b64decode(raw)
                    img = Image.open(io.BytesIO(decoded)).convert("RGB")
                else:
                    return  # skip unreadable file
            except Exception:
                return  # skip unreadable file

        # Center-crop to square
        w, h = img.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))
        img = img.resize((size, size), Image.LANCZOS)
        img.save(dst, "JPEG", quality=80)
        img.close()

    @staticmethod
    def _create_preview_image(src: str, dst: str):
        """Generate a browser-safe JPEG preview for unsupported original formats."""
        from PIL import Image, ImageOps
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except ImportError:
            pass

        with Image.open(src) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            img.thumbnail((2400, 2400), Image.LANCZOS)
            img.save(dst, "JPEG", quality=90)

    def _submit_thumbnail_job(self, src: str, dst: str):
        """Submit a thumbnail generation job unless one is already running."""
        with self._thumbnail_jobs_lock:
            future = self._thumbnail_jobs.get(dst)
            if future is not None and not future.done():
                return future

            future = self._thumbnail_executor.submit(self._create_thumbnail, src, dst)
            self._thumbnail_jobs[dst] = future

            def _cleanup(done_future):
                with self._thumbnail_jobs_lock:
                    if self._thumbnail_jobs.get(dst) is done_future:
                        self._thumbnail_jobs.pop(dst, None)

            future.add_done_callback(_cleanup)
            return future

    def _queue_thumbnail_generation(self, output_path: str, file_ids: List[str]):
        """Queue thumbnail generation without blocking the request path."""
        thumb_dir = os.path.join(output_path, ".thumbnails")
        os.makedirs(thumb_dir, exist_ok=True)

        for file_id in file_ids:
            thumb_path = os.path.join(thumb_dir, f"{file_id}.jpg")
            if os.path.exists(thumb_path):
                continue

            src = self._find_image_file(output_path, file_id)
            if not src:
                continue

            self._submit_thumbnail_job(src, thumb_path)

    def _start_thumbnail_prewarm(self, output_path: str, file_ids):
        """Generate a prioritized batch of thumbnails after extraction completes."""
        if isinstance(file_ids, dict):
            items = self._sort_items(list(file_ids.items()), "newest")
            file_ids = [file_id for file_id, _ in items[:self._thumbnail_prewarm_limit]]
        else:
            file_ids = list(file_ids)[:self._thumbnail_prewarm_limit]

        threading.Thread(
            target=self._queue_thumbnail_generation,
            args=(output_path, file_ids),
            daemon=True,
        ).start()

    _file_ext_cache: Dict[str, Dict[str, str]] = {}  # output_path -> {file_id: full_path}

    @classmethod
    def _find_image_file(cls, output_path: str, file_id: str) -> Optional[str]:
        """Find an image file by file_id in the output directory (with cache)."""
        # Check cache first
        dir_cache = cls._file_ext_cache.get(output_path)
        if dir_cache and file_id in dir_cache:
            path = dir_cache[file_id]
            if os.path.exists(path):
                return path

        # Build directory cache on first miss
        if dir_cache is None:
            dir_cache = {}
            try:
                for root, dirs, files in os.walk(output_path):
                    dirs[:] = [d for d in dirs if not d.startswith('.') or d == "_deep"]
                    for f in files:
                        if f.endswith('.json'):
                            continue
                        full_path = os.path.join(root, f)
                        fid = os.path.splitext(f)[0]
                        dir_cache.setdefault(fid, full_path)
            except OSError:
                pass
            cls._file_ext_cache[output_path] = dir_cache
            if file_id in dir_cache:
                return dir_cache[file_id]

        # Extension-based lookup as final fallback
        for ext in ('.jpg', '.jpeg', '.png', '.heic', '.heif', '.gif', '.tiff', '.dng', '.webp'):
            candidate = os.path.join(output_path, f"{file_id}{ext}")
            if os.path.exists(candidate):
                dir_cache[file_id] = candidate
                return candidate
        return None

    async def get_extractions(self, case_id: int) -> List[Dict[str, Any]]:
        """Get all photo extractions for a case."""
        return await db_fetch_all(
            "SELECT * FROM photo_extractions WHERE case_id = ? ORDER BY created_at DESC",
            (case_id,)
        )

    async def get_extraction(self, extraction_id: int) -> Optional[Dict[str, Any]]:
        """Get a single extraction by ID."""
        return await db_fetch_one(
            "SELECT * FROM photo_extractions WHERE id = ?",
            (extraction_id,)
        )

    async def delete_extraction(self, extraction_id: int) -> Dict[str, str]:
        """Delete an extraction and its files."""
        extraction = await self.get_extraction(extraction_id)
        if not extraction:
            raise ValueError(f"Extraction {extraction_id} not found")

        output_path = extraction["output_path"]

        # Invalidate caches
        self._manifest_cache.pop(output_path, None)
        self._extraction_cache.pop(extraction_id, None)
        self._file_ext_cache.pop(output_path, None)

        if os.path.exists(output_path):
            shutil.rmtree(output_path, ignore_errors=True)

        await db_execute_delete(
            "DELETE FROM photo_extractions WHERE id = ?",
            (extraction_id,)
        )

        return {"message": f"Deleted extraction {extraction_id}"}

    async def get_photos(
        self,
        extraction_id: int,
        page: int = 0,
        page_size: int = 100,
        sort: str = "newest",
        media_type: Optional[str] = None,
        has_gps: Optional[bool] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        classification: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get paginated photos for an extraction with optional filters."""
        extraction = await self.get_extraction(extraction_id)
        if not extraction:
            raise ValueError(f"Extraction {extraction_id} not found")

        output_path = extraction["output_path"]
        case_id = extraction["case_id"]
        device_name = extraction["device_name"]

        manifest = self._load_manifest(output_path)
        if not manifest:
            return {"photos": [], "total": 0, "page": page, "page_size": page_size}

        # Apply filters
        items = list(manifest.items())
        items = self._apply_filters(items, media_type, has_gps, date_from, date_to, classification)

        # Sort
        items = self._sort_items(items, sort)

        total = len(items)
        start = page * page_size
        page_items = items[start:start + page_size]
        prefetch_items = items[start:start + (page_size * 2)]

        self._queue_thumbnail_generation(
            output_path,
            [file_id for file_id, _ in prefetch_items],
        )

        photos = []
        for file_id, data in page_items:
            photos.append(self._build_photo_item(file_id, data, case_id, device_name, extraction_id))

        return {"photos": photos, "total": total, "page": page, "page_size": page_size}

    async def search_photos(
        self,
        extraction_id: int,
        query: str,
        threshold: float = 0.20,
    ) -> Dict[str, Any]:
        """Semantic search using CLIP embeddings."""
        extraction = await self.get_extraction(extraction_id)
        if not extraction:
            raise ValueError(f"Extraction {extraction_id} not found")

        if not extraction["indexed"]:
            raise ValueError("Search index not available for this extraction. Rebuild the index first.")

        if not self.get_model_status()["downloaded"]:
            raise ValueError("CLIP model weights are not available locally yet. Download the model or rebuild the index after the model is installed.")

        output_path = extraction["output_path"]
        case_id = extraction["case_id"]
        device_name = extraction["device_name"]

        loop = asyncio.get_running_loop()

        def _do_search():
            from photogrep.semantic import SemanticIndex
            index_dir = os.path.join(output_path, ".search_index")
            idx = SemanticIndex(index_dir)

            terms = query.split()
            # Single-term or short queries: search as-is
            if len(terms) <= 3:
                return idx.search(query, threshold=threshold)

            # Multi-term queries (forensic presets): search each term
            # independently and merge results, keeping the max score per image.
            # CLIP encodes a long keyword list as one diluted embedding, so
            # individual searches produce much better similarity scores.
            best: dict = {}  # file_id -> SearchResult
            for term in terms:
                for r in idx.search(term, threshold=threshold):
                    fid = getattr(r, "file_id", None) or (Path(getattr(r, "file_path", "")).stem)
                    if fid not in best or r.score > best[fid].score:
                        best[fid] = r
            merged = sorted(best.values(), key=lambda r: r.score, reverse=True)
            return merged

        try:
            raw_results = await loop.run_in_executor(None, _do_search)
        except Exception as e:
            logger.error("Semantic photo search failed", exc_info=True)
            raise ValueError(f"Semantic search failed: {e}") from e

        manifest = self._load_manifest(output_path)

        results = []
        for r in raw_results:
            file_path = getattr(r, "file_path", None)
            file_id = getattr(r, "file_id", None) or (Path(file_path).stem if file_path else None)
            if not file_id:
                continue
            data = manifest.get(file_id, {})
            item = self._build_photo_item(file_id, data, case_id, device_name, extraction_id)
            results.append({
                "file_id": item["file_id"],
                "score": round(r.score, 4),
                "thumbnail_url": item["thumbnail_url"],
                "full_url": item["full_url"],
                "metadata": item["metadata"],
            })

        return {"results": results, "query": query, "total": len(results)}

    async def reindex(self, extraction_id: int) -> Dict[str, str]:
        """Rebuild the CLIP search index for an extraction."""
        extraction = await self.get_extraction(extraction_id)
        if not extraction:
            raise ValueError(f"Extraction {extraction_id} not found")

        output_path = extraction["output_path"]
        manifest = self._load_manifest(output_path)
        if not manifest:
            raise ValueError("No manifest found. Extraction may be incomplete.")

        loop = asyncio.get_running_loop()

        def _do_index():
            from photogrep.semantic import SemanticIndex
            index_dir = os.path.join(output_path, ".search_index")
            idx = SemanticIndex(index_dir)
            idx.build_index(output_path, file_manifest=manifest)

        await loop.run_in_executor(None, _do_index)

        await db_execute(
            "UPDATE photo_extractions SET indexed = 1 WHERE id = ?",
            (extraction_id,)
        )

        return {"message": "Search index rebuilt successfully"}

    def get_model_status(self) -> Dict[str, Any]:
        """Check if the CLIP model is downloaded."""
        # open_clip caches in ~/.cache/huggingface/hub or torch hub
        cache_dirs = [
            Path.home() / ".cache" / "huggingface",
            Path.home() / ".cache" / "open_clip",
        ]
        for d in cache_dirs:
            if d.exists() and (any(d.rglob("*.bin")) or any(d.rglob("*.safetensors"))):
                # Estimate size
                total_size = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
                return {"downloaded": True, "size_mb": round(total_size / (1024 * 1024), 1)}

        return {"downloaded": False, "size_mb": None}

    async def schedule_thumbnail_warmup(self, extraction_id: int, file_ids: List[str]) -> int:
        """Queue thumbnail generation for a specific batch of file IDs."""
        extraction = await self.get_extraction(extraction_id)
        if not extraction:
            raise ValueError(f"Extraction {extraction_id} not found")

        unique_file_ids = list(dict.fromkeys(file_id for file_id in file_ids if file_id))
        if not unique_file_ids:
            return 0

        self._queue_thumbnail_generation(extraction["output_path"], unique_file_ids)
        return len(unique_file_ids)

    # --- Private helpers ---

    def _sanitize_device_name(self, name: str) -> str:
        """Make device name filesystem-safe."""
        return "".join(c if c.isalnum() or c in ('-', '_', ' ') else '_' for c in name).strip()

    def _load_manifest(self, output_path: str) -> Optional[dict]:
        """Load file_manifest.json with mtime-based caching."""
        manifest_path = os.path.join(output_path, "file_manifest.json")
        if not os.path.exists(manifest_path):
            return None

        mtime = os.path.getmtime(manifest_path)
        cached = self._manifest_cache.get(output_path)
        if cached and cached[0] == mtime:
            return cached[1]

        with open(manifest_path, "r") as f:
            manifest = json.load(f)
        self._manifest_cache[output_path] = (mtime, manifest)
        return manifest

    def _apply_filters(self, items, media_type, has_gps, date_from, date_to, classification=None):
        """Apply metadata filters to manifest items."""
        filtered = []
        for file_id, data in items:
            if classification and data.get("classification") != classification:
                continue
            meta = data.get("photo_metadata", {})
            if not meta:
                meta = {}

            if media_type and meta.get("media_type") != media_type:
                continue
            if has_gps is True and (meta.get("latitude") is None or meta.get("longitude") is None):
                continue
            if has_gps is False and meta.get("latitude") is not None:
                continue
            if date_from and (meta.get("date_created") or "") < date_from:
                continue
            if date_to and (meta.get("date_created") or "") > date_to:
                continue

            filtered.append((file_id, data))
        return filtered

    def _sort_items(self, items, sort: str):
        """Sort manifest items."""
        if sort == "newest":
            return sorted(items, key=lambda x: x[1].get("photo_metadata", {}).get("date_created", "") or "", reverse=True)
        elif sort == "oldest":
            return sorted(items, key=lambda x: x[1].get("photo_metadata", {}).get("date_created", "") or "")
        return items  # default: manifest order

    def _build_photo_item(self, file_id: str, data: dict, case_id: int, device_name: str, extraction_id: int = 0) -> dict:
        """Build a PhotoItem dict from manifest data."""
        meta_raw = data.get("photo_metadata") or {}
        metadata = {
            "date_created": meta_raw.get("date_created"),
            "date_modified": meta_raw.get("date_modified"),
            "latitude": meta_raw.get("latitude"),
            "longitude": meta_raw.get("longitude"),
            "media_type": meta_raw.get("media_type"),
            "duration": meta_raw.get("duration"),
            "camera_make": meta_raw.get("camera_make"),
            "camera_model": meta_raw.get("camera_model"),
            "lens_model": meta_raw.get("lens_model"),
            "iso": meta_raw.get("iso"),
            "aperture": meta_raw.get("aperture"),
            "focal_length": meta_raw.get("focal_length"),
            "shutter_speed": meta_raw.get("shutter_speed"),
            "flash_fired": meta_raw.get("flash_fired"),
            "metering_mode": meta_raw.get("metering_mode"),
            "white_balance": meta_raw.get("white_balance"),
            "width": meta_raw.get("width"),
            "height": meta_raw.get("height"),
            "original_width": meta_raw.get("original_width"),
            "original_height": meta_raw.get("original_height"),
            "favorite": meta_raw.get("favorite"),
            "hidden": meta_raw.get("hidden"),
            "trashed": meta_raw.get("trashed"),
            "original_filename": data.get("relative_path", "").split("/")[-1] if data.get("relative_path") else None,
            "domain": data.get("domain"),
            "relative_path": data.get("relative_path"),
            "classification": data.get("classification"),
        }

        # Thumbnail served on-demand via API endpoint
        thumbnail_url = f"/api/photos/extractions/{extraction_id}/thumbnail/{file_id}"

        # Full preview is served through the API so unsupported formats like HEIC
        # can be converted to a browser-safe image on demand.
        full_url = f"/api/photos/extractions/{extraction_id}/image/{file_id}"

        return {
            "file_id": file_id,
            "thumbnail_url": thumbnail_url,
            "full_url": full_url,
            "metadata": metadata,
        }


# Singleton
photos_manager = PhotosManager()
