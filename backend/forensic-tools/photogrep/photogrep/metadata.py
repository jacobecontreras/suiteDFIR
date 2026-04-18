"""
Photo Metadata Extraction Module

Extracts GPS, date, media type, and other metadata from Photos.sqlite
and EXIF data for images in an iOS backup.
"""

import logging
import re
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS, IFD

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

logger = logging.getLogger(__name__)

# Core Data epoch: 2001-01-01 00:00:00 UTC
_CORE_DATA_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
_MIN_SANE_DATE = datetime(1970, 1, 1, tzinfo=timezone.utc)
_MAX_SANE_DATE = datetime(2100, 1, 1, tzinfo=timezone.utc)

_UUID_RE = re.compile(r'[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}')


def _extract_uuid_from_path(rel_path: str) -> Optional[str]:
    """Extract the first UUID from a relative path, uppercased."""
    match = _UUID_RE.search(rel_path)
    return match.group(0).upper() if match else None


def _convert_core_data_timestamp(ts) -> Optional[str]:
    """Convert Core Data epoch (seconds since 2001-01-01) to ISO 8601 string.

    Returns None for invalid or out-of-range timestamps.
    """
    if ts is None:
        return None
    try:
        ts = float(ts)
        dt = _CORE_DATA_EPOCH + timedelta(seconds=ts)
        if dt < _MIN_SANE_DATE or dt > _MAX_SANE_DATE:
            return None
        return dt.isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def _map_media_type(kind, subtype, uti) -> Optional[str]:
    """Map ZKIND/ZKINDSUBTYPE integers to a human-readable media_type string."""
    if uti and "screenshot" in str(uti).lower():
        return "screenshot"
    if kind == 1:
        return "video"
    if subtype == 1:
        return "panorama"
    if subtype == 2:
        return "live_photo"
    if kind == 0:
        return "photo"
    return None


def _convert_gps_to_decimal(gps_info: dict) -> tuple:
    """Convert GPS IFD data to decimal (latitude, longitude).

    Returns (lat, lon) as floats, or (None, None) on failure.
    """
    try:
        def _to_degrees(value):
            """Convert GPS coordinate tuple (degrees, minutes, seconds) to decimal."""
            d, m, s = value
            return float(d) + float(m) / 60.0 + float(s) / 3600.0

        lat = _to_degrees(gps_info[2])
        lon = _to_degrees(gps_info[4])

        if gps_info.get(1) == "S":
            lat = -lat
        if gps_info.get(3) == "W":
            lon = -lon

        return lat, lon
    except (KeyError, TypeError, ValueError, IndexError, ZeroDivisionError):
        return None, None


def _extract_exif(image_path: str) -> dict:
    """Extract metadata from an image file using Pillow EXIF.

    Returns a metadata dict with the unified schema keys populated where available.
    """
    meta = _empty_meta("exif")

    try:
        img = Image.open(image_path)

        # Image dimensions
        if img.size:
            meta["width"] = img.size[0]
            meta["height"] = img.size[1]

        exif = img.getexif()
        if not exif:
            return meta

        # Camera make (271) / model (272)
        _set_str(meta, "camera_make", exif.get(271))
        _set_str(meta, "camera_model", exif.get(272))

        # EXIF IFD
        try:
            exif_ifd = exif.get_ifd(IFD.Exif)
            # DateTimeOriginal (36867)
            date_str = exif_ifd.get(36867)
            if date_str:
                dt = datetime.strptime(str(date_str), "%Y:%m:%d %H:%M:%S")
                meta["date_created"] = dt.isoformat()
            # LensModel (42036)
            _set_str(meta, "lens_model", exif_ifd.get(42036))
            # ISO (34855)
            _set_float(meta, "iso", exif_ifd.get(34855))
            # FNumber / Aperture (33437)
            aperture = exif_ifd.get(33437)
            if aperture is not None:
                meta["aperture"] = round(float(aperture), 2)
            # FocalLength (37386)
            fl = exif_ifd.get(37386)
            if fl is not None:
                meta["focal_length"] = round(float(fl), 2)
            # FocalLengthIn35mm (41989)
            fl35 = exif_ifd.get(41989)
            if fl35 is not None:
                meta["focal_length_35mm"] = round(float(fl35), 2)
            # ExposureTime / ShutterSpeed (33434)
            ss = exif_ifd.get(33434)
            if ss is not None:
                meta["shutter_speed"] = float(ss)
            # Flash (37385)
            flash = exif_ifd.get(37385)
            if flash is not None:
                meta["flash_fired"] = bool(flash & 1)  # bit 0 = fired
            # WhiteBalance (41987)
            _set_int(meta, "white_balance", exif_ifd.get(41987))
            # MeteringMode (37383)
            _set_int(meta, "metering_mode", exif_ifd.get(37383))
        except Exception:
            pass

        # GPS IFD
        try:
            gps_ifd = exif.get_ifd(IFD.GPSInfo)
            if gps_ifd:
                lat, lon = _convert_gps_to_decimal(gps_ifd)
                if lat is not None and lon is not None:
                    meta["latitude"] = round(lat, 6)
                    meta["longitude"] = round(lon, 6)
        except Exception:
            pass

    except Exception as e:
        logger.debug(f"EXIF extraction failed for {image_path}: {e}")

    return meta


def _empty_meta(source: str = None) -> dict:
    """Return a metadata dict with all keys set to None."""
    return {
        "original_filename": None, "original_file_size": None,
        "uniform_type": None,
        "date_created": None, "date_modified": None,
        "date_added": None, "last_shared_date": None,
        "media_type": None, "duration": None,
        "latitude": None, "longitude": None,
        "camera_make": None, "camera_model": None, "lens_model": None,
        "iso": None, "aperture": None,
        "focal_length": None, "focal_length_35mm": None,
        "shutter_speed": None, "flash_fired": None,
        "metering_mode": None, "white_balance": None,
        "width": None, "height": None,
        "original_width": None, "original_height": None,
        "color_space": None, "hdr_gain": None,
        "favorite": None, "hidden": None, "trashed": None,
        "view_count": None, "play_count": None,
        "source_db": source,
    }


def _set_str(meta: dict, key: str, val):
    if val is not None:
        meta[key] = str(val).strip()


def _set_int(meta: dict, key: str, val):
    if val is not None:
        try:
            meta[key] = int(val)
        except (ValueError, TypeError):
            pass


def _set_float(meta: dict, key: str, val):
    if val is not None:
        try:
            meta[key] = round(float(val), 4)
        except (ValueError, TypeError):
            pass


def _query_photos_sqlite(conn: sqlite3.Connection) -> list:
    """Query ZASSET joined with ZADDITIONALASSETATTRIBUTES, returning list of row dicts.

    Uses PRAGMA table_info to discover available columns before building
    the SELECT statement. Joins ZADDITIONALASSETATTRIBUTES for camera/lens info.
    """
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(ZASSET)")
        asset_cols = {row[1] for row in cursor.fetchall()}
    except Exception as e:
        logger.warning(f"Could not read ZASSET schema: {e}")
        return []

    if "ZFILENAME" not in asset_cols or "ZDIRECTORY" not in asset_cols:
        logger.warning("ZASSET missing ZFILENAME or ZDIRECTORY — cannot match photos")
        return []

    # Discover ZADDITIONALASSETATTRIBUTES columns
    addl_cols = set()
    has_addl_table = False
    try:
        cursor.execute("PRAGMA table_info(ZADDITIONALASSETATTRIBUTES)")
        addl_cols = {row[1] for row in cursor.fetchall()}
        has_addl_table = len(addl_cols) > 0
    except Exception:
        pass

    # Discover ZEXTENDEDATTRIBUTES columns
    ext_cols = set()
    has_ext_table = False
    try:
        cursor.execute("PRAGMA table_info(ZEXTENDEDATTRIBUTES)")
        ext_cols = {row[1] for row in cursor.fetchall()}
        has_ext_table = len(ext_cols) > 0
    except Exception:
        pass

    # Base ZASSET columns (always expected)
    asset_base = ["ZFILENAME", "ZDIRECTORY", "ZLATITUDE", "ZLONGITUDE", "ZDATECREATED", "ZUUID"]
    # Optional ZASSET columns
    asset_optional = [
        "ZKIND", "ZKINDSUBTYPE", "ZFAVORITE", "ZHIDDEN",
        "ZTRASHEDSTATE", "ZUNIFORMTYPEIDENTIFIER", "ZDURATION",
        "ZMODIFICATIONDATE", "ZADDEDDATE", "ZLASTSHAREDDATE",
        "ZWIDTH", "ZHEIGHT", "ZORIGINALCOLORSPACE", "ZHDRGAIN",
    ]

    select_parts = []
    for col in asset_base:
        if col in asset_cols:
            select_parts.append(f"A.{col}")
        else:
            logger.debug(f"ZASSET missing expected column: {col}")

    for col in asset_optional:
        if col in asset_cols:
            select_parts.append(f"A.{col}")

    # ZADDITIONALASSETATTRIBUTES columns
    addl_wanted = [
        "ZCAMERAMAKE", "ZCAMERAMODEL", "ZLENSMODEL",
        "ZORIGINALFILENAME", "ZEXIFTIMESTAMPSTRING",
        "ZORIGINALFILESIZE", "ZORIGINALWIDTH", "ZORIGINALHEIGHT",
        "ZVIEWCOUNT", "ZPLAYCOUNT",
    ]
    joined_addl = []
    for col in addl_wanted:
        if col in addl_cols:
            select_parts.append(f"AA.{col}")
            joined_addl.append(col)

    # ZEXTENDEDATTRIBUTES columns (camera/EXIF data)
    ext_wanted = [
        "ZISO", "ZAPERTURE", "ZFOCALLENGTH", "ZFOCALLENGTHIN35MM",
        "ZSHUTTERSPEED", "ZFLASHFIRED", "ZMETERINGMODE", "ZWHITEBALANCE",
        "ZCAMERAMAKE", "ZCAMERAMODEL", "ZLENSMODEL",
    ]
    joined_ext = []
    for col in ext_wanted:
        if col in ext_cols:
            # Alias extended attrs columns to avoid name collision with addl attrs
            select_parts.append(f"EA.{col} AS EA_{col}")
            joined_ext.append(col)

    query = f"SELECT {', '.join(select_parts)} FROM ZASSET A"
    if has_addl_table and joined_addl:
        query += " LEFT JOIN ZADDITIONALASSETATTRIBUTES AA ON AA.ZASSET = A.Z_PK"
    if has_ext_table and joined_ext:
        query += " LEFT JOIN ZEXTENDEDATTRIBUTES EA ON EA.ZASSET = A.Z_PK"

    try:
        cursor.execute(query)
        col_names = [desc[0] for desc in cursor.description]
        rows = []
        for row in cursor.fetchall():
            rows.append(dict(zip(col_names, row)))
        return rows
    except Exception as e:
        logger.warning(f"Failed to query ZASSET: {e}")
        return []


def extract_photo_metadata(parser, manifest: dict, output_dir,
                           progress_callback=None) -> dict:
    """Extract photo metadata from Photos.sqlite and EXIF.

    Args:
        parser: iOSBackupParser instance.
        manifest: dict mapping file_id -> {relative_path, domain, ...}.
        output_dir: Path to the extraction output directory.
        progress_callback: Optional callable(current, total) for progress updates.

    Returns:
        dict mapping file_id -> metadata dict.
    """
    output_dir = Path(output_dir)
    result = {}

    # Step 1: Try to open Photos.sqlite and build directory+filename -> metadata mapping
    db_meta = {}
    uuid_to_db_meta = {}
    try:
        conn = parser.open_backup_db("CameraRollDomain", "Media/PhotoData/Photos.sqlite")
        if conn:
            try:
                rows = _query_photos_sqlite(conn)
                for row in rows:
                    directory = row.get("ZDIRECTORY")
                    filename = row.get("ZFILENAME")
                    if not directory or not filename:
                        continue

                    key = f"{directory}/{filename}"

                    meta = _empty_meta("photos.sqlite")

                    lat = row.get("ZLATITUDE")
                    lon = row.get("ZLONGITUDE")
                    if lat is not None and lon is not None and (lat != 0 or lon != 0):
                        meta["latitude"] = round(float(lat), 6)
                        meta["longitude"] = round(float(lon), 6)

                    # Dates (Core Data timestamps)
                    meta["date_created"] = _convert_core_data_timestamp(row.get("ZDATECREATED"))
                    meta["date_modified"] = _convert_core_data_timestamp(row.get("ZMODIFICATIONDATE"))
                    meta["date_added"] = _convert_core_data_timestamp(row.get("ZADDEDDATE"))
                    meta["last_shared_date"] = _convert_core_data_timestamp(row.get("ZLASTSHAREDDATE"))

                    # Media type
                    kind = row.get("ZKIND")
                    subtype = row.get("ZKINDSUBTYPE")
                    uti = row.get("ZUNIFORMTYPEIDENTIFIER")
                    meta["media_type"] = _map_media_type(kind, subtype, uti)
                    if uti:
                        meta["uniform_type"] = str(uti)

                    # Duration
                    dur = row.get("ZDURATION")
                    if dur is not None and dur > 0:
                        meta["duration"] = round(float(dur), 2)

                    # Dimensions
                    _set_int(meta, "width", row.get("ZWIDTH"))
                    _set_int(meta, "height", row.get("ZHEIGHT"))
                    _set_int(meta, "original_width", row.get("ZORIGINALWIDTH"))
                    _set_int(meta, "original_height", row.get("ZORIGINALHEIGHT"))
                    _set_int(meta, "color_space", row.get("ZORIGINALCOLORSPACE"))

                    hdr = row.get("ZHDRGAIN")
                    if hdr is not None:
                        meta["hdr_gain"] = round(float(hdr), 4)

                    # Status flags
                    for db_col, key in [("ZFAVORITE", "favorite"), ("ZHIDDEN", "hidden"), ("ZTRASHEDSTATE", "trashed")]:
                        if db_col in row:
                            val = row[db_col]
                            meta[key] = bool(val) if val is not None else None

                    # View/play counts
                    _set_int(meta, "view_count", row.get("ZVIEWCOUNT"))
                    _set_int(meta, "play_count", row.get("ZPLAYCOUNT"))

                    # Original file info (ZADDITIONALASSETATTRIBUTES)
                    _set_int(meta, "original_file_size", row.get("ZORIGINALFILESIZE"))
                    _set_str(meta, "original_filename", row.get("ZORIGINALFILENAME"))

                    # Camera/lens — prefer ZEXTENDEDATTRIBUTES, fall back to ZADDITIONALASSETATTRIBUTES
                    _set_str(meta, "camera_make", row.get("EA_ZCAMERAMAKE") or row.get("ZCAMERAMAKE"))
                    _set_str(meta, "camera_model", row.get("EA_ZCAMERAMODEL") or row.get("ZCAMERAMODEL"))
                    _set_str(meta, "lens_model", row.get("EA_ZLENSMODEL") or row.get("ZLENSMODEL"))

                    # EXIF data (ZEXTENDEDATTRIBUTES)
                    _set_float(meta, "iso", row.get("EA_ZISO"))
                    _set_float(meta, "aperture", row.get("EA_ZAPERTURE"))
                    _set_float(meta, "focal_length", row.get("EA_ZFOCALLENGTH"))
                    _set_float(meta, "focal_length_35mm", row.get("EA_ZFOCALLENGTHIN35MM"))
                    _set_float(meta, "shutter_speed", row.get("EA_ZSHUTTERSPEED"))
                    _set_int(meta, "metering_mode", row.get("EA_ZMETERINGMODE"))
                    _set_int(meta, "white_balance", row.get("EA_ZWHITEBALANCE"))
                    flash = row.get("EA_ZFLASHFIRED")
                    if flash is not None:
                        meta["flash_fired"] = bool(flash)

                    db_meta[key] = meta

                    zuuid = row.get("ZUUID")
                    if zuuid:
                        uuid_to_db_meta[zuuid.upper()] = meta

                logger.info(f"Photos.sqlite: loaded metadata for {len(db_meta)} assets")
            finally:
                conn.close()
    except Exception as e:
        logger.warning(f"Could not open Photos.sqlite: {e}")

    # Step 2: Walk manifest and match using layered strategy
    path_to_db_meta = {}
    for db_key, meta in db_meta.items():
        path_to_db_meta[db_key] = meta

    image_items = list(manifest.items())
    total = len(image_items)
    path_count = 0
    uuid_count = 0
    exif_count = 0

    for idx, (file_id, info) in enumerate(image_items, 1):
        if progress_callback:
            progress_callback(idx, total)
        rel_path = info.get("relative_path", "")
        is_deep = info.get("source") is not None

        # Layer 1: Path suffix match (original Camera Roll files)
        matched_meta = None
        if path_to_db_meta and rel_path:
            parts = rel_path.split("/")
            for n in (2, 3):
                if len(parts) >= n:
                    suffix_key = "/".join(parts[-n:])
                    if suffix_key in path_to_db_meta:
                        matched_meta = path_to_db_meta[suffix_key]
                        path_count += 1
                        break

        # Layer 2: UUID match (derivatives, thumbnails, CPLAssets)
        if matched_meta is None and uuid_to_db_meta and rel_path and not is_deep:
            path_uuid = _extract_uuid_from_path(rel_path)
            if path_uuid and path_uuid in uuid_to_db_meta:
                matched_meta = uuid_to_db_meta[path_uuid]
                uuid_count += 1

        # Layer 3: EXIF fallback (no extension gate — let Pillow decide)
        exif_meta = None
        if matched_meta is None:
            try:
                candidates = list(output_dir.glob(f"{file_id}.*"))
                candidates.extend(output_dir.glob(f"_deep/{file_id}.*"))
                for candidate in candidates:
                    if candidate.is_file():
                        exif_meta = _extract_exif(str(candidate))
                        break
            except Exception as e:
                logger.debug(f"EXIF fallback failed for {file_id}: {e}")

        # Layer 4: Assign result — keep any data we found
        if matched_meta is not None:
            result[file_id] = dict(matched_meta)
        elif exif_meta is not None:
            has_any_data = any(
                v is not None for k, v in exif_meta.items()
                if k != "source_db"
            )
            if has_any_data:
                result[file_id] = exif_meta
                exif_count += 1

    logger.info(f"Photo metadata extracted: {len(result)} entries "
                f"({path_count} path-matched, {uuid_count} UUID-matched, "
                f"{exif_count} EXIF-only)")
    return result
