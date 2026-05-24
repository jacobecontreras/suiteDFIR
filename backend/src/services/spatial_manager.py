import os
import io
import csv
import logging
import asyncio
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional, Dict, Any, List

from core.config import REPORTS_DIR, DATA_DIR
from core.database import db_fetch_all

logger = logging.getLogger(__name__)

IMPORTS_DIR = os.path.join(DATA_DIR, "imports")
os.makedirs(IMPORTS_DIR, exist_ok=True)
MAX_SPATIAL_FILE_BYTES = 25 * 1024 * 1024


class SpatialManager:
    """Manages KML/KMZ file discovery and data enrichment for spatial visualization."""

    async def get_kml_files(self, case_id: Optional[int] = None) -> Dict[str, List[Dict[str, Any]]]:
        """Scan reports directory for KML files, optionally filtered by case_id."""
        loop = asyncio.get_running_loop()
        
        # Fetch report paths from DB
        report_map = {}
        try:
            if case_id:
                rows = await db_fetch_all(
                    "SELECT path, name FROM reports WHERE case_id = ?", (case_id,)
                )
            else:
                rows = await db_fetch_all("SELECT path, name FROM reports")
            
            for row in rows:
                report_map[os.path.normpath(row['path'])] = row['name']
        except Exception as e:
            logger.error(f"Error fetching report names from DB: {e}")

        # Scan for KML files in executor (IO-bound)
        def _scan_kml_files():
            kml_files = {}
            
            # 1. Scan Reports
            try:
                for root, dirs, files in os.walk(REPORTS_DIR):
                    if "_KML Exports" not in root:
                        continue
                    
                    parts = Path(root).parts
                    try:
                        kml_index = parts.index("_KML Exports")
                        folder_name = parts[kml_index - 1]
                        tool_name = parts[kml_index - 2].replace("-reports", "")
                        
                        # Get report directory path
                        report_dir = os.path.dirname(root)
                        norm_report_dir = os.path.normpath(report_dir)
                        
                        # Filter by case if specified
                        if case_id and norm_report_dir not in report_map:
                            continue
                        
                        # Use DB name or fallback to folder name
                        group_name = report_map.get(norm_report_dir, folder_name)
                        
                        if group_name not in kml_files:
                            kml_files[group_name] = []
                        
                        for file in files:
                            if file.lower().endswith(('.kml', '.kmz')):
                                relative_path = os.path.relpath(
                                    os.path.join(root, file), REPORTS_DIR
                                )
                                kml_files[group_name].append({
                                    "name": file,
                                    "url": f"/reports/{relative_path}",
                                    "path": os.path.join(root, file),
                                    "is_deletable": False
                                })
                    except ValueError:
                        continue
                        
            except Exception as e:
                logger.error(f"Error scanning report KML files: {e}")

            # 2. Scan Imports (if no specific case filter or if we want global imports always)
            # For now, show imports globally
            try:
                if os.path.exists(IMPORTS_DIR):
                    imported_files = []
                    for file in os.listdir(IMPORTS_DIR):
                        if file.lower().endswith(('.kml', '.kmz')):
                            imported_files.append({
                                "name": file,
                                "url": f"/imports/{file}",
                                "path": os.path.join(IMPORTS_DIR, file),
                                "is_deletable": True
                            })
                    
                    if imported_files:
                        kml_files["Imported Files"] = sorted(imported_files, key=lambda x: x['name'])
            
            except Exception as e:
                logger.error(f"Error scanning imported KML files: {e}")
            
            return kml_files
        
        return await loop.run_in_executor(None, _scan_kml_files)

    async def get_kml_data(self, path: str) -> bytes:
        """
        Fetch and enrich KML data with TSV content.
        Returns enriched KML as bytes, or raises Exception on error.
        """
        loop = asyncio.get_running_loop()
        
        def _process_kml():
            from utils.fs_ops import FileOperations
            if path.startswith("/imports/"):
                clean_path = path.replace("/imports/", "", 1)
                kml_abs_path = os.path.join(IMPORTS_DIR, clean_path)
                allowed_root = IMPORTS_DIR
            else:
                # Clean up path (remove leading /reports/)
                clean_path = path.replace("/reports/", "", 1)
                kml_abs_path = os.path.join(REPORTS_DIR, clean_path)
                allowed_root = REPORTS_DIR

            if not FileOperations.validate_path_security(kml_abs_path, allowed_root):
                raise PermissionError(f"Invalid KML path: {path}")

            if not os.path.exists(kml_abs_path):
                raise FileNotFoundError(f"KML file not found: {path}")

            if os.path.getsize(kml_abs_path) > MAX_SPATIAL_FILE_BYTES:
                raise ValueError("KML/KMZ file is too large to load safely")

            # Determine TSV path
            tsv_dir = os.path.dirname(kml_abs_path).replace("_KML Exports", "_TSV Exports")
            kml_filename = os.path.basename(kml_abs_path)
            
            # Try exact match first
            tsv_filename = kml_filename.replace(".kml", ".tsv")
            tsv_abs_path = os.path.join(tsv_dir, tsv_filename)
            
            # Fallback: remove " Location Data" suffix
            if not os.path.exists(tsv_abs_path):
                tsv_filename_alt = kml_filename.replace(" Location Data.kml", ".tsv")
                tsv_abs_path_alt = os.path.join(tsv_dir, tsv_filename_alt)
                if os.path.exists(tsv_abs_path_alt):
                    tsv_abs_path = tsv_abs_path_alt

            # Parse TSV data
            tsv_data = {}
            timestamp_col = None
            POSSIBLE_KEYS = [
                'Timestamp', 'Update Time', 'Date', 'Time', 
                'Created Time', 'Modified Time', 'DateTime'
            ]

            if os.path.exists(tsv_abs_path):
                try:
                    with open(tsv_abs_path, 'r', encoding='utf-8-sig', errors='replace') as f:
                        reader = csv.DictReader(f, delimiter='\t')
                        
                        if reader.fieldnames:
                            for key in POSSIBLE_KEYS:
                                if key in reader.fieldnames:
                                    timestamp_col = key
                                    break
                        
                        if timestamp_col:
                            for row in reader:
                                if timestamp_col in row:
                                    tsv_data[row[timestamp_col]] = row
                        else:
                            logger.warning(f"No timestamp column found in {tsv_filename}")

                except Exception as e:
                    logger.error(f"Error reading TSV file: {e}")

            # Parse and enrich KML
            try:
                ET.register_namespace('', "http://www.opengis.net/kml/2.2")
                tree = ET.parse(kml_abs_path)
                root = tree.getroot()
                
                ns = {'kml': 'http://www.opengis.net/kml/2.2'}
                placemarks = root.findall('.//kml:Placemark', ns)
                
                for placemark in placemarks:
                    name_elem = placemark.find('kml:name', ns)
                    desc_elem = placemark.find('kml:description', ns)
                    
                    if name_elem is not None and name_elem.text in tsv_data:
                        row = tsv_data[name_elem.text]
                        
                        # Build HTML table
                        artifact_name = tsv_filename.replace(".tsv", "")
                        html_table = '<table class="table table-striped table-bordered table-hover table-sm">'
                        html_table += f'<tr><td colspan="2"><strong>Artifact</strong></td><td>{artifact_name}</td></tr>'
                        
                        for key, value in row.items():
                            if key and value:
                                html_table += f'<tr><td colspan="2"><strong>{key}</strong></td><td>{value}</td></tr>'
                        html_table += '</table>'
                        
                        # Update description
                        if desc_elem is None:
                            desc_elem = ET.SubElement(placemark, 'description')
                        desc_elem.text = html_table

                # Return enriched KML
                output = io.BytesIO()
                tree.write(output, encoding='utf-8', xml_declaration=True)
                output.seek(0)
                return output.read()

            except Exception as e:
                logger.error(f"Error parsing KML: {e}")
                # Return original file on parse error
                with open(kml_abs_path, 'rb') as f:
                    return f.read()
        
        return await loop.run_in_executor(None, _process_kml)

    def get_kml_abs_path(self, path: str) -> str:
        """Convert relative KML path to absolute path for FileResponse fallback."""
        if path.startswith("/imports/"):
            clean_path = path.replace("/imports/", "", 1)
            return os.path.join(IMPORTS_DIR, clean_path)
        
        clean_path = path.replace("/reports/", "", 1)
        return os.path.join(REPORTS_DIR, clean_path)

    async def save_imported_file(self, file_content: bytes, filename: str) -> str:
        """Save uploaded KML/KMZ to imports directory."""
        loop = asyncio.get_running_loop()

        def _save():
            if len(file_content) > MAX_SPATIAL_FILE_BYTES:
                raise ValueError("KML/KMZ file exceeds the 25 MB import limit")

            # Sanitize filename
            safe_filename = os.path.basename(filename)
            file_path = os.path.join(IMPORTS_DIR, safe_filename)
            
            # Overwrite if exists (per plan)
            with open(file_path, "wb") as f:
                f.write(file_content)
            
            return safe_filename
            
        return await loop.run_in_executor(None, _save)

    async def delete_imported_file(self, filename: str) -> bool:
        """Delete file from imports directory."""
        loop = asyncio.get_running_loop()
        
        def _delete():
            # Sanitize filename (prevent directory traversal)
            safe_filename = os.path.basename(filename)
            file_path = os.path.join(IMPORTS_DIR, safe_filename)
            
            if os.path.exists(file_path):
                os.remove(file_path)
                return True
            return False
            
        return await loop.run_in_executor(None, _delete)


# Global instance
spatial_manager = SpatialManager()
