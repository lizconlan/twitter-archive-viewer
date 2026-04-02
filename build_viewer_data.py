#!/usr/bin/env python3

import json
import sys
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parent
DOWNLOADS_DIR = ROOT / "downloads"
MANIFEST_PATH = DOWNLOADS_DIR / "index.json"
LIKED_MEDIA_DIR = DOWNLOADS_DIR / "liked_media"
PROFILE_IMAGES_DIR = DOWNLOADS_DIR / "profile_images"
THREAD_OVERRIDES_PATH = ROOT / "thread_overrides.json"

IGNORED_DIRS = {
    ".git",
    ".pytest_cache",
    ".vscode",
    "__pycache__",
    "downloads",
    "node_modules",
    "tests",
    "tmp",
}


def is_hydrated_tweet(payload):
    return (
        isinstance(payload, dict)
        and "id" in payload
        and "text" in payload
        and "timestamp" in payload
        and isinstance(payload.get("author"), dict)
        and "username" in payload["author"]
    )


def tweet_score(tweet, source_path):
    media = tweet.get("media") or []
    author = tweet.get("author") or {}
    return (
        0 if source_path.parent == DOWNLOADS_DIR else 1,
        sum(1 for item in media if item.get("s3_url")),
        1 if author.get("profile_image_s3") else 0,
        len(media),
        len(tweet.get("mentions") or []),
        len(tweet.get("external_links") or []),
    )


def summarize_tweet(tweet, source_path):
    media = tweet.get("media") or []
    author = tweet.get("author") or {}
    text = " ".join(str(tweet.get("text", "")).split())
    return {
        "id": str(tweet["id"]),
        "text": tweet.get("text", ""),
        "text_preview": text[:180] + ("..." if len(text) > 180 else ""),
        "timestamp": tweet.get("timestamp", ""),
        "conversation_id": tweet.get("conversation_id", ""),
        "direct_link": tweet.get("direct_link", ""),
        "in_reply_to_status_id": tweet.get("in_reply_to_status_id", ""),
        "in_reply_to_status_id_str": tweet.get("in_reply_to_status_id_str", ""),
        "in_reply_to_user_id": tweet.get("in_reply_to_user_id", ""),
        "in_reply_to_user_id_str": tweet.get("in_reply_to_user_id_str", ""),
        "in_reply_to_screen_name": tweet.get("in_reply_to_screen_name", ""),
        "author": {
            "id": str(author.get("id", "")),
            "username": author.get("username", ""),
            "display_name": author.get("display_name", author.get("username", "")),
            "description": author.get("description", ""),
            "verified": bool(author.get("verified", False)),
            "profile_image_s3": author.get("profile_image_s3", ""),
            "profile_image_url": author.get("profile_image_url", ""),
        },
        "media": [
            {
                "alt_text": item.get("alt_text"),
                "media_key": item.get("media_key", ""),
                "type": item.get("type", ""),
                "url": item.get("url", ""),
                "s3_url": item.get("s3_url", ""),
            }
            for item in media
        ],
        "media_count": len(media),
        "has_video": any(item.get("type") == "video" for item in media),
        "json_path": f"downloads/{tweet['id']}.json",
    }


def media_filename_from_url(url):
    if not url:
        return ""

    parsed = urlparse(url)
    filename = Path(parsed.path).name
    return filename


def infer_profile_image_s3(author):
    author_id = str(author.get("id", "")).strip()
    if not author_id:
        return ""

    for directory, prefix in (
        (PROFILE_IMAGES_DIR, "profile_images"),
    ):
        existing = sorted(directory.glob(f"{author_id}-*"))
        if existing:
            return f"{prefix}/{existing[0].name}"

    filename = media_filename_from_url(author.get("profile_image_url", ""))
    if not filename:
        return ""

    return f"profile_images/{author_id}-{filename}"


def infer_media_s3_url(tweet_id, media_item):
    url = media_item.get("url", "")
    filename = media_filename_from_url(url)
    media_key = str(media_item.get("media_key", "")).replace("/", "-")

    for directory, prefix in (
        (LIKED_MEDIA_DIR, "liked_media"),
    ):
        if filename:
            exact = directory / f"{tweet_id}-{filename}"
            if exact.exists():
                return f"{prefix}/{exact.name}"

            fallback_match = sorted(directory.glob(f"{tweet_id}-*{Path(filename).suffix}"))
            if fallback_match:
                return f"{prefix}/{fallback_match[0].name}"

        if media_key:
            key_match = sorted(directory.glob(f"*{media_key}*"))
            if key_match:
                return f"{prefix}/{key_match[0].name}"

    if filename:
        return f"liked_media/{tweet_id}-{filename}"

    return ""


def normalize_optional_string(value):
    normalized = str(value or "").strip()
    return normalized if normalized and normalized.lower() not in {"none", "null"} else ""


def load_thread_overrides():
    if not THREAD_OVERRIDES_PATH.exists():
        return {}

    try:
        payload = json.loads(THREAD_OVERRIDES_PATH.read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}

    raw_overrides = payload.get("overrides")
    if not isinstance(raw_overrides, dict):
        return {}

    normalized = {}
    for tweet_id, data in raw_overrides.items():
        if not isinstance(data, dict):
            continue

        normalized_tweet_id = normalize_optional_string(tweet_id)
        if not normalized_tweet_id:
            continue

        parent_id = normalize_optional_string(
            data.get("in_reply_to_status_id") or data.get("parent_tweet_id")
        )
        user_id = normalize_optional_string(data.get("in_reply_to_user_id"))
        screen_name = normalize_optional_string(data.get("in_reply_to_screen_name")).lstrip("@")
        conversation_id = normalize_optional_string(data.get("conversation_id"))

        if not parent_id and not user_id and not screen_name and not conversation_id:
            continue

        normalized[normalized_tweet_id] = {
            "conversation_id": conversation_id,
            "in_reply_to_status_id": parent_id,
            "in_reply_to_status_id_str": parent_id,
            "in_reply_to_user_id": user_id,
            "in_reply_to_user_id_str": user_id,
            "in_reply_to_screen_name": screen_name,
        }

    return normalized


def apply_thread_override(tweet, overrides):
    tweet_id = normalize_optional_string(tweet.get("id"))
    if not tweet_id:
        return tweet

    override = overrides.get(tweet_id)
    if not override:
        return tweet

    for key, value in override.items():
        if value:
            tweet[key] = value

    return tweet


def normalize_tweet(tweet, thread_overrides=None):
    normalized = json.loads(json.dumps(tweet))
    tweet_id = str(normalized.get("id", ""))
    author = normalized.get("author") or {}
    media = normalized.get("media") or []

    if author and not author.get("profile_image_s3"):
        inferred_profile = infer_profile_image_s3(author)
        if inferred_profile:
            author["profile_image_s3"] = inferred_profile

    for item in media:
        if item.get("s3_url"):
            if "/" not in str(item["s3_url"]):
                item["s3_url"] = f"liked_media/{item['s3_url']}"
            continue

        inferred_media = infer_media_s3_url(tweet_id, item)
        if inferred_media:
            item["s3_url"] = inferred_media

    normalized = apply_thread_override(normalized, thread_overrides or {})
    normalized["author"] = author
    normalized["media"] = media
    return normalized


def normalize_source_roots(source_roots=None):
    normalized = []
    seen = set()

    for raw_root in source_roots or []:
        candidate = Path(raw_root).expanduser().resolve()
        if not candidate.exists():
            continue

        tweet_root = candidate / "raw_data" if (candidate / "raw_data").is_dir() else candidate
        if not tweet_root.exists() or not tweet_root.is_dir():
            continue

        if tweet_root in seen:
            continue

        seen.add(tweet_root)
        normalized.append(tweet_root)

    return normalized


def iter_tweet_json_paths(source_roots):
    for root in source_roots:
        for path in root.rglob("*.json"):
            if any(part in IGNORED_DIRS for part in path.parts):
                continue

            yield path


def discover_hydrated_tweets(source_roots=None):
    chosen = {}

    for path in iter_tweet_json_paths(normalize_source_roots(source_roots)):
        try:
            payload = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue

        if not is_hydrated_tweet(payload):
            continue

        tweet_id = str(payload["id"])
        candidate = {"path": path, "tweet": payload}

        current = chosen.get(tweet_id)
        if current is None or tweet_score(payload, path) > tweet_score(current["tweet"], current["path"]):
            chosen[tweet_id] = candidate

    return chosen


def write_viewer_output(tweets):
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    thread_overrides = load_thread_overrides()
    manifest = []

    for tweet_id, item in tweets.items():
        destination = DOWNLOADS_DIR / f"{tweet_id}.json"
        normalized_tweet = normalize_tweet(item["tweet"], thread_overrides)
        destination.write_text(json.dumps(normalized_tweet, indent=2))
        manifest.append(summarize_tweet(normalized_tweet, item["path"]))

    manifest.sort(key=lambda tweet: (tweet["timestamp"], tweet["id"]), reverse=True)
    MANIFEST_PATH.write_text(json.dumps({"tweets": manifest}, indent=2))
    return manifest


def build_manifest(source_roots=None):
    tweets = discover_hydrated_tweets(source_roots)
    manifest = write_viewer_output(tweets)
    print(f"Prepared {len(manifest)} tweets for the viewer")


if __name__ == "__main__":
    build_manifest(sys.argv[1:])
