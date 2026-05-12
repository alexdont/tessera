defmodule Tessera.Layer do
  @moduledoc """
  Attaches Tessera's DZI deep-zoom + multi-layer progressive-quality
  behavior to a Fresco viewer by id.

  Tessera 0.2 is no longer a standalone viewer — it's a **layer** that
  composes onto a `<Fresco.viewer>`. The Fresco viewer owns the OSD
  instance, the nav overlay, animations, and viewport clamping; Tessera
  contributes:

    * A DZI source provider registered with Fresco (so any `.dzi`
      manifest URL is treated as a tile pyramid)
    * A multi-layer source-swap that promotes / demotes through an
      ordered `sources` list as the user zooms in and out, with
      hysteresis to avoid flicker around the boundaries, and a
      bounds-preserving swap so the user never sees a jump to home

  ## Usage

      <Fresco.viewer id="photo" src={~p"/uploads/photo-medium.jpg"} />

      <Tessera.layer
        fresco_id="photo"
        sources={[
          %{url: ~p"/uploads/photo-medium.jpg", width: 1024},
          %{url: ~p"/uploads/photo-large.jpg",  width: 2560},
          %{url: ~p"/dzi/photo.dzi"}
        ]}
      />

  ### Sources

  An ordered list of low → high quality layers. Each entry is a map with:

    * `:url` (required) — the source URL (a plain image or a `.dzi` manifest)
    * `:width` (optional) — intrinsic pixel width. Tessera computes the
      zoom threshold past which this source is upscaled and swaps to the
      next one up. Omit for `.dzi` sources — DZI's tile pyramid covers
      all zoom levels.

  The viewer's initial state should match `sources` first entry (Fresco
  opens with its own `src`; Tessera trusts the consumer to keep them in
  sync). When zoom crosses each threshold, Tessera asks Fresco to swap
  while preserving the user's viewport bounds.

  ## Server-side helpers (unchanged from 0.1)

  Tessera also ships the lazy DZI tile-generation API:

    * `Tessera.generate/3` — eager full-pyramid generator
    * `Tessera.generate_manifest/3` — just the XML manifest
    * `Tessera.generate_tile/4` — one tile at a time, on demand
    * `Tessera.Storage` behaviour + `Tessera.Storage.Local` default

  These are unchanged from 0.1 — the breaking change in 0.2 is on the
  client side only.
  """

  use Phoenix.Component

  attr(:fresco_id, :string,
    required: true,
    doc: "DOM id of the `<Fresco.viewer>` this layer attaches to."
  )

  attr(:sources, :list,
    required: true,
    doc: """
    Ordered low → high quality layers; each a `%{url, width}` map.
    Width is optional for `.dzi` sources. See moduledoc for details.
    """
  )

  attr(:id, :string,
    default: nil,
    doc:
      "Optional DOM id for the layer host element; defaults to `\"tessera-layer-<fresco_id>\"`."
  )

  attr(:rest, :global)

  @doc """
  Mounts a Tessera DZI / multi-layer layer onto a Fresco viewer.

  The component renders a hidden `<div phx-hook="TesseraLayer">` that's
  invisible to users; it exists only to host the LiveView hook. The hook
  looks up the named Fresco viewer via `window.Fresco.onViewerReady/2`
  and attaches.
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
      class="hidden"
      aria-hidden="true"
      {@rest}
    >
    </div>
    """
  end
end
