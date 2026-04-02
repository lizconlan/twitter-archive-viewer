# Twitter Archive Viewer

A local-first browser for hydrated tweet JSON and curated imported subsets.

This repo is the active viewer app split out from the older `rehydrate-tweets` workspace so it can have its own docs, tests, and tooling without inheriting the historical AWS/Localstack pipeline.

## Supported commands

- `make refresh-viewer-data SOURCE=/path/to/archive-or-raw_data`
- `make test-viewer`
- `make launch-archive-viewer SOURCE=/path/to/archive-or-raw_data`
- `make import-viewer-subset SOURCE=/path/to/archive-or-raw_data`

If you have already imported a managed subset into `downloads/managed/`, you can run `make refresh-viewer-data` without `SOURCE` to rebuild from that managed data alone.

Optional import controls:

- `LIMIT=<n>` to cap the number of imported tweets
- `MODE=latest`, `MODE=oldest`, or `MODE=random`
- `REQUIRE_MEDIA=1` to keep only tweets with media
- `REQUIRE_LOCAL_MEDIA=1` to keep only tweets whose media already exists locally

## Current behavior

The current viewer contract lives in [viewer-behavior.md](viewer-behavior.md).

Highlights we want to preserve while iterating:

- Browser-ready data is written to `downloads/`
- The manifest lives at `downloads/index.json`
- Imported subset data remains visible in the UI as `Imported`
- Query parameter flows like `account`, `tweet_id`, and `page` stay stable where practical
- Cached and managed/imported tweets are both first-class

## Safety checks

The tests in `tests/` currently focus on the data build/import pipeline:

- manifest generation
- source-kind labeling
- thread override merging
- local asset inference
- subset import selection and copying

Run them with:

`make test-viewer`

## Main files

- `index.html`: archive list UI shell
- `tweet.html`: single-tweet detail entry point
- `app.js`: client-side state, filtering, pagination, routing, and rendering
- `styles.css`: shared viewer styling
- `build_viewer_data.py`: builds browser-ready viewer data from supplied archive sources and managed imports
- `import_archive_subset.py`: imports a curated subset into `downloads/managed/`

## Relationship to rehydrate-tweets

The original hydration/download project still lives in the `rehydrate-tweets` repo. That repo is now the historical source project; this repo is the active viewer. Cross-reference the two repos in their READMEs so the relationship stays clear.
