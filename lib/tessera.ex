defmodule Tessera do
  @moduledoc """
  Tessera is the DZI deep-zoom + multi-layer progressive-quality layer
  for [Fresco](https://hex.pm/packages/fresco)-based image viewers in
  Phoenix.

  ## Two pieces

    * **Server side** (unchanged from 0.1): generate DZI tile pyramids
      from images, eagerly or lazily on demand.
        * `Tessera.generate/3` — eager full-pyramid generator.
        * `Tessera.generate_manifest/3` + `Tessera.generate_tile/4` — lazy
          per-tile primitives plus a `Tessera.Storage` behaviour so
          consumers can plug in any storage backend.

    * **Client side**: a Fresco *layer* that registers a DZI source
      provider and a multi-layer source-swap.
        * `Tessera.layer/1` — `<Tessera.layer fresco_id sources>`,
          attaches to a `<Fresco.viewer id>` by id.

  ## Quick start

  Generate tiles server-side (any time — at upload, lazily, etc.):

      {:ok, %{manifest: manifest, tiles_dir: _}} =
        Tessera.generate("/uploads/photo.jpg", "/var/www/dzi")

  Render in a LiveView — a Fresco viewer that auto-handles DZI sources
  via Tessera, with multi-layer progressive zoom from a cheap preview to
  the deep-zoom pyramid:

      ~H\"\"\"
      <Fresco.viewer
        id="photo"
        src={~p"/uploads/photo-medium.jpg"}
        class="w-full h-[80vh] rounded"
      />

      <Tessera.layer
        fresco_id="photo"
        sources={[
          %{url: ~p"/uploads/photo-medium.jpg", width: 1024},
          %{url: ~p"/uploads/photo-large.jpg",  width: 2560},
          %{url: ~p"/dzi/photo.dzi"}
        ]}
      />
      \"\"\"

  Tessera's JS hook attaches to the named Fresco viewer, watches zoom
  events, and swaps between layers when the user's zoom crosses each
  threshold — keeping medium → large → DZI as a smooth ladder rather
  than a single jump.

  ## What changed in 0.2

  Tessera 0.1 was a standalone viewer (`<Tessera.viewer>`). In 0.2 it's
  a Fresco layer (`<Tessera.layer fresco_id=...>`) instead. The Fresco
  viewer owns the OSD instance, the nav overlay, the smooth animations,
  and the viewport clamping. Tessera contributes:

    * A DZI source provider registered with Fresco
    * The multi-layer progressive-zoom logic (debounced, hysteresis)

  The server-side `Tessera.generate/3` etc. API is unchanged. Existing
  consumers of the Elixir-side generators don't need to update anything
  on the server.

  Requires `magick` (ImageMagick) on the host `PATH` for tile generation,
  and Fresco + Tessera JS wired into the parent app's LiveSocket hooks
  (see the README).

  ## See also

    * `Tessera.Layer` — the LiveView component.
    * `Tessera.TileGenerator` — eager + lazy generators.
    * `Tessera.Storage` — pluggable storage behaviour.
    * [`fresco`](https://hex.pm/packages/fresco) — the underlying viewer.
  """

  defdelegate generate(input_path, output_dir, opts \\ []), to: Tessera.TileGenerator
  defdelegate generate_manifest(dimensions, base_name, opts \\ []), to: Tessera.TileGenerator
  defdelegate generate_tile(input_path, coord, base_name, opts), to: Tessera.TileGenerator
  defdelegate layer(assigns), to: Tessera.Layer
end
