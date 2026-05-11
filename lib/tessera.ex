defmodule Tessera do
  @moduledoc """
  Tessera generates DZI (Deep Zoom Image) tile pyramids from input images
  and renders them in a Phoenix LiveView via OpenSeadragon.

  ## Two pieces

    * `Tessera.generate/3` — given an input image path and an output directory,
      shells out to ImageMagick to produce a DZI manifest and tile pyramid.
    * `Tessera.viewer/1` — a Phoenix function component that renders an
      OpenSeadragon viewer pointed at a DZI manifest URL.

  ## Quick start

      # Server-side: produce tiles
      {:ok, %{manifest: manifest, tiles_dir: _}} =
        Tessera.generate("/uploads/photo.jpg", "/var/www/dzi")

      # LiveView: render the viewer
      ~H\"\"\"
      <Tessera.viewer id="photo" src="/dzi/photo.dzi" />
      \"\"\"

  The viewer also accepts plain image URLs (`.jpg`, `.png`, etc.) for basic
  pan + zoom without generating tiles:

      ~H\"\"\"
      <Tessera.viewer id="thumb" src="/uploads/photo.jpg" />
      \"\"\"

  See `Tessera.TileGenerator` and `Tessera.Viewer` for full details.

  Requires ImageMagick (`magick` binary) on the host `PATH` for tile generation,
  and `tessera.js` (in `priv/static/`) wired into the parent app's LiveSocket
  hooks for the viewer.
  """

  defdelegate generate(input_path, output_dir, opts \\ []), to: Tessera.TileGenerator
  defdelegate viewer(assigns), to: Tessera.Viewer
end
