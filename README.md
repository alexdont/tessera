# Tessera

DZI deep-zoom + multi-layer progressive-quality layer for [Fresco](https://hex.pm/packages/fresco)-based image viewers in Phoenix. Generate DZI (Deep Zoom Image) tile pyramids from images via ImageMagick — eagerly or lazily one tile at a time — and render them as a Fresco layer that swaps between source qualities as the user zooms.

A *tessera* is a single tile in a mosaic. Tessera the library produces and consumes those tiles, layered on top of a Fresco viewer.

---

## Install

```elixir
def deps do
  [
    {:fresco, "~> 0.1"},
    {:tessera, "~> 0.2"}
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

Mount a Fresco viewer with a cheap preview, then attach a Tessera layer with the full source ladder. As the user zooms, Tessera swaps between layers automatically while preserving viewport bounds.

### Two layers — medium + DZI deep zoom

```heex
<Fresco.viewer
  id="photo"
  src={~p"/uploads/photo-medium.jpg"}
  class="w-full h-[80vh] rounded"
/>

<Tessera.layer
  fresco_id="photo"
  sources={[
    %{url: ~p"/uploads/photo-medium.jpg", width: 1024},
    %{url: ~p"/dzi/photo.dzi"}
  ]}
/>
```

### Three layers — medium + large + DZI (recommended for 4K+ images)

```heex
<Fresco.viewer
  id="poster"
  src={~p"/uploads/photo-medium.jpg"}
  class="w-full h-[80vh] rounded"
/>

<Tessera.layer
  fresco_id="poster"
  sources={[
    %{url: ~p"/uploads/photo-medium.jpg", width: 1024},
    %{url: ~p"/uploads/photo-large.jpg",  width: 2560},
    %{url: ~p"/dzi/photo.dzi"}
  ]}
/>
```

Each non-DZI source carries its intrinsic pixel `width`; Tessera computes the zoom threshold past which that source is upscaled and swaps to the next layer with hysteresis to prevent flicker. DZI entries omit `width` and act as the final layer (deep zoom covers all higher zoom levels).

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

- **Tile URLs**: OSD derives tile URLs from a DZI manifest's location by appending `_files/<level>/<col>_<row>.<format>`. Make sure your tile-serving routes match.
- **Viewport preservation on swap**: handled by Fresco's `swapSourcePreservingBounds` — Tessera asks Fresco to swap; Fresco does the bounds-preserving open.
- **Built-in viewer chrome** (nav buttons, pan clamping, animations) comes from Fresco; Tessera only contributes the source-provider + multi-layer ladder.

---

## What changed in 0.2

Tessera 0.1 was a standalone viewer (`<Tessera.viewer src=...>`). 0.2 is a Fresco layer (`<Tessera.layer fresco_id=... sources=...>`). The Fresco viewer owns OSD, the nav overlay, animations, and viewport clamping; Tessera focuses on what's actually distinctive (DZI source provider + multi-layer zoom logic).

The server-side `Tessera.generate/3`, `Tessera.generate_manifest/3`, `Tessera.generate_tile/4`, and `Tessera.Storage` API are **unchanged**. Migration from 0.1 to 0.2 only affects the template — see the usage examples above.

---

## License

MIT — see [LICENSE](./LICENSE).
