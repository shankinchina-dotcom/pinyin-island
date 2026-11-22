"""Prepare Day 1 recordings from audio-cmn (Chen Wang, CC BY-SA).

The 64k version is preferred. Two recordings unavailable in that directory use
the same speaker's 18k-abr version. Existing prototype downloads are migrated.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import hashlib
import json
import requests

ROOT = Path(__file__).resolve().parents[1]
LEGACY = ROOT / "public" / "audio"
OUT = LEGACY / "v1" / "syllable"
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = "https://cdn.jsdelivr.net/gh/hugolpz/audio-cmn@master"
SOURCE_NAMES = {"a": "a", "o": "o", "e": "e", "i": "yi", "u": "wu", "ü": "yu"}
FILE_KEYS = {"ü": "v"}


def prepare(item: tuple[str, int]) -> dict[str, object]:
    vowel, tone = item
    key = FILE_KEYS.get(vowel, vowel)
    source_name = f"cmn-{SOURCE_NAMES[vowel]}{tone}.mp3"
    target = OUT / f"d01_{key}_{tone}.mp3"
    quality = "64k"
    legacy = LEGACY / f"{vowel}{tone}.mp3"
    if target.exists():
        payload = target.read_bytes()
        quality = "18k-abr" if (vowel, tone) in {("o", 2), ("i", 4)} else "64k"
    elif legacy.exists() and legacy.stat().st_size > 1000:
        payload = legacy.read_bytes()
        target.write_bytes(payload)
        legacy.unlink()
        quality = "18k-abr" if (vowel, tone) in {("o", 2), ("i", 4)} else "64k"
    else:
        for quality in ("64k", "18k-abr"):
            response = requests.get(f"{SOURCE}/{quality}/syllabs/{source_name}", timeout=45)
            if response.ok and len(response.content) > 1000:
                payload = response.content
                target.write_bytes(payload)
                break
        else:
            raise ValueError(f"No usable recording for {vowel}{tone}")
    return {
        "key": f"d01_{key}_{tone}",
        "path": f"syllable/d01_{key}_{tone}.mp3",
        "url": f"/audio/v1/syllable/d01_{key}_{tone}.mp3",
        "vowel": vowel,
        "tone": tone,
        "sourceFile": source_name,
        "sourceQuality": quality,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "verified": False,
        "reviewStatus": "pending-teacher-review",
    }


items = [(vowel, tone) for vowel in SOURCE_NAMES for tone in range(1, 5)]
records: list[dict[str, object]] = []
with ThreadPoolExecutor(max_workers=6) as pool:
    futures = {pool.submit(prepare, item): item for item in items}
    for future in as_completed(futures):
        record = future.result()
        records.append(record)
        print(f"OK {record['key']} {record['bytes']} bytes {record['sourceQuality']}")

records.sort(key=lambda row: (list(SOURCE_NAMES).index(str(row["vowel"])), int(row["tone"])))
manifest = {
    "version": "v1",
    "voice": "Chen Wang",
    "kind": "human-recording",
    "license": "CC BY-SA (upstream declaration)",
    "project": "https://github.com/hugolpz/audio-cmn",
    "notes": "i/u/ü use the zero-initial syllables yi/wu/yu. Formal use requires teacher review. The two 18k-abr files are o2 and yi4; all other files are 64k.",
    "files": records,
}
(LEGACY / "v1" / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(f"Prepared {len(records)} recordings in {OUT}")
