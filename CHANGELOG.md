# Changelog

All notable changes to Tessera are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.3.4 — 2026-07-19

Patch — allow fresco 0.10.x (`~> 0.10.0` added to the version
constraint). Fresco 0.10.0 is backward-compatible with the stage/layer
API Tessera renders into.

## 0.3.3 — 2026-07-16

Patch — allow fresco 0.9.x.

### Changed

- Allow **fresco 0.9.x** (`~> 0.9.0` added to the version constraint). Fresco
  0.9.0 is backward-compatible with the handle API Tessera uses — its changes
  are additive (viewer `persist_rotation` + rotation handle methods, nav icon
  refresh). Verified against it (compile + tests). No code changes — unblocks
  consumers whose other deps (e.g. etcher 0.8.0) already allow fresco 0.9.x.

## 0.3.2 — 2026-07-06

Patch — allow fresco 0.8.x.

### Changed

- Allow **fresco 0.8.x** (`~> 0.8.0` added to the version constraint). Fresco
  0.8.0 is backward-compatible with the handle API Tessera uses — no code
  changes required; this only widens the dependency so consumers can adopt it.

## 0.3.1 — 2026-06-14

Patch — quicker resolution switching on zoom.

### Changed

- Lowered `UPGRADE_HEADROOM` 1.6 → 1.1 and `TILE_ACTIVATE_HEADROOM`
  1.25 → 1.1, so Tessera swaps to the sharper raster (and activates tiles)
  as soon as the current source would be upscaled ~10%, instead of tolerating
  up to 60% upscaling first. The image now sharpens promptly on zoom-in
  rather than lingering soft. Downgrade hysteresis (0.85) is unchanged.

## 0.3.0 — 2026-06-14

**Breaking change**: rewritten for Fresco's own viewer engine. Fresco 0.5
dropped OpenSeadragon for a CSS-transform engine, so Tessera 0.2's
integration (a DZI source provider + OSD `viewport.getZoom()` /
`swapSourcePreservingBounds` against the OSD instance) no longer worked.
Tessera 0.3 is a Fresco **peer layer**, the same model as Etcher: it gets
the Fresco handle via `window.Fresco.onReady/2` and reads the live
transform.

### Changed

- **Fresco constraint** widened to `~> 0.5.9 or ~> 0.6.0 or ~> 0.7.0`
  (was `~> 0.1`).
- **`<Tessera.layer>`** gains an optional `dzi_url` attribute. `sources`
  is unchanged (ordered low → high `%{url, width}` raster ladder); the
  hidden hook host now also carries `data-dzi-url`.
- **Progressive resolution swap** now reads zoom from the Fresco handle
  (`getTransform().s × getCanvasSize().width`) instead of OSD's
  `viewport.getZoom()/getHomeZoom()`, and swaps via the handle's
  `swapSourcePreservingBounds` (falling back to `setImageSrc`).

### Added

- **Debug HUD.** A `debug` attr on `<Tessera.layer>` (or
  `localStorage.tesseraDebug = "1"` at runtime) overlays a small panel
  reporting the active raster source, displayed width / zoom, DZI manifest
  info, current pyramid level, and live tile counts (loaded / shown /
  loading) — so you can confirm resolution swaps and tile streaming are
  actually happening.
- **DZI tile streaming.** When `dzi_url` is set and the user zooms past the
  sharpest raster source, Tessera lazily fetches the `.dzi` manifest and
  streams the visible tiles at the matching pyramid level. The tile overlay
  is parented **inside Fresco's stage** and positioned in stage coordinates,
  so the tiles ride the same GPU transform as the base image and stay glued
  to it during pan/zoom (no focal-point drift). Tiles only activate when the
  DZI is genuinely higher-resolution than the top raster — otherwise they'd
  add no detail. Off-screen tiles and the manifest are fetched lazily; the
  overlay clears when the user zooms back below the threshold.

### Fixed

- **Tile generation now respects EXIF orientation** (`-auto-orient` before
  cropping), so tiles from a rotated source line up with the displayed image
  instead of being cut from the raw, mis-oriented pixels.

### Unchanged

- Server-side DZI generation API (`generate/3`, `generate_manifest/3`,
  `generate_tile/4`) and the `Tessera.Storage` behaviour.

## 0.2.1 — 2026-05-12

Patch release — package metadata polish only, no code or behavior
changes.

### Changed

- `mix docs` extras now include `LICENSE` and `CHANGELOG.md`, so the
  README's `[LICENSE](LICENSE)` reference resolves on HexDocs and the
  CHANGELOG gets a proper standalone page in the published docs.

## 0.2.0 — 2026-05-12

**Breaking change**: Tessera no longer hosts its own image viewer. It's
now a layer that composes onto [Fresco](https://hex.pm/packages/fresco).
The Fresco viewer owns the OpenSeadragon instance, the Heroicons nav
overlay, animations, and viewport clamping. Tessera focuses on what
makes Tessera distinctive: the DZI source provider and the multi-layer
progressive-zoom logic.

### What changed

- **Removed**: `<Tessera.viewer src=...>` LiveView component.
- **Added**: `<Tessera.layer fresco_id sources>` — attaches Tessera's
  behavior to a named Fresco viewer.
- **Removed (moved to Fresco)**: the OSD lazy-loader, the Heroicons nav
  overlay (`fresco-nav` now), the animation tuning constants
  (`animationTime: 0.3` / `springStiffness: 10` defaults), the viewport
  clamp (`visibilityRatio: 1.0` / `constrainDuringPan: true`), the
  `swapSourcePreservingBounds` helper. All available via Fresco's
  default viewer settings + viewer-handle API.
- **Added (client side)**: Tessera now registers a DZI source provider
  with Fresco at load time, so any URL ending in `.dzi` is automatically
  treated as a tile pyramid.
- **Unchanged**: `Tessera.generate/3`, `Tessera.generate_manifest/3`,
  `Tessera.generate_tile/4`, the `Tessera.Storage` behaviour + the
  default `Tessera.Storage.Local` adapter — the server-side generator
  API is identical to 0.1. Migration from 0.1 only affects the template.

### Required dependency change

- Add `{:fresco, "~> 0.1"}` alongside `{:tessera, "~> 0.2"}` in your
  `mix.exs`.
- In `app.js`, import `fresco.js` **before** `tessera.js`. Spread both
  hook namespaces into your LiveSocket hooks:
  `{ ...window.FrescoHooks, ...window.TesseraHooks, ...colocatedHooks }`.

### Migration from 0.1

```diff
- <Tessera.viewer
-   id="photo"
-   src={~p"/uploads/photo-medium.jpg"}
-   class="w-full h-[80vh] rounded"
- />
+ <Fresco.viewer
+   id="photo"
+   src={~p"/uploads/photo-medium.jpg"}
+   class="w-full h-[80vh] rounded"
+ />
+
+ <Tessera.layer
+   fresco_id="photo"
+   sources={[
+     %{url: ~p"/uploads/photo-medium.jpg", width: 1024},
+     %{url: ~p"/dzi/photo.dzi"}
+   ]}
+ />
```

The `sources` list shape is unchanged from 0.1; it moves from a
`<Tessera.viewer sources=...>` attr to a `<Tessera.layer sources=...>` attr.

## 0.1.0 — 2026-05-11

Initial release. OpenSeadragon-backed deep zoom for Phoenix apps —
generate DZI tile pyramids from images and render them with a LiveView
component.

### Server-side

- `Tessera.generate/3` — eager full-pyramid DZI generator. Shells out
  to ImageMagick (`magick convert -define dzi:tile-size=... input output.dzi`)
  and writes the manifest plus the entire tile tree to a caller-supplied
  output directory.
- `Tessera.generate_manifest/3` + `Tessera.generate_tile/4` — lazy
  on-demand primitives. The manifest is just XML derived from the
  image's intrinsic width/height; individual tiles are cropped + resized
  per-request, so the pyramid grows organically as users zoom into the
  regions that actually matter.
- `Tessera.Storage` behaviour with a default `Tessera.Storage.Local`
  implementation. Consumers can plug in any backend (S3, multi-bucket,
  CDN) by passing `storage: MyAdapter, storage_opts: [...]` through to
  the generators.

### Client-side

- `<Tessera.viewer sources={...}>` — Phoenix LiveView function
  component. Accepts an ordered low → high quality `sources` list. Each
  entry carries an intrinsic pixel `width` (omit for `.dzi` sources);
  the JS hook computes thresholds dynamically and swaps between layers
  as the user zooms in or out. Downgrade has 15% hysteresis so the
  source can't flicker around a boundary.
- `priv/static/tessera.js` — companion JS hook (`TesseraViewer`) that
  lazy-loads OpenSeadragon from jsDelivr on first mount.
- Self-injected Heroicons navigation overlay (zoom-in / zoom-out / reset
  / fullscreen) — replaces OSD's default PNG-sprite controls so the
  viewer doesn't need a CDN `prefixUrl`.
- Snappy animation tuning (`animationTime: 0.3`, `springStiffness: 10`)
  so pan/zoom track input directly instead of drifting into place.
- `visibilityRatio: 1.0` + `constrainDuringPan: true` so the image
  stays clamped to the viewer rectangle — no off-screen drift.
- Source swaps preserve the user's viewport rectangle (`fitBounds(_, true)`
  after the new source's `open` event) — the image just gets sharper or
  softer; no jump back to home.

### Requirements

- ImageMagick (`magick` binary) on the host `PATH` (used by `generate*`).
- `phoenix_live_view ~> 1.1`, `phoenix_html ~> 4.0`, `jason ~> 1.4`.
