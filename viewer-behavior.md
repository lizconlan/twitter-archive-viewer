# Viewer Behavior Contract

This is the current behavior we want to preserve while the local archive viewer keeps evolving. It is intentionally practical rather than aspirational.

## Product shape

- The viewer stays local-first and file-backed. It reads browser-ready JSON from `downloads/`.
- Both direct source builds and managed/imported tweets are first-class in the UI.

## Data contract

- The manifest lives at `downloads/index.json` under a top-level `tweets` key.
- Each manifest entry represents one tweet and links to `downloads/<tweet_id>.json`.
- Individual tweet payloads are normalized copies of hydrated tweet JSON.
- `source_kind` is user-visible and must continue to distinguish:
  - `cache` for tweets built from supplied archive sources
  - `managed` for imported tweets under `downloads/managed/`
- The builder should prefer the richest copy of a tweet when duplicates exist.
- Local asset hints should be inferred when possible:
  - profile images from `downloads/profile_images/` or `downloads/managed/profile_images/`
  - media from `downloads/liked_media/` or `downloads/managed/liked_media/`
- Optional thread overrides from `thread_overrides.json` should merge into normalized tweet output during rebuilds.

## Archive page behavior

- Query parameter flows matter and should remain stable where practical:
  - `account` filters the archive to a specific account
  - `tweet_id` selects a specific tweet in the archive UI
  - `page` keeps pagination stable and deep-linkable
- Filtering should stay fast and should not break pagination or direct linking.
- Managed/imported tweets should remain visibly labeled as `Imported`.

## Import behavior

- `make import-viewer-subset SOURCE=/path/to/archive-or-raw_data` imports a curated subset into `downloads/managed/`.
- `make refresh-viewer-data SOURCE=/path/to/archive-or-raw_data` rebuilds the viewer cache from an explicit archive source.
- Rebuilding without `SOURCE` should still work when managed imported data already exists locally.
- Import selection can be constrained by limit, ordering strategy, media presence, and local media presence.
- Replacing the managed subset is the default behavior unless append mode is explicitly used.

## Safety-first changes

- Prefer characterization tests before refactors that touch manifest shape, import heuristics, or query-param behavior.
- If a change intentionally alters one of the behaviors above, update this file in the same change so the new contract is explicit.
