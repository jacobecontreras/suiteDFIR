#!/usr/bin/env python3
import argparse
import getpass
import json
import time
from pathlib import Path

from .ios_backup import (
    check_encryption_status,
    get_backup_device_name,
    run_extraction,
)

DEFAULT_OUTPUT = "output_images"


def cmd_extract(args):
    """Extract images from iOS backup."""
    backup_path = Path(args.backup_path)
    base_output = Path(args.output)

    if not (backup_path / "Manifest.plist").exists():
        print(f"Error: No Manifest.plist found at {backup_path}")
        print("Make sure this is a valid iOS backup directory.")
        return

    device_name = get_backup_device_name(backup_path)
    output_path = base_output / device_name
    output_path.mkdir(parents=True, exist_ok=True)

    password = None
    if check_encryption_status(backup_path):
        password = args.password
        if not password:
            password = getpass.getpass("Enter backup password: ")

    def extract_progress(current: int, total: int, filename: str):
        percent = int((current / total) * 100) if total > 0 else 0
        print(f"\r  Extracting: {current}/{total} ({percent}%) - {filename[:50]}", end='', flush=True)

    def index_progress(current: int, total: int):
        percent = int((current / total) * 100) if total > 0 else 0
        print(f"\r  Indexing: {current}/{total} ({percent}%)", end='', flush=True)

    def status_update(msg: str):
        print(f"\n{msg}")

    try:
        manifest = run_extraction(
            backup_path,
            output_path,
            password=password,
            extract_progress=extract_progress,
            index_progress=index_progress,
            status_update=status_update,
        )
    except ValueError as e:
        print(f"Error: {e}")
        return

    if manifest is None:
        print("No images found in backup.")
        return

    print(f"\nComplete! Output: {output_path}")


def cmd_index(args):
    """Build semantic search index from extracted images."""
    from .semantic import SemanticIndex

    output_path = Path(args.output)
    index_dir = str(output_path / ".search_index")

    if not output_path.exists():
        print(f"No extracted images found at {output_path}. Run 'extract' first.")
        return

    # Load file manifest if available
    manifest_path = output_path / "file_manifest.json"
    file_manifest = None
    if manifest_path.exists():
        with open(manifest_path) as f:
            file_manifest = json.load(f)

    index = SemanticIndex(index_dir)

    start = time.time()

    def progress_callback(current: int, total: int):
        percent = int((current / total) * 100) if total > 0 else 0
        print(f"\r  {current}/{total} ({percent}%)", end='', flush=True)

    index.build_index(
        str(output_path),
        file_manifest=file_manifest,
        progress_callback=progress_callback,
    )

    elapsed = time.time() - start
    print(f"\nIndexing complete in {elapsed:.1f}s")


def cmd_search(args):
    """Search indexed images by text query."""
    from .semantic import SemanticIndex

    output_path = Path(args.output)
    index_dir = output_path / ".search_index"

    if not (index_dir / "image_index.faiss").exists():
        print("No search index found. Run 'index' first.")
        return

    index = SemanticIndex(str(index_dir))
    results = index.search(args.query, threshold=args.threshold)

    if not results:
        print("No results found.")
        return

    print(f"\nResults for: \"{args.query}\"\n")
    print(f"{'Rank':<6}{'Score':<10}{'File'}")
    print("-" * 50)

    for i, r in enumerate(results, 1):
        filename = Path(r.file_path).name
        print(f"{i:<6}{r.score:<10.4f}{filename}")


def cmd_gui(args):
    """Launch the photo gallery UI."""
    from .gui import launch

    launch(args.output)


def main():
    parser = argparse.ArgumentParser(
        description="iOS Backup Image Extractor with Semantic Search"
    )
    subparsers = parser.add_subparsers(dest="command")

    # extract
    extract_parser = subparsers.add_parser("extract", help="Extract images from iOS backup")
    extract_parser.add_argument("--backup-path", required=True, help="Path to iOS backup directory")
    extract_parser.add_argument("--password", default=None, help="Backup password (prompted if encrypted)")
    extract_parser.add_argument("--output", default=DEFAULT_OUTPUT, help=f"Base output directory (default: {DEFAULT_OUTPUT})")

    # index
    index_parser = subparsers.add_parser("index", help="Build semantic search index")
    index_parser.add_argument("--output", required=True, help="Device image directory to index (e.g., output_images/Jacobs_iPhone)")

    # search
    search_parser = subparsers.add_parser("search", help="Search images by text query")
    search_parser.add_argument("query", help="Text query (e.g., 'sunset', 'weapon')")
    search_parser.add_argument("--threshold", type=float, default=0.20, help="Minimum similarity score (default: 0.20)")
    search_parser.add_argument("--output", required=True, help="Device image directory with index")

    # gui
    gui_parser = subparsers.add_parser("gui", help="Launch photo gallery UI")
    gui_parser.add_argument("--output", default=DEFAULT_OUTPUT, help=f"Base output directory (default: {DEFAULT_OUTPUT})")

    args = parser.parse_args()

    if args.command == "extract":
        cmd_extract(args)
    elif args.command == "index":
        cmd_index(args)
    elif args.command == "search":
        cmd_search(args)
    elif args.command == "gui":
        cmd_gui(args)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
