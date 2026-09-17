#!/usr/bin/env python3
"""Generate data/<database>/database.json from each manifest's per-song files.

The PWA uses database.json only as a one-request bootstrap snapshot. The
manifest + individual song files remain the authoritative/latest runtime layer,
so this generator does not need to run after every small song correction. Run
it whenever you intentionally want to refresh the bootstrap snapshot.
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
