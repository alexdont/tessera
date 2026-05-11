defmodule Tessera.Viewer do
  @moduledoc """
  Phoenix LiveView function component that mounts an OpenSeadragon viewer
  with **progressive multi-layer zoom**.

  The component accepts an ordered list of `sources` (low → high quality)
  and switches between them as the user zooms. Each layer covers the
  zoom band where its native resolution is roughly 1:1 with the rendered
  pixels; beyond that, the next layer up takes over. Layers are tagged
  with their intrinsic pixel `width` so the client can compute
  thresholds; layers without a width (typically a `.dzi` manifest) are
  treated as the top layer with infinite zoom headroom.

  The component renders a `<div>` with `phx-hook="TesseraViewer"`. The
  client-side hook (defined in `priv/static/tessera.js`) lazy-loads
  OpenSeadragon from jsDelivr on first mount, opens the first source,
  then upgrades / downgrades the source as zoom crosses each layer's
  threshold.

  ## Usage

  Two-layer (medium → DZI):

      <Tessera.viewer
        id="photo"
        sources={[
          %{url: ~p"/uploads/photo-medium.jpg", width: 1024},
          %{url: ~p"/dzi/photo.dzi"}
        ]}
        class="w-full h-[80vh] rounded"
      />

  Three-layer (medium → large → DZI), useful for 4K+ images:

      <Tessera.viewer
        id="photo"
        sources={[
          %{url: ~p"/uploads/photo-medium.jpg", width: 1024},
          %{url: ~p"/uploads/photo-large.jpg", width: 2560},
          %{url: ~p"/dzi/photo.dzi"}
        ]}
        class="w-full h-[80vh] rounded"
      />

  Plain pan + zoom on a single image:

      <Tessera.viewer
        id="thumb"
        sources={[%{url: ~p"/uploads/photo.jpg"}]}
        class="w-full h-96"
      />

  ## Source detection

  Each source's URL extension is sniffed at the JS layer. `.dzi` →
  OpenSeadragon's DZI tile source; anything else → OSD's built-in
  "simple image" tile source. Pan and zoom work either way; deep zoom
  with progressive tile loading only kicks in for DZI sources.

  ## Parent app setup

  Import `tessera.js` in the parent's `app.js` and spread `TesseraHooks`
  into the LiveSocket hooks:

      import "../../deps/tessera/priv/static/tessera.js"

      let liveSocket = new LiveSocket("/live", Socket, {
        hooks: { ...window.TesseraHooks, ...colocatedHooks }
      })
  """

  use Phoenix.Component

  attr(:id, :string, required: true, doc: "DOM id; must be unique on the page")

  attr(:sources, :list,
    required: true,
    doc: """
    Ordered low → high quality layers. Each entry is a map with:

      * `:url` (required) — the source URL (a plain image or a `.dzi` manifest).
      * `:width` (optional) — intrinsic pixel width of this source. Used to
        compute the zoom range where this layer is "good enough". Omit
        (or leave nil) for `.dzi` sources; DZI covers all zoom levels
        natively and is treated as the top layer with infinite headroom.

    The first entry is the initial render. The list must contain at
    least one source.
    """
  )

  attr(:class, :string, default: "w-full h-96", doc: "CSS classes for the viewer container")
  attr(:rest, :global)

  @doc """
  Renders an OpenSeadragon viewer with progressive multi-layer zoom.

  See the module docs for the layer-threshold model.
  """
  def viewer(assigns) do
    sources_json = Jason.encode!(assigns.sources)
    assigns = assign(assigns, :sources_json, sources_json)

    ~H"""
    <div
      id={@id}
      phx-hook="TesseraViewer"
      data-sources={@sources_json}
      class={@class}
      {@rest}
    >
    </div>
    """
  end
end
