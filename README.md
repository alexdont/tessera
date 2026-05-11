# Tessera

OpenSeadragon-backed deep zoom for Phoenix apps. Generate DZI (Deep Zoom Image) tile pyramids from images via ImageMagick — eagerly, lazily one tile at a time, or somewhere in between — and render them through a Phoenix LiveView component with progressive multi-layer zoom.

A *tessera* is a single tile in a mosaic, which is literally what this library produces and consumes: small image tiles arranged into a pyramid so [OpenSeadragon](https://openseadragon.github.io/) can fetch only the detail visible at the current zoom level.

---

## Install

```elixir
def deps do
  [
    {:tessera, "~> 0.1"}
  ]
end
```

System requirement: **ImageMagick** (`magick` binary) on the host `PATH` for tile generation.

Then in your `assets/js/app.js`, import the JS hook and spread it into your LiveSocket hooks:

```js
import "../../deps/tessera/priv/static/tessera.js"

let liveSocket = new LiveSocket("/live", Socket, {
  hooks: { ...window.TesseraHooks, ...colocatedHooks }
})
```

---

## Render the viewer

The viewer takes an ordered list of `sources` (low → high quality). Each entry carries the source's intrinsic pixel `width`. As the user zooms, Tessera swaps between sources based on which layer's native resolution best matches the rendered viewport — sharper without wasting bytes.

### Single source — pan + zoom on a plain image

No preprocessing needed:

```heex
<Tessera.viewer
  id="thumb"
  sources={[%{url: ~p"/uploads/photo.jpg"}]}
  class="w-full h-96"
/>
```

### Two sources — cheap preview, swap to deep zoom on real interaction

The viewer renders the medium variant instantly, then once the user zooms in meaningfully it swaps to a DZI manifest (loading tiles progressively for the visible region):

```heex
<Tessera.viewer
  id="photo"
  sources={[
    %{url: ~p"/uploads/photo-medium.jpg", width: 1024},
    %{url: ~p"/dzi/photo.dzi"}
  ]}
  class="w-full h-[80vh] rounded"
/>
```

### Three sources — progressive ladder for very-high-res images

For images well above the medium variant's resolution (4K+), drop a `large` layer in the middle to avoid jumping straight from medium to tile-generation:

```heex
<Tessera.viewer
  id="poster"
  sources={[
    %{url: ~p"/uploads/photo-medium.jpg", width: 1024},
    %{url: ~p"/uploads/photo-large.jpg",  width: 2560},
    %{url: ~p"/dzi/photo.dzi"}
  ]}
  class="w-full h-[80vh] rounded"
/>
```

Each non-DZI layer's `width` is its intrinsic pixel width; Tessera computes the zoom thresholds where each layer is "good enough" against the container's rendered size, swaps up when the active layer would be visibly upscaled, swaps back down with hysteresis when the user zooms out. DZI sources have no `width` — they cover all zoom levels natively and are treated as the top of the pyramid.

### Source detection

Each source's URL is sniffed for `.dzi`. Hit → OpenSeadragon's DZI tile source (deep zoom with progressive tile loading); anything else (`.jpg`, `.png`, `.webp`, ...) → OSD's built-in simple-image source.

### Interactions

Scroll-wheel / pinch zoom, click-drag pan, double-click zoom — same gestures across every source type and every layer.

---

## Generate tiles

Two flavors of tile generation:

### Eager — full pyramid in one shot

```elixir
{:ok, %{manifest: manifest, tiles_dir: tiles_dir}} =
  Tessera.generate("/uploads/photo.jpg", "/var/www/dzi")
```

Output:

```
/var/www/dzi/photo.dzi              # XML manifest (width, height, tile size)
/var/www/dzi/photo_files/0/0_0.jpg  # zoom level 0 (smallest, single tile)
/var/www/dzi/photo_files/1/0_0.jpg
...
/var/www/dzi/photo_files/N/c_r.jpg  # zoom level N (full res), col c, row r
```

Options:

```elixir
Tessera.generate(input, output_dir,
  tile_size: 256,    # pixels per tile edge
  overlap:   1,      # pixel overlap between neighbors
  format:    :jpg,   # :jpg | :png
  base_name: "img"   # defaults to input basename without extension
)
```

### Lazy — one tile at a time, on demand

For very large images, eagerly building the whole pyramid up front is wasteful — most of those tiles will never be looked at. Instead, generate the manifest cheaply (it's just XML) and have your tile-serving endpoint produce individual tiles on the first request, caching them via a pluggable storage adapter:

```elixir
# Cheap: serve this from a route once per file.
:ok = Tessera.generate_manifest({width, height}, "photo",
  storage: Tessera.Storage.Local,
  storage_opts: [root: "/var/cache/dzi"]
)

# Per-tile: call this from a route on cache miss.
:ok = Tessera.generate_tile("/uploads/photo.jpg", {level, col, row}, "photo",
  image_width:  width,
  image_height: height,
  storage:      Tessera.Storage.Local,
  storage_opts: [root: "/var/cache/dzi"]
)
```

The manifest lands at `<root>/photo.dzi`; tiles at `<root>/photo_files/<level>/<col>_<row>.jpg`.

### Pluggable storage

`Tessera.Storage` is a one-callback behaviour:

```elixir
@callback put(content_path :: Path.t(), key :: String.t(), opts :: keyword()) ::
            :ok | {:error, term()}
```

Tessera writes generated tiles to a temp file, then hands them off to the adapter via `put/3`. The default `Tessera.Storage.Local` copies to a `:root` directory; consumers can implement their own to upload tiles to S3, replicate across buckets, push through a CDN, etc.

```elixir
defmodule MyApp.S3TileStorage do
  @behaviour Tessera.Storage

  def put(content_path, key, opts) do
    bucket = Keyword.fetch!(opts, :bucket)
    ExAws.S3.put_object(bucket, key, File.read!(content_path)) |> ExAws.request() |> case do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end
end

Tessera.generate_tile(input, {1, 0, 0}, "photo",
  image_width: w, image_height: h,
  storage: MyApp.S3TileStorage,
  storage_opts: [bucket: "my-tiles"]
)
```

Reads / existence checks / deletes are the consumer's job — Tessera never reads back what it wrote.

---

## Notes

- **Manifest URLs and tile URLs**: when the viewer is pointed at a `.dzi` manifest, OSD derives tile URLs by stripping the `.dzi` and appending `_files/<level>/<col>_<row>.<format>`. Make sure your tile-serving routes match that shape.
- **Bounds preservation on swap**: the source swap captures the user's current viewport bounds and re-fits them on the new source's `open` event with no animation, so the image just gets sharper or softer in place — no jump back to home.
- **Viewport clamping**: the viewer is configured with `visibilityRatio: 1.0` + `constrainDuringPan: true`, so the image can't be panned off-screen.
- **Built-in nav**: a clean Heroicons-styled column of zoom-in / zoom-out / reset / fullscreen buttons replaces OSD's default PNG-sprite controls (no `prefixUrl` dance against a CDN).

---

## How it fits with PhoenixKit

Tessera has no [PhoenixKit](https://github.com/BeamLabEU/phoenix_kit) dependency, but its API is shaped so PhoenixKit (or any other Phoenix app) can call it inline: `generate*` functions take plain paths + storage opts, `<Tessera.viewer>` takes plain URLs. PhoenixKit's MediaBrowser uses Tessera's lazy generators with a `Storage` adapter that fans tile writes through PhoenixKit's multi-bucket `Storage.Manager`, so tiles replicate across every configured bucket alongside user uploads.

---

## License

MIT — see [LICENSE](./LICENSE).
