# Tessera

OpenSeadragon-backed deep zoom for Phoenix apps. Generate DZI (Deep Zoom Image) tile pyramids from images via ImageMagick, render them with a Phoenix LiveView component.

A *tessera* is a single tile in a mosaic — and that's literally what this package produces and consumes: small image tiles arranged into a pyramid so [OpenSeadragon](https://openseadragon.github.io/) can fetch only the detail visible at the current zoom level.

## Install

```elixir
def deps do
  [
    {:tessera, "~> 0.1.0"}
  ]
end
```

System requirement: **ImageMagick** (`magick` binary) on the host `PATH` for tile generation.

Then in `assets/js/app.js`, import the JS hook and spread it into your LiveSocket hooks:

```js
import "../../deps/tessera/priv/static/tessera.js"

let liveSocket = new LiveSocket("/live", Socket, {
  hooks: { ...window.TesseraHooks, ...colocatedHooks }
})
```

## Generate tiles

```elixir
{:ok, %{manifest: manifest, tiles_dir: tiles_dir}} =
  Tessera.generate("/uploads/photo.jpg", "/var/www/dzi")
```

Output:

```
/var/www/dzi/photo.dzi              # XML manifest (width, height, tilesize)
/var/www/dzi/photo_files/0/0_0.jpg  # zoom level 0 (smallest)
/var/www/dzi/photo_files/1/0_0.jpg
...
/var/www/dzi/photo_files/N/c_r.jpg  # zoom level N (full res), col c, row r
```

Tessera doesn't pick a default `output_dir` — you decide where tiles live and how they're served. For a Phoenix app the simplest setup is dropping them into `priv/static/dzi/` so the existing `Plug.Static` serves them.

### Options

```elixir
Tessera.generate(input, output_dir,
  tile_size: 256,    # pixels per tile edge
  overlap: 1,        # pixel overlap between adjacent tiles
  format: :jpg,      # :jpg | :png
  base_name: "img"   # manifest filename prefix; defaults to input basename
)
```

## Render the viewer

**Deep zoom** (DZI pyramid generated server-side):

```heex
<Tessera.viewer
  id="photo"
  src={~p"/dzi/photo.dzi"}
  class="w-full h-[80vh] rounded"
/>
```

**Basic pan + zoom on a plain image** (no preprocessing required):

```heex
<Tessera.viewer
  id="thumb"
  src={~p"/uploads/photo.jpg"}
  class="w-full h-96"
/>
```

The viewer detects the source type from the URL: paths ending in `.dzi` get the DZI tile source (deep zoom with progressive higher-res tile loading); everything else (`.jpg`, `.png`, `.webp`, ...) uses OSD's "simple image" tile source — pan and zoom work, but there's no progressive higher-res loading because there are no tiles.

Interactions in both modes: scroll-wheel / pinch zoom, click-drag pan, double-click zoom.

The component renders a `<div>` with `phx-hook="TesseraViewer"`. The hook lazy-loads OpenSeadragon from jsDelivr on first mount and initializes it.

## How it fits with PhoenixKit

Tessera is fully standalone — it has no PhoenixKit dependency. But its API is shaped to plug into [PhoenixKit](https://github.com/BeamLabEU/phoenix_kit)'s media pipeline directly: `generate/3` accepts any input path / output dir, so PhoenixKit's `ProcessFileJob` can call it inline, and `<Tessera.viewer>` accepts any `dzi_url`, so the MediaBrowser modal can swap its `<img>` for the viewer once the manifest is available.

## License

MIT
