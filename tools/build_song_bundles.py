#!/usr/bin/env python3
"""Generate data/<database>/database.json from each manifest's per-song files.

For sources marked bundlePrimary in js/song-sources.js, database.json is
authoritative at runtime. Regenerate it after any song change. For other
sources it is a startup snapshot and the app refreshes from individual files.
"""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def build_database(folder: Path) -> tuple[str, int, int]:
    manifest_path = folder / "manifest.json"
    files = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(files, list):
        raise ValueError(f"{manifest_path} must contain a JSON array")

    songs = []
    for name in files:
        song_path = folder / name
        songs.append(json.loads(song_path.read_text(encoding="utf-8")))

    payload = {"format": 1, "count": len(songs), "songs": songs}
    out = folder / "database.json"
    out.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return folder.name, len(songs), out.stat().st_size


def main() -> None:
    total = 0
    for manifest in sorted(DATA.glob("*/manifest.json")):
        name, count, size = build_database(manifest.parent)
        total += count
        print(f"{name}: {count} songs -> database.json ({size:,} bytes)")
    print(f"Total: {total} songs")


if __name__ == "__main__":
    main()
