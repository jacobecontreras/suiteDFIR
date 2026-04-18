"""
iOS Backup Module

Handles iOS backup decryption and image extraction.
"""

import json
import plistlib
import hashlib
import sqlite3
import tempfile
import shutil
from pathlib import Path
from typing import Optional, Dict, List, Any, Callable
from dataclasses import dataclass
import logging

from cryptography.hazmat.primitives.keywrap import aes_key_unwrap, InvalidUnwrap
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

try:
    import nska_deserialize
    HAS_NSKA = True
except ImportError:
    HAS_NSKA = False

logger = logging.getLogger(__name__)

# Supported image extensions
IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.heic', '.heif', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.dng'}

# Magic byte signatures for common image formats
MAGIC_BYTES = {
    b'\xFF\xD8\xFF': '.jpg',
    b'\xFF\xD8\xFF\xE0': '.jpg',
    b'\xFF\xD8\xFF\xE1': '.jpg',
    b'\x89\x50\x4E\x47\x0D\x0A\x1A\x0A': '.png',
    b'\x47\x49\x46\x38': '.gif',
    b'\x00\x00\x00\x18\x66\x74\x79\x70\x6d\x70\x34\x32': '.heic',
    b'\x00\x00\x00\x1c\x66\x74\x79\x70\x68\x65\x69\x63': '.heic',
    b'\x00\x00\x00\x20\x66\x74\x79\x70\x68\x65\x69\x78': '.heif',
    b'\x49\x49\x2a\x00': '.dng',    # DNG / TIFF little-endian
    b'\x4d\x4d\x00\x2a': '.tiff',   # TIFF big-endian
}


@dataclass
class BackupFile:
    """Represents a file in the iOS backup."""
    file_id: str
    domain: str
    relative_path: str
    absolute_path: str
    flags: int
    size: int = 0
    encryption_key: Optional[bytes] = None
    protection_class: Optional[int] = None


def check_encryption_status(backup_path: Path) -> bool:
    """Check if an iOS backup is encrypted by reading Manifest.plist."""
    manifest_plist = backup_path / "Manifest.plist"
    if manifest_plist.exists():
        with open(manifest_plist, "rb") as f:
            plist_data = plistlib.load(f)
            return plist_data.get("IsEncrypted", False)
    return False


def get_backup_device_name(backup_path: Path) -> str:
    """Read device name from Info.plist. Returns a filesystem-safe name."""
    info_plist = backup_path / "Info.plist"
    name = None
    if info_plist.exists():
        try:
            with open(info_plist, "rb") as f:
                plist_data = plistlib.load(f)
                name = plist_data.get("Device Name")
        except Exception:
            pass
    if not name:
        name = backup_path.name
    # Make filesystem-safe
    safe = "".join(c if c.isalnum() or c in (" ", "-", "_") else "_" for c in name).strip()
    return safe or "unknown_device"


def read_magic_bytes(file_path: str, bytes_needed: int = 12) -> bytes:
    """Read the first N bytes from a file."""
    try:
        with open(file_path, 'rb') as f:
            return f.read(bytes_needed)
    except Exception:
        return b''


def magic_to_extension(magic: bytes) -> Optional[str]:
    """Map magic bytes to file extension."""
    for signature, ext in MAGIC_BYTES.items():
        if magic.startswith(signature):
            return ext
    if len(magic) >= 12 and magic[4:8] == b'ftyp':
        ftyp = magic[8:12]
        if ftyp in (b'heic', b'heix', b'heim', b'heis'):
            return '.heic'
        elif ftyp in (b'mif1', b'msf1'):
            return '.heif'
    # RIFF container: check format at offset 8 (WEBP vs WAVE etc.)
    if len(magic) >= 12 and magic[:4] == b'RIFF' and magic[8:12] == b'WEBP':
        return '.webp'
    return None


def is_image_file(backup_file: BackupFile, parser=None) -> bool:
    """Check if a file is an image using extension OR magic bytes."""
    if backup_file.relative_path:
        ext = Path(backup_file.relative_path).suffix
        if ext and ext.lower() in IMAGE_EXTENSIONS:
            return True

    if backup_file.encryption_key and parser:
        content = parser.decrypt_file_content(backup_file)
        if content:
            return magic_to_extension(content[:12]) is not None
    else:
        magic = read_magic_bytes(backup_file.absolute_path, 12)
        return magic_to_extension(magic) is not None
    return False


def get_output_filename(backup_file: BackupFile, parser=None) -> str:
    """Derive output filename from BackupFile."""
    if backup_file.relative_path:
        ext = Path(backup_file.relative_path).suffix
        if ext and ext.lower() in IMAGE_EXTENSIONS:
            return f"{backup_file.file_id}{ext.lower()}"

    if backup_file.encryption_key and parser:
        content = parser.decrypt_file_content(backup_file)
        if content:
            ext = magic_to_extension(content[:12])
            if ext:
                return f"{backup_file.file_id}{ext.lower()}"
    else:
        magic = read_magic_bytes(backup_file.absolute_path, 12)
        ext = magic_to_extension(magic)
        if ext:
            return f"{backup_file.file_id}{ext.lower()}"

    return f"{backup_file.file_id}.bin"


@dataclass
class DecryptionResult:
    """Result of backup decryption attempt."""
    success: bool
    message: str
    protection_classes: Optional[Dict] = None
    manifest_key: Optional[bytes] = None


class iOSBackupDecryptor:
    """Decrypts iOS backups using the backup password/passcode."""

    def __init__(self, backup_path: str):
        self.backup_path = Path(backup_path)
        self.manifest_plist = self.backup_path / "Manifest.plist"
        if not self.manifest_plist.exists():
            raise FileNotFoundError(f"Manifest.plist not found at {self.manifest_plist}")

    def decrypt_with_password(self, passcode: str) -> DecryptionResult:
        """Decrypt an iOS backup using the provided passcode."""
        try:
            with open(self.manifest_plist, "rb") as f:
                manifest = plistlib.load(f)

            manifest_key = manifest.get("ManifestKey")
            if not manifest_key:
                return DecryptionResult(
                    success=False,
                    message="No ManifestKey found. This backup may not be encrypted."
                )

            manifest_key_class = int.from_bytes(manifest_key[0:4], byteorder="little")
            manifest_wrapped_key = manifest_key[4:]

            backup_keybag = manifest.get("BackupKeyBag")
            if not backup_keybag:
                return DecryptionResult(success=False, message="No BackupKeyBag found.")

            protection_classes = self._parse_backup_keybag(backup_keybag, passcode)

            if manifest_key_class not in protection_classes:
                return DecryptionResult(
                    success=False,
                    message=f"Could not find protection class {manifest_key_class} for Manifest.db"
                )

            manifest_protection_class = protection_classes[manifest_key_class]
            unwrapped_key = manifest_protection_class.get("Unwrapped")
            if unwrapped_key is None:
                return DecryptionResult(
                    success=False,
                    message=f"Could not unwrap protection class {manifest_key_class}. Incorrect password?"
                )

            try:
                unwrapped_manifest_key = aes_key_unwrap(unwrapped_key, manifest_wrapped_key)
            except InvalidUnwrap:
                return DecryptionResult(success=False, message="Failed to unwrap manifest key. Incorrect password?")

            return DecryptionResult(
                success=True,
                message="Decryption successful",
                protection_classes=protection_classes,
                manifest_key=unwrapped_manifest_key
            )

        except Exception as e:
            return DecryptionResult(success=False, message=f"Decryption failed: {str(e)}")

    def _parse_backup_keybag(self, backup_keybag: bytes, passcode: str) -> Dict[int, Dict[str, Any]]:
        """Parse the BackupKeyBag to extract protection classes."""
        protection_classes = {}
        tmp_protection_class = {}
        keybag_uuid = None
        tmp_salt = b''
        tmp_iter = 0
        tmp_double_protection_salt = b''
        tmp_double_protection_iter = 0
        idx = 0

        while idx < len(backup_keybag):
            tmp_string_type = backup_keybag[idx:idx + 4]
            idx += 4
            tmp_length = int.from_bytes(backup_keybag[idx:idx + 4])
            idx += 4
            tmp_value = backup_keybag[idx:idx + tmp_length]
            idx += tmp_length

            match tmp_string_type:
                case b'CLAS':
                    tmp_protection_class['CLAS'] = int.from_bytes(tmp_value)
                case b'DPIC':
                    tmp_double_protection_iter = int.from_bytes(tmp_value)
                case b'DPSL':
                    tmp_double_protection_salt = tmp_value
                case b'ITER':
                    tmp_iter = int.from_bytes(tmp_value)
                case b'UUID':
                    if keybag_uuid is None:
                        keybag_uuid = tmp_value
                    else:
                        if tmp_protection_class:
                            protection_classes[tmp_protection_class['CLAS']] = tmp_protection_class
                        tmp_protection_class = {}
                case b'SALT':
                    tmp_salt = tmp_value
                case b'WPKY':
                    tmp_protection_class['WPKY'] = tmp_value

        if tmp_protection_class and 'CLAS' in tmp_protection_class:
            protection_classes[tmp_protection_class['CLAS']] = tmp_protection_class

        if tmp_double_protection_iter > 0 and tmp_double_protection_salt:
            initial_unwrapped_key = hashlib.pbkdf2_hmac(
                'sha256', passcode.encode('utf-8'), tmp_double_protection_salt, tmp_double_protection_iter
            )
        else:
            initial_unwrapped_key = passcode.encode('utf-8')

        unwrapped_key = hashlib.pbkdf2_hmac('sha1', initial_unwrapped_key, tmp_salt, tmp_iter, dklen=32)

        for _, pclass in protection_classes.items():
            if 'WPKY' in pclass:
                try:
                    pclass['Unwrapped'] = aes_key_unwrap(unwrapped_key, pclass['WPKY'])
                except InvalidUnwrap:
                    pclass['Unwrapped'] = None

        return protection_classes


def _parse_file_metadata(file_data: bytes) -> tuple:
    """Parse plist file_data blob from Manifest.db.

    Returns (file_size, encryption_key, protection_class).
    """
    file_size = 0
    encryption_key = None
    protection_class = None

    if not file_data:
        return file_size, encryption_key, protection_class

    try:
        file_metadata = plistlib.loads(file_data)
        if file_metadata.get('$archiver') == 'NSKeyedArchiver' and HAS_NSKA:
            try:
                file_metadata = nska_deserialize.deserialize_plist_from_string(file_data)
            except Exception:
                file_metadata = {}

        file_size = file_metadata.get('Size', 0)

        enc_key_container = file_metadata.get('EncryptionKey')
        if enc_key_container:
            if isinstance(enc_key_container, dict) and 'NS.data' in enc_key_container:
                enc_key_data = enc_key_container['NS.data']
            elif isinstance(enc_key_container, bytes):
                enc_key_data = enc_key_container
            else:
                enc_key_data = None

            if enc_key_data and isinstance(enc_key_data, bytes) and len(enc_key_data) > 4:
                protection_class = int.from_bytes(enc_key_data[0:4], byteorder='little')
                encryption_key = enc_key_data[4:]
    except Exception:
        pass

    return file_size, encryption_key, protection_class


class iOSBackupParser:
    """Parser for iOS iTunes/Finder backups (iOS 10+ with Manifest.db)."""

    def __init__(
        self,
        backup_path: str,
        unwrapped_manifest_key: Optional[bytes] = None,
        protection_classes: Optional[Dict] = None
    ):
        self.backup_path = Path(backup_path)
        self.unwrapped_manifest_key = unwrapped_manifest_key
        self.protection_classes = protection_classes

        if not self.backup_path.exists():
            raise FileNotFoundError(f"Backup path not found: {backup_path}")

        self.manifest_db = self.backup_path / "Manifest.db"
        self.manifest_plist = self.backup_path / "Manifest.plist"
        self._decrypted_manifest_db = None
        self._is_encrypted = None
        self._decrypted_cache: Dict[str, Optional[bytes]] = {}

        self.format = self._detect_format()

    def _detect_format(self) -> str:
        """Detect which backup format is being used."""
        if self.manifest_plist.exists():
            try:
                with open(self.manifest_plist, "rb") as f:
                    plist_data = plistlib.load(f)
                    self._is_encrypted = plist_data.get("IsEncrypted", False)
            except Exception:
                pass

        if (self.backup_path / "Manifest.mbdb").exists() and not self.manifest_db.exists():
            raise ValueError(
                "Unsupported backup format: Legacy MBDB backups (pre-iOS 10) are not supported. "
                "This tool only supports iOS 10+ backups with Manifest.db."
            )

        if self.unwrapped_manifest_key and self.manifest_db.exists():
            try:
                self._decrypted_manifest_db = self._decrypt_manifest_db()
                return "db"
            except Exception as e:
                raise ValueError(f"Failed to decrypt Manifest.db: {e}")

        if self.manifest_db.exists():
            try:
                conn = sqlite3.connect(self.manifest_db)
                conn.cursor().execute("SELECT name FROM sqlite_master WHERE type='table'")
                conn.close()
                return "db"
            except sqlite3.DatabaseError:
                if self._is_encrypted:
                    raise ValueError("This backup is encrypted and no decryption key was provided.")
                raise ValueError("Manifest.db exists but is not a valid database.")

        raise ValueError("No valid manifest file found. Expected Manifest.db (iOS 10+).")

    def _decrypt_manifest_db(self) -> str:
        """Decrypt Manifest.db using the unwrapped manifest key."""
        temp_dir = Path(tempfile.gettempdir())
        decrypted_path = temp_dir / f"decrypted_manifest_{id(self)}.db"

        with open(self.manifest_db, "rb") as f:
            encrypted_data = f.read()

        null_iv = b'\x00' * 16
        cipher = Cipher(algorithms.AES(self.unwrapped_manifest_key), modes.CBC(null_iv))
        decryptor = cipher.decryptor()
        decrypted_data = decryptor.update(encrypted_data) + decryptor.finalize()

        padding_len = decrypted_data[-1]
        if padding_len <= 16:
            decrypted_data = decrypted_data[:-padding_len]

        with open(decrypted_path, "wb") as f:
            f.write(decrypted_data)

        logger.info(f"Decrypted Manifest.db to {decrypted_path}")
        return str(decrypted_path)

    def decrypt_file_content(self, backup_file: BackupFile) -> Optional[bytes]:
        """Decrypt the content of an encrypted file from the backup, with caching."""
        if backup_file.file_id in self._decrypted_cache:
            return self._decrypted_cache[backup_file.file_id]
        content = self._decrypt_file_content_uncached(backup_file)
        self._decrypted_cache[backup_file.file_id] = content
        return content

    def _decrypt_file_content_uncached(self, backup_file: BackupFile) -> Optional[bytes]:
        """Decrypt the content of an encrypted file from the backup."""
        if not backup_file.encryption_key:
            with open(backup_file.absolute_path, 'rb') as f:
                return f.read()

        if not self.protection_classes or backup_file.protection_class is None:
            return None

        if backup_file.protection_class not in self.protection_classes:
            return None

        protection_class = self.protection_classes[backup_file.protection_class]
        class_key = protection_class.get('Unwrapped')
        if not class_key:
            return None

        try:
            file_key = aes_key_unwrap(class_key, backup_file.encryption_key)

            with open(backup_file.absolute_path, 'rb') as f:
                encrypted_content = f.read()

            null_iv = b'\x00' * 16
            cipher = Cipher(algorithms.AES(file_key), modes.CBC(null_iv))
            decryptor = cipher.decryptor()
            decrypted_content = decryptor.update(encrypted_content) + decryptor.finalize()

            actual_size = backup_file.size if backup_file.size > 0 else len(decrypted_content)
            decrypted_content = decrypted_content[:actual_size]

            return decrypted_content

        except Exception as e:
            logger.error(f"Failed to decrypt file {backup_file.file_id}: {e}")
            return None

    def get_backup_info(self) -> Dict:
        """Extract backup metadata from Info.plist and Manifest.plist."""
        info = {}
        info_plist = self.backup_path / "Info.plist"

        if info_plist.exists():
            try:
                with open(info_plist, "rb") as f:
                    plist_data = plistlib.load(f)
                    info.update({
                        "device_name": plist_data.get("Device Name"),
                        "product_version": plist_data.get("Product Version"),
                    })
            except Exception:
                pass

        if self.manifest_plist.exists():
            try:
                with open(self.manifest_plist, "rb") as f:
                    plist_data = plistlib.load(f)
                    info.update({
                        "is_encrypted": plist_data.get("IsEncrypted", False),
                    })
            except Exception:
                pass

        return info

    def parse_manifest_db(self, filter_images: bool = True) -> List[BackupFile]:
        """Parse Manifest.db to extract file metadata."""
        manifest_path = self._decrypted_manifest_db if self._decrypted_manifest_db else self.manifest_db
        conn = sqlite3.connect(manifest_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute("SELECT fileID, domain, relativePath, flags, file FROM Files")
        results = []

        for row in cursor.fetchall():
            file_id = row['fileID']
            domain = row['domain']
            relative_path = row['relativePath']
            flags = row['flags']
            file_data = row['file']

            file_path = self.backup_path / file_id[:2] / file_id
            file_size, encryption_key, protection_class = _parse_file_metadata(file_data)

            backup_file = BackupFile(
                file_id=file_id,
                domain=domain,
                relative_path=relative_path,
                absolute_path=str(file_path),
                flags=flags,
                size=file_size,
                encryption_key=encryption_key,
                protection_class=protection_class
            )

            if filter_images and not is_image_file(backup_file, self):
                continue

            if file_path.exists():
                results.append(backup_file)

        conn.close()
        return results

    def get_all_files(self, filter_images: bool = True) -> List[BackupFile]:
        """Get all files from the backup."""
        if self.format == "db":
            return self.parse_manifest_db(filter_images)
        else:
            raise ValueError("Unsupported backup format")

    def extract_file(self, backup_file: BackupFile, output_path: str) -> bool:
        """Extract a single file from the backup."""
        dst = Path(output_path)
        dst.parent.mkdir(parents=True, exist_ok=True)

        if backup_file.encryption_key and self.protection_classes:
            content = self.decrypt_file_content(backup_file)
            if content is None:
                return False
            try:
                with open(dst, 'wb') as f:
                    f.write(content)
                return True
            except Exception as e:
                logger.error(f"Failed to write decrypted file {backup_file.file_id}: {e}")
                return False
        else:
            src = Path(backup_file.absolute_path)
            if not src.exists():
                return False
            try:
                shutil.copy2(src, dst)
                return True
            except Exception as e:
                logger.error(f"Failed to extract {backup_file.file_id}: {e}")
                return False

    def extract_files(
        self,
        output_dir: str,
        backup_files: Optional[List[BackupFile]] = None,
        progress_callback: Optional[callable] = None
    ) -> List[str]:
        """Extract multiple files from the backup."""
        if backup_files is None:
            backup_files = self.get_all_files(filter_images=True)

        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        extracted = []
        total = len(backup_files)

        for i, backup_file in enumerate(backup_files):
            dst_name = get_output_filename(backup_file, self)
            dst = output_path / dst_name

            if dst.exists():
                logger.debug(f"Skipping duplicate: {dst_name}")
                continue

            if self.extract_file(backup_file, dst):
                extracted.append(str(dst))

            self._decrypted_cache.pop(backup_file.file_id, None)

            if progress_callback:
                progress_callback(i + 1, total, dst_name)

        return extracted

    # ------------------------------------------------------------------
    # Deep extraction — images from app databases and BLOBs
    # ------------------------------------------------------------------

    def _lookup_file(self, domain: str, relative_path: str) -> Optional[BackupFile]:
        """Look up a single file in Manifest.db by domain + relativePath."""
        manifest_path = self._decrypted_manifest_db if self._decrypted_manifest_db else self.manifest_db
        conn = sqlite3.connect(manifest_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(
            "SELECT fileID, domain, relativePath, flags, file FROM Files "
            "WHERE domain = ? AND relativePath = ?",
            (domain, relative_path),
        )
        row = cursor.fetchone()
        if not row:
            conn.close()
            return None

        file_id = row['fileID']
        file_path = self.backup_path / file_id[:2] / file_id

        file_size, encryption_key, protection_class = _parse_file_metadata(row['file'])

        conn.close()

        if not file_path.exists():
            return None

        return BackupFile(
            file_id=file_id,
            domain=domain,
            relative_path=relative_path,
            absolute_path=str(file_path),
            flags=row['flags'],
            size=file_size,
            encryption_key=encryption_key,
            protection_class=protection_class,
        )

    def _open_backup_db(self, domain: str, relative_path: str) -> Optional[sqlite3.Connection]:
        """Open a SQLite database from within the backup, decrypting if needed."""
        bf = self._lookup_file(domain, relative_path)
        if not bf:
            return None

        if bf.encryption_key:
            content = self.decrypt_file_content(bf)
            if not content:
                return None
            tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
            tmp.write(content)
            tmp.close()
            self._temp_dbs.append(tmp.name)
            db_path = tmp.name
        else:
            db_path = bf.absolute_path

        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            return conn
        except Exception as e:
            logger.error(f"Failed to open backup db {domain}/{relative_path}: {e}")
            return None

    def open_backup_db(self, domain: str, relative_path: str) -> Optional[sqlite3.Connection]:
        """Open a SQLite database from within the backup.

        Public wrapper around _open_backup_db() for use by external modules
        (e.g. metadata extraction).
        """
        return self._open_backup_db(domain, relative_path)

    def extract_deep_images(
        self,
        output_dir: str,
        progress_callback: Optional[callable] = None,
        include_sources: Optional[set] = None,
        seen_file_ids: Optional[set] = None,
    ) -> Dict[str, dict]:
        """Extract images from app databases (BLOBs and file references).

        If include_sources is None, all sources run. Otherwise only the
        specified keys are processed (e.g. {"face_crops", "imessage_attachments"}).

        seen_file_ids is a set of backup file IDs already extracted by the
        standard Camera Roll pass.  Deep extractors that resolve files via
        _lookup_file will skip any file whose backup ID is already present,
        preventing duplicates.

        Returns a manifest dict mapping filename -> metadata for extracted images.
        """
        deep_dir = Path(output_dir) / "_deep"
        deep_dir.mkdir(parents=True, exist_ok=True)
        self._temp_dbs: list = []
        self._seen_file_ids: set = seen_file_ids or set()
        manifest = {}
        extracted_count = 0

        sources = [
            ("face_crops", "Face Crops", self._extract_face_crops),
            ("contact_photos", "Contact Photos", self._extract_contact_photos),
            ("imessage_attachments", "iMessage Attachments", self._extract_imessage_images),
            ("whatsapp_images", "WhatsApp Images", self._extract_whatsapp_images),
            ("notes_attachments", "Notes Attachments", self._extract_notes_images),
        ]

        for source_key, source_name, extractor in sources:
            if include_sources is not None and source_key not in include_sources:
                continue
            try:
                results = extractor(deep_dir)
                if results:
                    manifest.update(results)
                    extracted_count += len(results)
                    logger.info(f"Deep extraction [{source_name}]: {len(results)} images")
                else:
                    logger.info(f"Deep extraction [{source_name}]: no images found")
            except Exception as e:
                logger.warning(f"Deep extraction [{source_name}] failed: {e}")

        # Clean up temp database files
        for tmp_path in self._temp_dbs:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass
        self._temp_dbs = []

        logger.info(f"Deep extraction complete: {extracted_count} total images")
        return manifest

    def _extract_face_crops(self, output_dir: Path) -> Dict[str, dict]:
        """Extract face crop JPEG BLOBs from Photos.sqlite."""
        conn = self._open_backup_db("CameraRollDomain", "Media/PhotoData/Photos.sqlite")
        if not conn:
            return {}

        manifest = {}
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT fc.ZRESOURCEDATA, fc.Z_PK, df.ZASSET
                FROM ZFACECROP fc
                JOIN ZDETECTEDFACE df ON fc.ZFACE = df.Z_PK
                WHERE fc.ZRESOURCEDATA IS NOT NULL
            """)
            for row in cursor.fetchall():
                blob = row['ZRESOURCEDATA']
                pk = row['Z_PK']
                if not blob or len(blob) < 100:
                    continue
                filename = f"facecrop_{pk}.jpg"
                dst = output_dir / filename
                if dst.exists():
                    continue
                dst.write_bytes(blob)
                manifest[f"facecrop_{pk}"] = {
                    "relative_path": f"Photos.sqlite/ZFACECROP/{pk}",
                    "domain": "CameraRollDomain",
                    "source": "face_crop",
                }
        except Exception as e:
            logger.warning(f"Face crop extraction error: {e}")
        finally:
            conn.close()
        return manifest

    def _extract_contact_photos(self, output_dir: Path) -> Dict[str, dict]:
        """Extract contact photo BLOBs from AddressBookImages.sqlitedb."""
        conn = self._open_backup_db("HomeDomain", "Library/AddressBook/AddressBookImages.sqlitedb")
        if not conn:
            return {}

        manifest = {}
        try:
            cursor = conn.cursor()
            # Get full-size images, fall back to thumbnails
            try:
                cursor.execute("SELECT record_id, data FROM ABFullSizeImage WHERE data IS NOT NULL")
                full_size_ids = set()
                for row in cursor.fetchall():
                    rid = row['record_id']
                    blob = row['data']
                    if not blob or len(blob) < 100:
                        continue
                    full_size_ids.add(rid)
                    filename = f"contact_{rid}.jpg"
                    dst = output_dir / filename
                    if dst.exists():
                        continue
                    dst.write_bytes(blob)
                    manifest[f"contact_{rid}"] = {
                        "relative_path": f"AddressBookImages/ABFullSizeImage/{rid}",
                        "domain": "HomeDomain",
                        "source": "contact_photo",
                    }
            except Exception:
                full_size_ids = set()

            try:
                cursor.execute("SELECT record_id, data FROM ABThumbnailImage WHERE data IS NOT NULL")
                for row in cursor.fetchall():
                    rid = row['record_id']
                    if rid in full_size_ids:
                        continue
                    blob = row['data']
                    if not blob or len(blob) < 100:
                        continue
                    filename = f"contact_{rid}.jpg"
                    dst = output_dir / filename
                    if dst.exists():
                        continue
                    dst.write_bytes(blob)
                    manifest[f"contact_{rid}"] = {
                        "relative_path": f"AddressBookImages/ABThumbnailImage/{rid}",
                        "domain": "HomeDomain",
                        "source": "contact_photo",
                    }
            except Exception:
                pass
        finally:
            conn.close()
        return manifest

    def _extract_imessage_images(self, output_dir: Path) -> Dict[str, dict]:
        """Extract image attachments referenced in sms.db."""
        conn = self._open_backup_db("HomeDomain", "Library/SMS/sms.db")
        if not conn:
            return {}

        manifest = {}
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT a.ROWID, a.filename, a.mime_type, a.transfer_name
                FROM attachment a
                JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
                WHERE a.mime_type LIKE 'image/%'
                  AND a.filename IS NOT NULL
            """)
            for row in cursor.fetchall():
                rowid = row['ROWID']
                raw_path = row['filename']
                transfer_name = row['transfer_name'] or f"imessage_{rowid}"

                if not raw_path:
                    continue

                # Translate ~/Library/SMS/Attachments/... to MediaDomain path
                rel_path = raw_path.replace("~/", "")
                bf = self._lookup_file("MediaDomain", rel_path)
                if not bf:
                    continue

                # Skip if this backup file was already extracted (e.g. Camera Roll)
                if bf.file_id in self._seen_file_ids:
                    continue

                ext = Path(transfer_name).suffix.lower() or ".jpg"
                filename = f"imessage_{rowid}{ext}"
                dst = output_dir / filename
                if dst.exists():
                    continue

                if bf.encryption_key:
                    content = self.decrypt_file_content(bf)
                    if content:
                        dst.write_bytes(content)
                else:
                    shutil.copy2(bf.absolute_path, str(dst))

                manifest[f"imessage_{rowid}"] = {
                    "relative_path": raw_path,
                    "domain": "MediaDomain",
                    "source": "imessage",
                    "transfer_name": transfer_name,
                }
        except Exception as e:
            logger.warning(f"iMessage extraction error: {e}")
        finally:
            conn.close()
        return manifest

    def _extract_whatsapp_images(self, output_dir: Path) -> Dict[str, dict]:
        """Extract image files referenced in WhatsApp ChatStorage.sqlite."""
        wa_domain = "AppDomainGroup-group.net.whatsapp.WhatsApp.shared"
        conn = self._open_backup_db(wa_domain, "ChatStorage.sqlite")
        if not conn:
            return {}

        manifest = {}
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT mi.Z_PK, mi.ZMEDIALOCALPATH, m.ZMESSAGETYPE
                FROM ZWAMEDIAITEM mi
                JOIN ZWAMESSAGE m ON mi.ZMESSAGE = m.Z_PK
                WHERE mi.ZMEDIALOCALPATH IS NOT NULL
                  AND m.ZMESSAGETYPE IN (1, 2)
            """)
            for row in cursor.fetchall():
                pk = row['Z_PK']
                media_path = row['ZMEDIALOCALPATH']
                if not media_path:
                    continue

                bf = self._lookup_file(wa_domain, media_path)
                if not bf:
                    continue

                if bf.file_id in self._seen_file_ids:
                    continue

                ext = Path(media_path).suffix.lower() or ".jpg"
                filename = f"whatsapp_{pk}{ext}"
                dst = output_dir / filename
                if dst.exists():
                    continue

                if bf.encryption_key:
                    content = self.decrypt_file_content(bf)
                    if content:
                        dst.write_bytes(content)
                else:
                    shutil.copy2(bf.absolute_path, str(dst))

                manifest[f"whatsapp_{pk}"] = {
                    "relative_path": media_path,
                    "domain": wa_domain,
                    "source": "whatsapp",
                }
        except Exception as e:
            logger.warning(f"WhatsApp extraction error: {e}")
        finally:
            conn.close()
        return manifest

    def _extract_notes_images(self, output_dir: Path) -> Dict[str, dict]:
        """Extract image attachments from Notes (NoteStore.sqlite)."""
        notes_domain = "AppDomainGroup-group.com.apple.notes"
        conn = self._open_backup_db(notes_domain, "NoteStore.sqlite")
        if not conn:
            return {}

        manifest = {}
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT ZIDENTIFIER, ZFILENAME, ZTYPEUTI, ZACCOUNT2
                FROM ZICCLOUDSYNCINGOBJECT
                WHERE (ZTYPEUTI LIKE 'public.image%'
                    OR ZTYPEUTI LIKE 'public.jpeg%'
                    OR ZTYPEUTI LIKE 'public.png%'
                    OR ZTYPEUTI LIKE 'public.heic%')
                  AND ZFILENAME IS NOT NULL
                  AND ZIDENTIFIER IS NOT NULL
            """)
            for row in cursor.fetchall():
                uuid = row['ZIDENTIFIER']
                filename_orig = row['ZFILENAME']
                account = row['ZACCOUNT2']

                # Notes media path pattern: Accounts/<account>/Media/<UUID>/<filename>
                # Try common path patterns
                found = False
                for pattern in [
                    f"Accounts/LocalAccount/Media/{uuid}/{filename_orig}",
                    f"Media/{uuid}/{filename_orig}",
                ]:
                    bf = self._lookup_file(notes_domain, pattern)
                    if bf:
                        if bf.file_id in self._seen_file_ids:
                            found = True
                            break
                        ext = Path(filename_orig).suffix.lower() or ".jpg"
                        out_name = f"notes_{uuid}{ext}"
                        dst = output_dir / out_name
                        if dst.exists():
                            found = True
                            break

                        if bf.encryption_key:
                            content = self.decrypt_file_content(bf)
                            if content:
                                dst.write_bytes(content)
                        else:
                            shutil.copy2(bf.absolute_path, str(dst))

                        manifest[f"notes_{uuid}"] = {
                            "relative_path": pattern,
                            "domain": notes_domain,
                            "source": "notes",
                            "original_filename": filename_orig,
                        }
                        found = True
                        break

        except Exception as e:
            logger.warning(f"Notes extraction error: {e}")
        finally:
            conn.close()
        return manifest

    def cleanup(self):
        """Clean up temporary files created during decryption."""
        if self._decrypted_manifest_db:
            try:
                Path(self._decrypted_manifest_db).unlink(missing_ok=True)
                self._decrypted_manifest_db = None
            except Exception:
                pass

    def __del__(self):
        """Destructor to clean up temporary files."""
        try:
            self.cleanup()
        except Exception:
            pass


def run_extraction(
    backup_path: Path,
    output_path: Path,
    password: Optional[str] = None,
    extract_progress: Optional[Callable] = None,
    index_progress: Optional[Callable] = None,
    metadata_progress: Optional[Callable] = None,
    status_update: Optional[Callable] = None,
    include_artifacts: Optional[set] = None,
) -> Optional[dict]:
    """Run the full extraction pipeline: decrypt, extract, deep-extract, index.

    If include_artifacts is None, all stages run (backwards-compatible).
    Otherwise only the specified artifact keys are processed:
      camera_roll, face_crops, contact_photos, imessage_attachments,
      whatsapp_images, notes_attachments, photo_metadata, search_index

    Returns the file manifest dict on success, None if no images found.
    Raises ValueError on decryption failure.
    """
    def _status(msg: str):
        if status_update:
            status_update(msg)

    is_encrypted = check_encryption_status(backup_path)

    if is_encrypted:
        if not password:
            raise ValueError("Backup is encrypted but no password provided.")
        decryptor = iOSBackupDecryptor(str(backup_path))
        result = decryptor.decrypt_with_password(password)
        if not result.success:
            raise ValueError(result.message)

        parser = iOSBackupParser(
            str(backup_path),
            unwrapped_manifest_key=result.manifest_key,
            protection_classes=result.protection_classes,
        )
        all_files = parser.get_all_files(filter_images=False)
        image_files = [f for f in all_files if is_image_file(f, parser)]
    else:
        parser = iOSBackupParser(str(backup_path))
        image_files = parser.get_all_files(filter_images=True)

    run_camera_roll = include_artifacts is None or "camera_roll" in include_artifacts
    deep_sources = {"face_crops", "contact_photos", "imessage_attachments", "whatsapp_images", "notes_attachments"}
    run_deep = include_artifacts is None or bool(deep_sources & include_artifacts)
    run_metadata = include_artifacts is None or "photo_metadata" in include_artifacts
    run_index = include_artifacts is None or "search_index" in include_artifacts

    manifest = {}

    # Standard Camera Roll extraction
    if run_camera_roll:
        if not image_files:
            _status("No Camera Roll images found.")
        else:
            _status(f"Extracting {len(image_files)} images...")
            parser.extract_files(
                str(output_path),
                backup_files=image_files,
                progress_callback=extract_progress,
            )
            for f in image_files:
                rel = f.relative_path or ""
                manifest[f.file_id] = {
                    "relative_path": f.relative_path,
                    "domain": f.domain,
                    "classification": "original" if rel.startswith("Media/DCIM/") else "derivative",
                }

    if not run_camera_roll and not run_deep:
        parser.cleanup()
        return None

    # Build set of backup file IDs already extracted so deep sources skip duplicates
    seen_file_ids = {f.file_id for f in image_files} if image_files else set()

    # Deep extraction (selective)
    if run_deep:
        include_deep = (include_artifacts & deep_sources) if include_artifacts else None
        _status("Deep extraction (databases, BLOBs)...")
        deep_manifest = parser.extract_deep_images(
            str(output_path), include_sources=include_deep, seen_file_ids=seen_file_ids,
        )
        if deep_manifest:
            for file_id, entry in deep_manifest.items():
                if "classification" not in entry:
                    entry["classification"] = "derivative"
            manifest.update(deep_manifest)

    if not manifest:
        parser.cleanup()
        return None

    # Photo metadata extraction (GPS, dates, media type)
    if run_metadata:
        _status("Extracting photo metadata...")
        try:
            from .metadata import extract_photo_metadata
            photo_meta = extract_photo_metadata(parser, manifest, output_path,
                                                   progress_callback=metadata_progress)
            for file_id, meta in photo_meta.items():
                if file_id in manifest:
                    manifest[file_id]["photo_metadata"] = meta
        except Exception as e:
            logger.warning(f"Photo metadata extraction failed: {e}")

    # Save manifest
    manifest_path = output_path / "file_manifest.json"
    with open(manifest_path, "w") as mf:
        json.dump(manifest, mf)

    parser.cleanup()

    # Build CLIP search index
    if run_index:
        _status("Building search index...")
        from .semantic import SemanticIndex

        index_dir = str(output_path / ".search_index")
        index = SemanticIndex(index_dir)
        index.build_index(
            str(output_path),
            file_manifest=manifest,
            progress_callback=index_progress,
        )

    return manifest
