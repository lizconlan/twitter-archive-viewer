import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import import_archive_subset


def hydrated_tweet(tweet_id, *, timestamp="2024-01-01T10:00:00.000Z", with_media=True):
    payload = {
        "id": str(tweet_id),
        "text": f"Tweet {tweet_id}",
        "timestamp": timestamp,
        "author": {
            "id": "42",
            "username": "liz",
            "profile_image_url": "https://example.com/avatar.jpg",
        },
        "media": [],
    }
    if with_media:
        payload["media"] = [
            {
                "media_key": f"3_{tweet_id}",
                "type": "photo",
                "url": f"https://example.com/{tweet_id}.jpg",
            }
        ]
    return payload


class ImportArchiveSubsetTests(unittest.TestCase):
    def test_load_candidate_requires_local_media_when_requested(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            raw_data = root / "raw_data"
            liked_media = root / "liked_media"
            profile_images = root / "profile_images"
            raw_data.mkdir()
            liked_media.mkdir()
            profile_images.mkdir()

            tweet_path = raw_data / "123.json"
            tweet_path.write_text(json.dumps(hydrated_tweet("123")))

            candidate = import_archive_subset.load_candidate(
                tweet_path,
                liked_media,
                profile_images,
                require_media=True,
                require_local_media=True,
            )
            self.assertIsNone(candidate)

            (liked_media / "123-123.jpg").write_text("media")
            (profile_images / "42-avatar.jpg").write_text("avatar")

            candidate = import_archive_subset.load_candidate(
                tweet_path,
                liked_media,
                profile_images,
                require_media=True,
                require_local_media=True,
            )
            self.assertIsNotNone(candidate)
            self.assertEqual(candidate["profile_image"].name, "42-avatar.jpg")
            self.assertEqual(len(candidate["media_files"]), 1)

    def test_choose_subset_obeys_latest_oldest_and_seeded_random(self):
        tweets = [
            {"tweet": {"id": "1"}, "timestamp": "2024-01-01T00:00:00.000Z"},
            {"tweet": {"id": "2"}, "timestamp": "2024-01-03T00:00:00.000Z"},
            {"tweet": {"id": "3"}, "timestamp": "2024-01-02T00:00:00.000Z"},
        ]

        latest = import_archive_subset.choose_subset(tweets, "latest", 3, seed=7)
        oldest = import_archive_subset.choose_subset(tweets, "oldest", 3, seed=7)
        random_one = import_archive_subset.choose_subset(tweets, "random", 3, seed=7)
        random_two = import_archive_subset.choose_subset(tweets, "random", 3, seed=7)

        self.assertEqual([item["tweet"]["id"] for item in latest], ["2", "3", "1"])
        self.assertEqual([item["tweet"]["id"] for item in oldest], ["1", "3", "2"])
        self.assertEqual([item["tweet"]["id"] for item in random_one], [item["tweet"]["id"] for item in random_two])

    def test_copy_subset_copies_raw_media_and_profile_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "source"
            managed = root / "managed"
            source.mkdir()
            managed.mkdir()

            raw_data_dir = managed / "raw_data"
            liked_media_dir = managed / "liked_media"
            profile_images_dir = managed / "profile_images"

            tweet_path = source / "123.json"
            media_path = source / "123-photo.jpg"
            profile_path = source / "42-avatar.jpg"
            tweet_path.write_text(json.dumps(hydrated_tweet("123")))
            media_path.write_text("media")
            profile_path.write_text("avatar")

            selection = [
                {
                    "path": tweet_path,
                    "tweet": hydrated_tweet("123"),
                    "timestamp": "2024-01-01T10:00:00.000Z",
                    "media_files": {"3_123": media_path},
                    "profile_image": profile_path,
                }
            ]

            with (
                mock.patch.object(import_archive_subset, "MANAGED_RAW_DATA_DIR", raw_data_dir),
                mock.patch.object(import_archive_subset, "MANAGED_LIKED_MEDIA_DIR", liked_media_dir),
                mock.patch.object(import_archive_subset, "MANAGED_PROFILE_IMAGES_DIR", profile_images_dir),
            ):
                copied_media, copied_profiles = import_archive_subset.copy_subset(selection)

            self.assertEqual(copied_media, 1)
            self.assertEqual(copied_profiles, 1)
            self.assertTrue((raw_data_dir / "123.json").exists())
            self.assertTrue((liked_media_dir / "123-photo.jpg").exists())
            self.assertTrue((profile_images_dir / "42-avatar.jpg").exists())


if __name__ == "__main__":
    unittest.main()
