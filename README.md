# Tessera

DZI deep-zoom + multi-layer progressive-quality layer for [Fresco](https://hex.pm/packages/fresco)-based image viewers in Phoenix. Generate DZI (Deep Zoom Image) tile pyramids from images via ImageMagick — eagerly or lazily one tile at a time — and render them as a Fresco layer that swaps between source qualities as the user zooms.

A *tessera* is a single tile in a mosaic. Tessera the library produces and consumes those tiles, layered on top of a Fresco viewer.

---

## Install

```elixir
def deps do
  [
    {:fresco, "~> 0.7"},
    {:tessera, "~> 0.3"}
  ]
end
```

System requirement: **ImageMagick** (`magick` binary) on the host `PATH` for tile generation.

In your `assets/js/app.js`, import the JS hooks (Fresco first, then Tessera):

```js
import "../../deps/fresco/priv/static/fresco.js"
import "../../deps/tessera/priv/static/tessera.js"

let liveSocket = new LiveSocket("/live", Socket, {
  hooks: { ...window.FrescoHooks, ...window.TesseraHooks, ...colocatedHooks }
})
```

---

## Render the viewer

Mount a Fresco viewer/canvas with a cheap preview, then attach a Tessera layer with the raster ladder (and, optionally, a DZI manifest for deep zoom). As the user zooms, Tessera swaps to a sharper raster while preserving viewport bounds; past the sharpest raster it streams DZI tiles.

### Raster ladder only — medium + large + original

```heex
<Fresco.canvas id="photo" canvas={@canvas} class="w-full h-[80vh] rounded" />

<Tessera.layer
  fresco_id="photo"
  sources={[
    %{url: ~p"/uploads/photo-medium.jpg",   width: 800},
    %{url: ~p"/uploads/photo-large.jpg",    width: 1920},
    %{url: ~p"/uploads/photo-original.jpg", width: 6000}
  ]}
/>
```

### Raster ladder + DZI deep zoom (for gigapixel images)

```heex
<Fresco.canvas id="poster" canvas={@canvas} class="w-full h-[80vh] rounded" />

<Tessera.layer
  fresco_id="poster"
  sources={[
    %{url: ~p"/uploads/photo-medium.jpg",   width: 800},
    %{url: ~p"/uploads/photo-large.jpg",    width: 1920},
    %{url: ~p"/uploads/photo-original.jpg", width: 6000}
  ]}
  dzi_url={~p"/dzi/photo.dzi"}
/>
```

Each source carries its intrinsic pixel `width`; Tessera swaps to the next source up once the image is displayed wider than the current source (with hysteresis to prevent flicker). When `dzi_url` is set, Tessera activates tile streaming past the sharpest raster — so the cheap raster ladder covers everyday zoom and the DZI pyramid keeps gigapixel images crisp at extreme zoom.

---

## Generate tiles

### Eager — full pyramid in one shot

```elixir
{:ok, %{manifest: manifest, tiles_dir: tiles_dir}} =
  Tessera.generate("/uploads/photo.jpg", "/var/www/dzi")
```

Output:

```
/var/www/dzi/photo.dzi              # XML manifest
/var/www/dzi/photo_files/0/0_0.jpg  # zoom level 0 (smallest tile)
...
/var/www/dzi/photo_files/N/c_r.jpg  # zoom level N, col c, row r
```

Options:

```elixir
Tessera.generate(input, output_dir,
  tile_size: 256,    # pixels per tile edge
  overlap:   1,
  format:    :jpg,   # :jpg | :png
  base_name: "img"   # defaults to input basename without extension
)
```

### Lazy — one tile at a time, on demand

For very large images, eagerly building the whole pyramid is wasteful — most tiles will never be looked at. Generate the manifest cheaply, then produce individual tiles on first request:

```elixir
:ok = Tessera.generate_manifest({width, height}, "photo",
  storage: Tessera.Storage.Local,
  storage_opts: [root: "/var/cache/dzi"]
)

:ok = Tessera.generate_tile("/uploads/photo.jpg", {level, col, row}, "photo",
  image_width:  width,
  image_height: height,
  storage:      Tessera.Storage.Local,
  storage_opts: [root: "/var/cache/dzi"]
)
```

### Pluggable storage

`Tessera.Storage` is a one-callback behaviour — Tessera writes generated tiles to a temp file, then hands them off via `put/3`:

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

- **Tile URLs**: Tessera derives tile URLs from the `dzi_url` location by replacing the `.dzi` suffix with `_files/<level>/<col>_<row>.<format>` (any query string is preserved). Make sure your tile-serving routes match.
- **Viewport preservation on swap**: handled by Fresco's `swapSourcePreservingBounds` (falling back to `setImageSrc`) — Tessera asks Fresco to swap; Fresco does the bounds-preserving open.
- **Built-in viewer chrome** (nav buttons, pan clamping, animations) comes from Fresco; Tessera only contributes the raster ladder + DZI tile overlay.

---

## What changed in 0.3

Fresco 0.5 dropped OpenSeadragon for its own CSS-transform engine, which broke Tessera 0.2 (it registered a DZI source provider with OSD and read `viewport.getZoom()`). Tessera 0.3 is a Fresco **peer layer** (the same model as Etcher): it gets the Fresco handle via `window.Fresco.onReady/2`, reads the live transform, swaps rasters with `swapSourcePreservingBounds`, and renders a DZI tile overlay aligned to the transform. `<Tessera.layer>` gains an optional `dzi_url` attribute; `sources` is unchanged.

The server-side `Tessera.generate/3`, `Tessera.generate_manifest/3`, `Tessera.generate_tile/4`, and `Tessera.Storage` API are **unchanged**.

---

## License

MIT — see [LICENSE](./LICENSE).
