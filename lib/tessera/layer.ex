defmodule Tessera.Layer do
  @moduledoc """
  Attaches Tessera's progressive-resolution + DZI deep-zoom behavior to a
  Fresco viewer or canvas by id.

  Tessera 0.3 is rewritten for Fresco's own viewer engine (Fresco 0.5
  dropped OpenSeadragon for a CSS-transform engine). Like
  [Etcher](https://hex.pm/packages/etcher), Tessera is now a **peer layer**:
  it gets the Fresco handle via `window.Fresco.onReady/2`, reads the live
  transform, and contributes two things — without owning the viewer:

    * **Progressive resolution swap.** Given an ordered `sources` ladder
      (low → high), Tessera swaps the Fresco image to a sharper raster as
      the user zooms in (and back down on zoom-out), via the handle's
      `swapSourcePreservingBounds` / `setImageSrc`. Hysteresis avoids
      flicker at the boundaries; the viewport never jumps.

    * **DZI tile streaming.** When a `dzi_url` is given and the user zooms
      *past* the sharpest raster source (deep zoom on a multi-gigapixel
      image), Tessera lazily fetches the `.dzi` manifest and streams the
      visible tiles at the matching pyramid level into an overlay aligned
      to the Fresco transform. Tiles for unviewed regions never hit
      storage; the overlay hides again when the user zooms back out.

  ## Usage

      <Fresco.canvas id="photo" canvas={@canvas} />

      <Tessera.layer
        fresco_id="photo"
        sources={[
          %{url: ~p"/uploads/photo-medium.jpg", width: 800},
          %{url: ~p"/uploads/photo-large.jpg",  width: 1920},
          %{url: ~p"/uploads/photo-original.jpg", width: 6000}
        ]}
        dzi_url={~p"/dzi/photo.dzi"}
      />

  ### Sources

  An ordered list of low → high quality raster layers. Each entry is a map
  with:

    * `:url` (required) — the image URL.
    * `:width` (optional but recommended) — intrinsic pixel width. Tessera
      swaps to the next source up once the image is displayed wider than
      this. Omit and the source is treated as a last-resort top raster.

  The Fresco viewer should open at the `sources` first entry; Tessera keeps
  the displayed raster in step with zoom from there.

  ### `dzi_url`

  Optional. A `.dzi` manifest URL for the same image at full resolution.
  When present, Tessera activates tile streaming once zoom exceeds the top
  raster source — so gigapixel images stay crisp at extreme zoom while the
  cheap raster ladder covers everyday zoom. Omit it and Tessera is a pure
  resolution-swap layer.

  ## Server-side helpers (unchanged)

  Tessera also ships the DZI tile-generation API:

    * `Tessera.generate/3` — eager full-pyramid generator
    * `Tessera.generate_manifest/3` — just the XML manifest
    * `Tessera.generate_tile/4` — one tile at a time, on demand
    * `Tessera.Storage` behaviour + `Tessera.Storage.Local` default
  """

  use Phoenix.Component

  attr(:fresco_id, :string,
    required: true,
    doc: "DOM id of the `<Fresco.viewer>` / `<Fresco.canvas>` this layer attaches to."
  )

  attr(:sources, :list,
    required: true,
    doc: """
    Ordered low → high quality raster layers; each a `%{url, width}` map.
    See moduledoc for details.
    """
  )

  attr(:dzi_url, :string,
    default: nil,
    doc: """
    Optional `.dzi` manifest URL. When set, Tessera streams tiles for deep
    zoom past the sharpest raster source. See moduledoc for details.
    """
  )

  attr(:id, :string,
    default: nil,
    doc:
      "Optional DOM id for the layer host element; defaults to `\"tessera-layer-<fresco_id>\"`."
  )

  attr(:rest, :global)

  @doc """
  Mounts a Tessera progressive-resolution / DZI layer onto a Fresco viewer.

  The component renders a hidden `<div phx-hook="TesseraLayer">` that's
  invisible to users; it exists only to host the LiveView hook. The hook
  looks up the named Fresco viewer via `window.Fresco.onReady/2` and
  attaches.
  """
  def layer(assigns) do
    sources_json = Jason.encode!(assigns.sources)

    layer_id =
      case assigns.id do
        nil -> "tessera-layer-" <> assigns.fresco_id
        id -> id
      end

    assigns =
      assigns
      |> assign(:sources_json, sources_json)
      |> assign(:layer_id, layer_id)

    ~H"""
    <div
      id={@layer_id}
      phx-hook="TesseraLayer"
      data-fresco-id={@fresco_id}
      data-sources={@sources_json}
      data-dzi-url={@dzi_url}
      class="hidden"
      aria-hidden="true"
      {@rest}
    >
    </div>
    """
  end
end
