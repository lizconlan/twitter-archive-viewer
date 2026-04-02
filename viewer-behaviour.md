# Viewer Behaviour Contract

This is the current behaviour we want to preserve while the local archive viewer keeps evolving. It is intentionally practical rather than aspirational.

## Product shape

- The viewer stays local-first and file-backed. It reads browser-ready JSON from `downloads/`.
- Both full-archive builds and curated subset imports should produce the same viewer-facing data shape.

## Data contract

- The manifest lives at `downloads/index.json` under a top-level `tweets` key.
- Each manifest entry represents one tweet and links to `downloads/<tweet_id>.json`.
- Individual tweet payloads are normalized copies of hydrated tweet JSON.
- The builder should prefer the richest copy of a tweet when duplicates exist.
- Local asset hints should be inferred when possible:
  - profile images from `downloads/profile_images/`
  - media from `downloads/liked_media/`
- Optional thread overrides from `thread_overrides.json` should merge into normalized tweet output during rebuilds.

## Archive page behaviour

- Query parameter flows matter and should remain stable where practical:
  - `account` filters the archive to a specific account
  - `tweet_id` selects a specific tweet in the archive UI
  - `page` keeps pagination stable and deep-linkable
- Filtering should stay fast and should not break pagination or direct linking.

## Import behaviour

- `make import-viewer-subset SOURCE=/path/to/archive-or-raw_data` rebuilds `downloads/` from a curated subset of the source archive.
- `make refresh-viewer-data SOURCE=/path/to/archive-or-raw_data` rebuilds the viewer cache from an explicit archive source.
- Import selection can be constrained by limit, ordering strategy, media presence, and local media presence.
- Replacing the current viewer output is the default behaviour unless append mode is explicitly used.

## Safety-first changes

- Prefer characterization tests before refactors that touch manifest shape, import heuristics, or query-param behaviour.
- If a change intentionally alters one of the behaviours above, update this file in the same change so the new contract is explicit.
- Do not allow tweet data to be checked in, unless it was explicitly added for demonstration purposes.
