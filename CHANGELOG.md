# Changelog

All notable changes to Tessera are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
