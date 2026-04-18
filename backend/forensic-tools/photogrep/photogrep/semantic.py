"""
Semantic Search Module

Builds and queries a CLIP-based search index over extracted images.
"""

import json
import logging
from pathlib import Path
from dataclasses import dataclass
from typing import List, Optional, Callable

import os

import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
from PIL import Image
import open_clip
import faiss

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:
    pass

logger = logging.getLogger(__name__)


def forensic_image_open(path: str) -> Image.Image:
    """Open an image file, handling base64-encoded content in-memory.

    Some iOS backup artifacts store images as base64 text (e.g. iMessage
    attachments, app caches).  This function detects that case and decodes
    in-memory without modifying the original file on disk, preserving
    forensic integrity of the extracted evidence.
    """
    import base64
    import io

    try:
        return Image.open(path)
    except Exception:
        pass

    # Check if the file contains base64-encoded image data
    with open(path, "rb") as f:
        head = f.read(32)

    # base64-encoded JPEG starts with /9j/, PNG with iVBOR
    if head[:4] in (b"/9j/", b"iVBO"):
        with open(path, "rb") as f:
            raw = f.read()
        decoded = base64.b64decode(raw)
        img = Image.open(io.BytesIO(decoded))
        logger.debug(f"Decoded base64 image: {path}")
        return img

    raise OSError(f"cannot open image file '{path}'")

from .ios_backup import IMAGE_EXTENSIONS

class _ImageDataset(Dataset):
    """Dataset that loads and preprocesses images in parallel via DataLoader workers."""

    def __init__(self, image_paths: List[str], preprocess):
        self.image_paths = image_paths
        self.preprocess = preprocess
        self._blank = self.preprocess(Image.new("RGB", (224, 224)))

    def __len__(self):
        return len(self.image_paths)

    def __getitem__(self, idx):
        try:
            img = forensic_image_open(self.image_paths[idx]).convert("RGB")
            return self.preprocess(img)
        except Exception as e:
            logger.warning(f"Skipping unreadable image {self.image_paths[idx]}: {e}")
            return self._blank


INDEX_FILENAME = "image_index.faiss"
METADATA_FILENAME = "metadata.json"


@dataclass
class SearchResult:
    file_path: str
    file_id: str
    score: float


class SemanticIndex:
    """CLIP-based semantic search index for images."""

    def __init__(
        self,
        index_dir: str,
        model_name: str = "ViT-B-32",
        pretrained: str = "laion2b_s34b_b79k",
    ):
        self.index_dir = Path(index_dir)
        self.model_name = model_name
        self.pretrained = pretrained

        self._model = None
        self._preprocess = None
        self._tokenizer = None
        self._device = None

        self.faiss_index: Optional[faiss.Index] = None
        self.metadata: List[dict] = []

        if (self.index_dir / INDEX_FILENAME).exists():
            self._load_index()

    def _get_device(self) -> str:
        if self._device is None:
            if torch.backends.mps.is_available():
                self._device = "mps"
            elif torch.cuda.is_available():
                self._device = "cuda"
            else:
                self._device = "cpu"
            logger.info(f"Using device: {self._device}")
        return self._device

    def _load_model(self):
        if self._model is not None:
            return
        device = self._get_device()
        if device == "cuda":
            torch.backends.cudnn.benchmark = True
        self._model, _, self._preprocess = open_clip.create_model_and_transforms(
            self.model_name, pretrained=self.pretrained
        )
        self._model = self._model.to(device).eval()
        self._tokenizer = open_clip.get_tokenizer(self.model_name)

    def _encode_images_batch(
        self,
        image_paths: List[str],
        batch_size: int = 64,
        progress_callback: Optional[Callable] = None,
    ) -> np.ndarray:
        """Batch-encode images with CLIP. Returns L2-normalized embeddings."""
        self._load_model()
        device = self._get_device()
        all_embeddings = []
        total = len(image_paths)
        num_workers = min(os.cpu_count() or 1, 8)
        use_amp = device == "cuda"

        dataset = _ImageDataset(image_paths, self._preprocess)
        loader = DataLoader(
            dataset,
            batch_size=batch_size,
            num_workers=num_workers,
            pin_memory=(device == "cuda"),
            persistent_workers=num_workers > 0,
        )

        processed = 0
        for batch_tensor in loader:
            batch_tensor = batch_tensor.to(device, non_blocking=True)
            with torch.no_grad():
                if use_amp:
                    with torch.amp.autocast("cuda"):
                        features = self._model.encode_image(batch_tensor)
                else:
                    features = self._model.encode_image(batch_tensor)
                features = features.float()
                features /= features.norm(dim=-1, keepdim=True)

            all_embeddings.append(features.cpu())

            processed += batch_tensor.shape[0]
            if progress_callback:
                progress_callback(min(processed, total), total)

        return torch.cat(all_embeddings, dim=0).numpy().astype("float32")

    def _encode_text(self, text: str) -> np.ndarray:
        """Encode a text query with CLIP. Returns L2-normalized embedding."""
        self._load_model()
        device = self._get_device()
        tokens = self._tokenizer([text]).to(device)
        with torch.no_grad():
            features = self._model.encode_text(tokens)
            features /= features.norm(dim=-1, keepdim=True)
        return features.cpu().numpy().astype("float32")

    def build_index(
        self,
        image_dir: str,
        file_manifest: Optional[dict] = None,
        progress_callback: Optional[Callable] = None,
    ):
        """Build the search index from a directory of extracted images."""
        image_dir = Path(image_dir)

        image_paths = sorted(
            str(p) for p in image_dir.rglob("*")
            if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS
            and not p.parent.name.startswith(".")
        )

        if not image_paths:
            print("No images found to index.")
            return

        total_images = len(image_paths)
        print(f"Indexing {total_images} images...")
        print("\nGenerating CLIP embeddings...")

        embeddings = self._encode_images_batch(image_paths, progress_callback=progress_callback)

        self.metadata = []
        for img_path in image_paths:
            file_id = Path(img_path).stem
            entry = {
                "file_path": img_path,
                "file_id": file_id,
            }
            if file_manifest and file_id in file_manifest:
                entry["relative_path"] = file_manifest[file_id].get("relative_path", "")
                entry["domain"] = file_manifest[file_id].get("domain", "")
                entry["photo_metadata"] = file_manifest[file_id].get("photo_metadata", {})
            self.metadata.append(entry)

        embedding_dim = embeddings.shape[1]
        self.faiss_index = faiss.IndexFlatIP(embedding_dim)
        faiss.normalize_L2(embeddings)
        self.faiss_index.add(embeddings)

        self._save_index()
        print(f"\nIndex saved to {self.index_dir}")

    def search(self, query: str, threshold: float = 0.20) -> List[SearchResult]:
        """Search images by text query, returning all results above a score threshold."""
        if self.faiss_index is None or not self.metadata:
            raise RuntimeError("No index loaded. Run 'index' first.")

        query_embedding = self._encode_text(query)
        faiss.normalize_L2(query_embedding)
        scores, indices = self.faiss_index.search(query_embedding, len(self.metadata))

        results = []
        for score, idx in zip(scores[0], indices[0]):
            if idx < 0 or float(score) < threshold:
                continue
            meta = self.metadata[idx]
            results.append(SearchResult(
                file_path=meta["file_path"],
                file_id=meta.get("file_id", Path(meta["file_path"]).stem),
                score=float(score),
            ))

        results.sort(key=lambda r: r.score, reverse=True)
        return results

    def _save_index(self):
        self.index_dir.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self.faiss_index, str(self.index_dir / INDEX_FILENAME))
        with open(self.index_dir / METADATA_FILENAME, "w") as f:
            json.dump(self.metadata, f)

    def _load_index(self):
        self.faiss_index = faiss.read_index(str(self.index_dir / INDEX_FILENAME))
        with open(self.index_dir / METADATA_FILENAME) as f:
            self.metadata = json.load(f)
        logger.info(f"Loaded index with {len(self.metadata)} images")
