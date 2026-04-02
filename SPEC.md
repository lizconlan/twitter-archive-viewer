# Twitter Archive Viewer Spec

This document defines the intended shape of the rebuilt viewer. It treats the old viewer implementation in `rehydrate-tweets` as a reference implementation and behavior oracle, not as the architecture to preserve wholesale.

## Purpose

Build a local-first archive browser for hydrated tweet JSON that makes a personal archive feel easy to search, browse, filter, and revisit.

The viewer should feel fast, dependable, and linkable. It is not trying to be a generic social client, a hosted product, or a full Twitter clone.

## Product goals

- Browse a local archive of hydrated tweets without needing a backend service.
- Make it easy to move between scanning many tweets and opening one tweet in detail.
- Preserve important archive context such as account, date, media presence, and reply relationships.
- Support deliberate curation workflows, not just raw dumping.

## Non-goals

- Recreating the original hydration/download infrastructure.
- Building a multi-user or cloud-hosted application.
- Perfect visual fidelity to Twitter.
- Large framework complexity without a clear payoff.

## Reference behaviour to preserve

These behaviours are considered hard-won and should survive the rebuild unless intentionally changed:

- The archive manifest lives at `downloads/index.json` with a top-level `tweets` array.
- Each tweet has its own normalized JSON payload at `downloads/<tweet_id>.json`.
- Query parameter flows remain stable where practical:
  - `account`
  - `tweet_id`
  - `page`
- The archive supports:
  - text search
  - account filtering
  - date filtering
  - pagination
  - media-oriented filters
- Single-tweet detail views remain possible.
- Local asset fallback behavior remains graceful for media and profile images.
- Known thread/reply overrides can still be applied during data preparation.

## Primary user flows

### Archive browsing

The user opens the archive and quickly scans a paginated timeline/list of tweets.

They can:

- search by text
- filter by account
- narrow by date range
- switch to media/video subsets
- select a tweet and keep their place in the archive

### Deep linking

The user can share or revisit a URL that preserves the current archive context.

At minimum, links should be able to restore:

- selected account
- selected tweet
- current page

### Tweet detail

The user can open a single tweet view that makes the tweet readable in isolation and still exposes useful archive context:

- author
- timestamp
- media
- mentions/links
- reply context where available

### Subset import

The user can import a curated subset from a larger archive and rebuild the viewer around that smaller local selection.

Import selection should support:

- explicit source path
- size limits
- ordering strategy
- media-only selection
- locally-available-media-only selection

## Design principles

- Local-first: file-backed, no required server application.
- Fast to scan: browsing flow matters more than ornamental features.
- Stable and understandable: deep linking and pagination should feel predictable.
- Honest about source quality: the viewer should surface archive limitations rather than hide them.
- Incremental: small components and clear seams over cleverness.

## Data model

### Manifest

- Path: `downloads/index.json`
- Shape: object with a `tweets` array
- Each entry should contain enough metadata for archive browsing without loading every full tweet upfront

Expected fields include:

- `id`
- `text`
- `text_preview`
- `timestamp`
- `author`
- `media`
- `media_count`
- `has_video`
- `json_path`
- reply/conversation metadata where available

### Tweet payload

- Path: `downloads/<tweet_id>.json`
- Shape: normalized hydrated tweet JSON prepared for the viewer

Normalization responsibilities include:

- stable author fields
- stable media fields
- inferred local asset paths where possible
- merged thread override metadata where supplied

## Build and import responsibilities

The rebuild should keep the data preparation layer separate from the UI layer.

### Build step responsibilities

- Accept explicit source directories
- Discover hydrated tweet JSON
- Prefer the richest duplicate when multiple copies of a tweet exist
- Normalize output for the viewer
- Write the manifest and per-tweet files into `downloads/`

### Import step responsibilities

- Select a curated subset from an archive source
- Copy relevant local media/profile assets when available
- Write the rebuilt viewer output directly into `downloads/`

## Testing strategy

The new repo should start with tests as part of the design, not as an afterthought.

### Data pipeline tests

Keep coverage around:

- manifest generation
- duplicate selection
- asset inference
- thread override merging
- import selection/copying

### UI tests

Add JavaScript-native tests for the actual viewer behavior:

- search/filter logic
- pagination behavior
- query-param restoration
- selection state
- key rendering contracts

### Smoke tests

Maintain a lightweight manual check for:

- archive loading
- single-tweet loading
- subset import flow

## Technical direction

This rebuild does not need to preserve the previous implementation structure.

Open questions to answer intentionally during implementation:

- Keep vanilla JavaScript, or introduce a small modern frontend stack?
- Keep the current data file layout exactly, or evolve it with a migration path?
- Keep Python for data preparation, or change languages only if there is a strong reason?

Default bias:

- preserve the file-based workflow
- preserve the user-visible data contract
- choose the simplest architecture that makes testing and iteration cleaner

## Rebuild plan

### Phase 1

- Lock the spec
- Decide implementation approach
- Set up tests first
- Recreate the data preparation layer with explicit source handling

### Phase 2

- Rebuild the archive page
- Rebuild selection/detail flows
- Restore deep linking and filtering
- Hide protected tweets by default, with an explicit local override

### Phase 3

- Rebuild subset import support
- Polish visual design and responsiveness
- Compare behaviour against the reference implementation

## Source of truth

For now:

- this spec is the source of truth for the new repo
- the old viewer branch in `rehydrate-tweets` is the reference implementation

If the implementation and this spec diverge intentionally, update this file in the same change.
