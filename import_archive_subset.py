#!/usr/bin/env python3

import argparse
import json
import random
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_viewer_data import (
    MANAGED_LIKED_MEDIA_DIR,
    MANAGED_PROFILE_IMAGES_DIR,
    MANAGED_RAW_DATA_DIR,
    build_manifest,
    is_hydrated_tweet,
    media_filename_from_url,
)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import a curated subset of a larger tweet archive into the viewer cache."
    )
    parser.add_argument("source", help="Path to an archive root or raw_data directory")
    parser.add_argument("--limit", type=int, default=250, help="Maximum tweets to import")
    parser.add_argument(
        "--strategy",
        choices=("latest", "oldest", "random"),
        default="latest",
        help="How to choose tweets from the source archive",
    )
    parser.add_argument(
        "--require-media",
        action="store_true",
        help="Only import tweets that have media entries",
    )
    parser.add_argument(
        "--require-local-media",
        action="store_true",
        help="Only import tweets whose media files exist locally and are non-zero",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Add to the managed subset instead of replacing it",
    )
    parser.add_argument("--seed", type=int, default=7, help="Random seed for --strategy random")
    return parser.parse_args()


def resolve_source_dirs(source_root):
    source_root = source_root.resolve()
    raw_data_dir = source_root / "raw_data" if (source_root / "raw_data").is_dir() else source_root
    liked_media_dir = source_root / "liked_media"
    profile_images_dir = source_root / "profile_images"
    return raw_data_dir, liked_media_dir, profile_images_dir


def local_media_candidates(tweet_id, item, liked_media_dir):
    candidates = []
    filename = media_filename_from_url(item.get("url", ""))
    s3_url = str(item.get("s3_url", ""))

    if s3_url:
        name = Path(s3_url).name
        if name:
            candidates.append(liked_media_dir / name)

    if filename:
        candidates.append(liked_media_dir / f"{tweet_id}-{filename}")

    suffix = Path(filename).suffix if filename else ""
    if suffix:
        candidates.extend(sorted(liked_media_dir.glob(f"{tweet_id}-*{suffix}")))

    media_key = str(item.get("media_key", "")).replace("/", "-")
    if media_key:
        candidates.extend(sorted(liked_media_dir.glob(f"*{media_key}*")))

    deduped = []
    seen = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        deduped.append(path)
    return deduped


def choose_existing_nonzero(paths):
    for path in paths:
        if path.exists() and path.is_file() and path.stat().st_size > 0:
            return path
    return None


def profile_image_candidates(author, profile_images_dir):
    author_id = str(author.get("id", "")).strip()
    candidates = []

    if author_id:
        candidates.extend(sorted(profile_images_dir.glob(f"{author_id}-*")))

    filename = media_filename_from_url(author.get("profile_image_url", ""))
    if author_id and filename:
        candidates.append(profile_images_dir / f"{author_id}-{filename}")

    deduped = []
    seen = set()
    for path in candidates:
        if path in seen:
            continue
        seen.add(path)
        deduped.append(path)
    return deduped


def load_candidates(raw_data_dir, liked_media_dir, profile_images_dir, require_media, require_local_media):
    tweets = []

    for path in raw_data_dir.glob("*.json"):
        try:
            payload = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue

        if not is_hydrated_tweet(payload):
            continue

        media = payload.get("media") or []
        if require_media and not media:
            continue

        media_files = {}
        missing_local_media = False
        for item in media:
            local_path = choose_existing_nonzero(local_media_candidates(str(payload["id"]), item, liked_media_dir))
            if local_path:
                media_files[item.get("media_key") or local_path.name] = local_path
            elif require_local_media:
                missing_local_media = True
                break

        if missing_local_media:
            continue

        author = payload.get("author") or {}
        profile_image = choose_existing_nonzero(profile_image_candidates(author, profile_images_dir))

        tweets.append(
            {
                "path": path,
                "tweet": payload,
                "timestamp": payload.get("timestamp", ""),
                "media_files": media_files,
                "profile_image": profile_image,
            }
        )

    return tweets


def load_candidate(path, liked_media_dir, profile_images_dir, require_media, require_local_media):
    try:
        payload = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None

    if not is_hydrated_tweet(payload):
        return None

    media = payload.get("media") or []
    if require_media and not media:
        return None

    media_files = {}
    missing_local_media = False
    for item in media:
        local_path = choose_existing_nonzero(local_media_candidates(str(payload["id"]), item, liked_media_dir))
        if local_path:
            media_files[item.get("media_key") or local_path.name] = local_path
        elif require_local_media:
            missing_local_media = True
            break

    if missing_local_media:
        return None

    author = payload.get("author") or {}
    profile_image = choose_existing_nonzero(profile_image_candidates(author, profile_images_dir))

    return {
        "path": path,
        "tweet": payload,
        "timestamp": payload.get("timestamp", ""),
        "media_files": media_files,
        "profile_image": profile_image,
    }


def ordered_json_paths(raw_data_dir, strategy):
    paths = sorted(raw_data_dir.glob("*.json"), key=lambda path: path.stem)
    if strategy == "latest":
        paths.reverse()
    return paths


def load_candidates_fast(raw_data_dir, liked_media_dir, profile_images_dir, require_media, require_local_media, limit, strategy):
    tweets = []

    for path in ordered_json_paths(raw_data_dir, strategy):
        candidate = load_candidate(
            path,
            liked_media_dir,
            profile_images_dir,
            require_media,
            require_local_media,
        )
        if candidate is None:
            continue

        tweets.append(candidate)
        if len(tweets) >= limit:
            break

    return tweets


def choose_subset(tweets, strategy, limit, seed):
    if strategy == "latest":
        ordered = sorted(tweets, key=lambda item: (item["timestamp"], str(item["tweet"]["id"])), reverse=True)
    elif strategy == "oldest":
        ordered = sorted(tweets, key=lambda item: (item["timestamp"], str(item["tweet"]["id"])))
    else:
        ordered = list(tweets)
        random.Random(seed).shuffle(ordered)

    return ordered[:limit]


def clear_managed_subset():
    for directory in (MANAGED_RAW_DATA_DIR, MANAGED_LIKED_MEDIA_DIR, MANAGED_PROFILE_IMAGES_DIR):
        if directory.exists():
            shutil.rmtree(directory)


def copy_subset(selection):
    MANAGED_RAW_DATA_DIR.mkdir(parents=True, exist_ok=True)
    MANAGED_LIKED_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    MANAGED_PROFILE_IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    copied_media = 0
    copied_profiles = 0

    for item in selection:
        destination = MANAGED_RAW_DATA_DIR / item["path"].name
        shutil.copyfile(item["path"], destination)

        for media_path in item["media_files"].values():
            target = MANAGED_LIKED_MEDIA_DIR / media_path.name
            if not target.exists():
                shutil.copyfile(media_path, target)
                copied_media += 1

        profile_image = item["profile_image"]
        if profile_image:
            target = MANAGED_PROFILE_IMAGES_DIR / profile_image.name
            if not target.exists():
                shutil.copyfile(profile_image, target)
                copied_profiles += 1

    return copied_media, copied_profiles


def main():
    args = parse_args()
    raw_data_dir, liked_media_dir, profile_images_dir = resolve_source_dirs(Path(args.source))

    if not raw_data_dir.exists():
        raise SystemExit(f"Raw tweet JSON directory not found: {raw_data_dir}")

    if args.strategy in ("latest", "oldest"):
        selection = load_candidates_fast(
            raw_data_dir,
            liked_media_dir,
            profile_images_dir,
            args.require_media,
            args.require_local_media,
            args.limit,
            args.strategy,
        )
    else:
        tweets = load_candidates(
            raw_data_dir,
            liked_media_dir,
            profile_images_dir,
            args.require_media,
            args.require_local_media,
        )
        selection = choose_subset(tweets, args.strategy, args.limit, args.seed)

    if not args.append:
        clear_managed_subset()

    copied_media, copied_profiles = copy_subset(selection)
    build_manifest()

    print(
        f"Imported {len(selection)} tweets into managed viewer data "
        f"({copied_media} media files, {copied_profiles} profile images)."
    )


if __name__ == "__main__":
    main()
