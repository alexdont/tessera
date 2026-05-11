defmodule Tessera.Viewer do
  @moduledoc """
  Phoenix LiveView function component that mounts an OpenSeadragon viewer on
  an image source. Accepts either a DZI manifest URL (deep zoom with tile
  loading) or a plain image URL like `.jpg` / `.png` (basic pan + zoom on a
  single image, no preprocessing required).

  The component renders a `<div>` with `phx-hook="TesseraViewer"`. The
  client-side hook (defined in `priv/static/tessera.js`) lazy-loads
  OpenSeadragon from jsDelivr on first mount, detects the source type from
  the URL extension, and initializes OSD with the right tile source.

  ## Usage

  Deep zoom (DZI pyramid, generated server-side via `Tessera.generate/3`):

      <Tessera.viewer
        id="photo"
        src={~p"/dzi/photo.dzi"}
        class="w-full h-[80vh] rounded"
      />

  Basic pan + zoom on a plain image (no DZI required):

      <Tessera.viewer
        id="thumb"
        src={~p"/uploads/photo.jpg"}
        class="w-full h-96"
      />

  ## Source detection

  The client looks at the URL's path. If it ends in `.dzi` (with or without
  a query string), OSD is configured with the DZI tile source. Otherwise the
  URL is treated as a plain image and OSD uses its built-in "simple image"
  tile source — pan and zoom work, but there's no progressive higher-res
  loading because there are no tiles.

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

  attr(:src, :string,
    required: true,
    doc:
      "URL of the source: a `.dzi` manifest for deep zoom, or a plain image (`.jpg`, `.png`, etc.) for basic pan + zoom"
  )

  attr(:class, :string, default: "w-full h-96", doc: "CSS classes for the viewer container")
  attr(:rest, :global)

  @doc """
  Renders an OpenSeadragon viewer pointed at the given source URL.

  See the module docs for the deep-zoom vs. plain-image source detection rule.
  """
  def viewer(assigns) do
    ~H"""
    <div
      id={@id}
      phx-hook="TesseraViewer"
      data-src={@src}
      class={@class}
      {@rest}
    >
    </div>
    """
  end
end
