import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import build_viewer_data


def hydrated_tweet(tweet_id, *, text="Hello world", timestamp="2024-01-01T10:00:00.000Z"):
    return {
        "id": str(tweet_id),
        "text": text,
        "timestamp": timestamp,
        "author": {
            "id": "42",
            "username": "liz",
            "display_name": "Liz",
            "profile_image_url": "https://example.com/profile.jpg",
        },
        "media": [
            {
                "media_key": "3_1",
                "type": "photo",
                "url": "https://example.com/media/photo.jpg",
            }
        ],
        "mentions": [],
        "external_links": [],
    }


class BuildViewerDataTests(unittest.TestCase):
    def test_normalize_tweet_infers_local_assets_and_applies_thread_overrides(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            downloads = root / "downloads"
            liked_media = downloads / "liked_media"
            profile_images = downloads / "profile_images"
            liked_media.mkdir(parents=True)
            profile_images.mkdir(parents=True)

            (liked_media / "123-photo.jpg").write_text("media")
            (profile_images / "42-profile.jpg").write_text("avatar")

            tweet = hydrated_tweet("123")
            overrides = {
                "123": {
                    "conversation_id": "999",
                    "in_reply_to_status_id": "555",
                    "in_reply_to_status_id_str": "555",
                    "in_reply_to_user_id": "77",
                    "in_reply_to_user_id_str": "77",
                    "in_reply_to_screen_name": "friend",
                }
            }

            with (
                mock.patch.object(build_viewer_data, "LIKED_MEDIA_DIR", liked_media),
                mock.patch.object(build_viewer_data, "PROFILE_IMAGES_DIR", profile_images),
            ):
                normalized = build_viewer_data.normalize_tweet(tweet, overrides)

            self.assertEqual(normalized["media"][0]["s3_url"], "liked_media/123-photo.jpg")
            self.assertEqual(normalized["author"]["profile_image_s3"], "profile_images/42-profile.jpg")
            self.assertEqual(normalized["conversation_id"], "999")
            self.assertEqual(normalized["in_reply_to_status_id"], "555")
            self.assertEqual(normalized["in_reply_to_screen_name"], "friend")

    def test_build_manifest_writes_normalized_tweets(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source_dir = root / "archive" / "raw_data"
            downloads = root / "downloads"
            liked_media = downloads / "liked_media"
            profile_images = downloads / "profile_images"

            source_dir.mkdir(parents=True)
            downloads.mkdir(parents=True)
            liked_media.mkdir(parents=True)
            profile_images.mkdir(parents=True)

            first = hydrated_tweet("100", timestamp="2024-01-01T08:00:00.000Z")
            second = hydrated_tweet("200", text="Second tweet", timestamp="2024-01-02T09:00:00.000Z")

            (source_dir / "100.json").write_text(json.dumps(first))
            (source_dir / "200.json").write_text(json.dumps(second))
            (root / "thread_overrides.json").write_text(
                json.dumps(
                    {
                        "overrides": {
                            "200": {
                                "in_reply_to_status_id": "150",
                                "in_reply_to_screen_name": "origin",
                            }
                        }
                    }
                )
            )

            with (
                mock.patch.object(build_viewer_data, "ROOT", root),
                mock.patch.object(build_viewer_data, "DOWNLOADS_DIR", downloads),
                mock.patch.object(build_viewer_data, "MANIFEST_PATH", downloads / "index.json"),
                mock.patch.object(build_viewer_data, "LIKED_MEDIA_DIR", liked_media),
                mock.patch.object(build_viewer_data, "PROFILE_IMAGES_DIR", profile_images),
                mock.patch.object(build_viewer_data, "THREAD_OVERRIDES_PATH", root / "thread_overrides.json"),
            ):
                build_viewer_data.build_manifest([source_dir])

            manifest = json.loads((downloads / "index.json").read_text())
            self.assertEqual([tweet["id"] for tweet in manifest["tweets"]], ["200", "100"])

            second_output = json.loads((downloads / "200.json").read_text())
            self.assertEqual(second_output["in_reply_to_status_id"], "150")
            self.assertEqual(second_output["in_reply_to_screen_name"], "origin")


if __name__ == "__main__":
    unittest.main()
