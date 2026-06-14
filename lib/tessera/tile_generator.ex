defmodule Tessera.TileGenerator do
  @moduledoc """
  Generates DZI (Deep Zoom Image) output from input images by shelling out
  to ImageMagick.

  Three operations, all writing through a pluggable `Tessera.Storage`
  adapter (defaults to `Tessera.Storage.Local`):

    * `generate/3` — full eager pyramid for one image, in one call. Use
      when you want every tile up front.
    * `generate_manifest/3` — just the XML manifest declaring image size
      and tile config. Cheap; lets a viewer point at a DZI source before
      any tiles exist.
    * `generate_tile/4` — a single tile at `{level, col, row}`. Use to
      build a pyramid lazily, on demand, as users zoom into specific
      regions.

  ## Requirements

  ImageMagick (`magick` binary) must be on the host `PATH`.
  """

  @type generate_opts :: [
          tile_size: pos_integer(),
          overlap: non_neg_integer(),
          format: :jpg | :png,
          base_name: String.t()
        ]

  @type lazy_opts :: [
          image_width: pos_integer(),
          image_height: pos_integer(),
          tile_size: pos_integer(),
          overlap: non_neg_integer(),
          format: :jpg | :png,
          quality: 1..100,
          storage: module(),
          storage_opts: keyword()
        ]

  @type result :: %{manifest: Path.t(), tiles_dir: Path.t()}

  @default_tile_size 256
  @default_overlap 1
  @default_format :jpg
  @default_quality 80
  @default_storage Tessera.Storage.Local

  # ---------------------------------------------------------------------------
  # Eager full-pyramid generation (unchanged from v0.1.0)
  # ---------------------------------------------------------------------------

  @doc """
  Generate a DZI tile pyramid for `input_path` into `output_dir`.

  Eager: produces every tile in one shot. For lazy per-tile generation,
  see `generate_manifest/3` + `generate_tile/4`.

  Returns `{:ok, %{manifest: path, tiles_dir: path}}` on success.

  ## Options

    * `:tile_size` — pixels per tile edge (default `#{@default_tile_size}`).
    * `:overlap` — pixel overlap between adjacent tiles (default `#{@default_overlap}`).
    * `:format` — `:jpg` or `:png` (default `:jpg`).
    * `:base_name` — manifest filename prefix; defaults to the input file's
      basename without extension.

  ## Errors

    * `{:error, :imagemagick_not_found}` — `magick` not on `PATH`.
    * `{:error, :invalid_input}` — `input_path` does not exist or is not readable.
    * `{:error, {:exit, status, stderr}}` — ImageMagick exited non-zero.
  """
  @spec generate(Path.t(), Path.t(), generate_opts()) :: {:ok, result()} | {:error, term()}
  def generate(input_path, output_dir, opts \\ []) do
    with :ok <- ensure_magick(),
         :ok <- ensure_input(input_path),
         :ok <- File.mkdir_p(output_dir) do
      tile_size = Keyword.get(opts, :tile_size, @default_tile_size)
      overlap = Keyword.get(opts, :overlap, @default_overlap)
      format = Keyword.get(opts, :format, @default_format)
      base_name = Keyword.get(opts, :base_name, default_base_name(input_path))

      manifest = Path.join(output_dir, "#{base_name}.dzi")
      tiles_dir = Path.join(output_dir, "#{base_name}_files")

      args = [
        "convert",
        input_path,
        # Respect EXIF orientation so tiles match the displayed image (see
        # run_crop/5 for the lazy path).
        "-auto-orient",
        "-define",
        "dzi:tile-size=#{tile_size}",
        "-define",
        "dzi:overlap=#{overlap}",
        "-define",
        "dzi:format=#{format}",
        manifest
      ]

      case System.cmd("magick", args, stderr_to_stdout: false) do
        {_out, 0} -> {:ok, %{manifest: manifest, tiles_dir: tiles_dir}}
        {stderr, status} -> {:error, {:exit, status, stderr}}
      end
    end
  end

  # ---------------------------------------------------------------------------
  # Lazy: manifest + per-tile generation
  # ---------------------------------------------------------------------------

  @doc """
  Generate the DZI XML manifest for an image of size `{width, height}` and
  hand it off to the configured storage adapter under the key
  `"<base_name>.dzi"`. No tiles are produced — see `generate_tile/4` for
  that.

  ## Options

    * `:tile_size` (default `#{@default_tile_size}`)
    * `:overlap` (default `#{@default_overlap}`)
    * `:format` (`:jpg` | `:png`, default `:jpg`)
    * `:storage` (module implementing `Tessera.Storage`, default
      `Tessera.Storage.Local`)
    * `:storage_opts` (keyword list passed to `storage.put/3`)
  """
  @spec generate_manifest({pos_integer(), pos_integer()}, String.t(), keyword()) ::
          :ok | {:error, term()}
  def generate_manifest({width, height}, base_name, opts \\ [])
      when is_integer(width) and width > 0 and is_integer(height) and height > 0 do
    tile_size = Keyword.get(opts, :tile_size, @default_tile_size)
    overlap = Keyword.get(opts, :overlap, @default_overlap)
    format = format_string(Keyword.get(opts, :format, @default_format))

    xml = manifest_xml(width, height, tile_size, overlap, format)
    key = "#{base_name}.dzi"

    with_tempfile(".dzi", fn temp_path ->
      File.write(temp_path, xml)
      storage_put(temp_path, key, opts)
    end)
  end

  @doc """
  Generate a single DZI tile at `{level, col, row}` from `input_path` and
  hand it off to the configured storage adapter under the key
  `"<base_name>_files/<level>/<col>_<row>.<ext>"`.

  The caller must supply the source image's `:image_width` and
  `:image_height` (typically read from a database column populated at
  upload time) so Tessera doesn't need to re-probe the image dimensions
  on every tile.

  ## Options

    * `:image_width` (**required**)
    * `:image_height` (**required**)
    * `:tile_size` (default `#{@default_tile_size}`)
    * `:overlap` (default `#{@default_overlap}`)
    * `:format` (`:jpg` | `:png`, default `:jpg`)
    * `:quality` (1..100, default `#{@default_quality}`) — only honored for
      `:jpg`
    * `:storage` (module implementing `Tessera.Storage`, default
      `Tessera.Storage.Local`)
    * `:storage_opts` (keyword list passed to `storage.put/3`)

  ## Errors

    * `{:error, :imagemagick_not_found}` — `magick` not on `PATH`.
    * `{:error, :invalid_input}` — `input_path` does not exist or is not readable.
    * `{:error, :invalid_coordinate}` — `(level, col, row)` falls outside the
      pyramid for the given image dimensions.
    * `{:error, {:exit, status, stderr}}` — ImageMagick exited non-zero.
  """
  @spec generate_tile(
          Path.t(),
          {non_neg_integer(), non_neg_integer(), non_neg_integer()},
          String.t(),
          lazy_opts()
        ) :: :ok | {:error, term()}
  def generate_tile(input_path, {level, col, row}, base_name, opts)
      when is_integer(level) and level >= 0 and is_integer(col) and col >= 0 and
             is_integer(row) and row >= 0 do
    with :ok <- ensure_magick(),
         :ok <- ensure_input(input_path),
         {:ok, w, h} <- fetch_image_dims(opts),
         tile_size = Keyword.get(opts, :tile_size, @default_tile_size),
         overlap = Keyword.get(opts, :overlap, @default_overlap),
         format = Keyword.get(opts, :format, @default_format),
         quality = Keyword.get(opts, :quality, @default_quality),
         {:ok, region} <- compute_tile_region(w, h, level, col, row, tile_size, overlap) do
      ext = ext_for(format)
      key = "#{base_name}_files/#{level}/#{col}_#{row}.#{ext}"

      with_tempfile(".#{ext}", fn temp_path ->
        case run_crop(input_path, temp_path, region, format, quality) do
          :ok -> storage_put(temp_path, key, opts)
          {:error, _} = err -> err
        end
      end)
    end
  end

  # ---------------------------------------------------------------------------
  # Internals: storage + tempfile
  # ---------------------------------------------------------------------------

  defp storage_put(content_path, key, opts) do
    storage = Keyword.get(opts, :storage, @default_storage)
    storage_opts = Keyword.get(opts, :storage_opts, [])
    storage.put(content_path, key, storage_opts)
  end

  defp with_tempfile(ext, fun) do
    tmpdir = System.tmp_dir!()
    path = Path.join(tmpdir, "tessera-#{System.unique_integer([:positive])}#{ext}")

    try do
      fun.(path)
    after
      File.rm(path)
    end
  end

  # ---------------------------------------------------------------------------
  # Internals: ImageMagick
  # ---------------------------------------------------------------------------

  defp ensure_magick do
    if System.find_executable("magick"), do: :ok, else: {:error, :imagemagick_not_found}
  end

  defp ensure_input(path) do
    if File.exists?(path), do: :ok, else: {:error, :invalid_input}
  end

  defp default_base_name(input_path) do
    Path.basename(input_path, Path.extname(input_path))
  end

  defp fetch_image_dims(opts) do
    with w when is_integer(w) and w > 0 <- Keyword.get(opts, :image_width),
         h when is_integer(h) and h > 0 <- Keyword.get(opts, :image_height) do
      {:ok, w, h}
    else
      _ -> {:error, :missing_image_dims}
    end
  end

  defp format_string(:jpg), do: "jpg"
  defp format_string(:png), do: "png"

  defp ext_for(:jpg), do: "jpg"
  defp ext_for(:png), do: "png"

  defp run_crop(input_path, output_path, region, format, quality) do
    {src_x, src_y, src_w, src_h, out_w, out_h} = region

    quality_args = if format == :jpg, do: ["-quality", Integer.to_string(quality)], else: []

    args =
      [
        "convert",
        input_path,
        # Apply EXIF orientation BEFORE cropping so the crop coordinate system
        # matches the displayed (EXIF-applied) image — otherwise a rotated
        # source (e.g. a phone photo whose raw pixels are landscape but display
        # portrait) yields crops from the wrong region/aspect and the tiles
        # render distorted over an otherwise-correct base image.
        "-auto-orient",
        "-crop",
        "#{src_w}x#{src_h}+#{src_x}+#{src_y}",
        "+repage",
        "-resize",
        "#{out_w}x#{out_h}!"
      ] ++ quality_args ++ [output_path]

    case System.cmd("magick", args, stderr_to_stdout: true) do
      {_, 0} -> :ok
      {stderr, status} -> {:error, {:exit, status, stderr}}
    end
  end

  # ---------------------------------------------------------------------------
  # Internals: DZI coordinate math
  # ---------------------------------------------------------------------------

  # Returns `{src_x, src_y, src_w, src_h, out_w, out_h}` — the rectangle to
  # crop from the original image, and the dimensions of the resulting tile.
  defp compute_tile_region(image_w, image_h, level, col, row, tile_size, overlap) do
    max_level = max_level_for(image_w, image_h)

    cond do
      level > max_level ->
        {:error, :invalid_coordinate}

      true ->
        scale = pow2(max_level - level)
        level_w = ceil_div(image_w, scale)
        level_h = ceil_div(image_h, scale)

        tile_x = col * tile_size
        tile_y = row * tile_size

        cond do
          tile_x >= level_w or tile_y >= level_h ->
            {:error, :invalid_coordinate}

          true ->
            tile_w = min(tile_size, level_w - tile_x)
            tile_h = min(tile_size, level_h - tile_y)

            ol_left = if col == 0, do: 0, else: overlap
            ol_top = if row == 0, do: 0, else: overlap
            ol_right = if tile_x + tile_size >= level_w, do: 0, else: overlap
            ol_bottom = if tile_y + tile_size >= level_h, do: 0, else: overlap

            out_w = tile_w + ol_left + ol_right
            out_h = tile_h + ol_top + ol_bottom

            level_origin_x = tile_x - ol_left
            level_origin_y = tile_y - ol_top

            src_x = level_origin_x * scale
            src_y = level_origin_y * scale
            src_w = min(out_w * scale, image_w - src_x)
            src_h = min(out_h * scale, image_h - src_y)

            {:ok, {src_x, src_y, src_w, src_h, out_w, out_h}}
        end
    end
  end

  defp max_level_for(w, h) do
    max_dim = max(w, h)
    max(0, :math.log2(max_dim) |> Float.ceil() |> trunc())
  end

  defp pow2(n) when n >= 0, do: trunc(:math.pow(2, n))

  defp ceil_div(n, d) when d > 0, do: div(n + d - 1, d)

  # ---------------------------------------------------------------------------
  # Internals: manifest XML
  # ---------------------------------------------------------------------------

  defp manifest_xml(width, height, tile_size, overlap, format) do
    """
    <?xml version="1.0" encoding="UTF-8"?>
    <Image TileSize="#{tile_size}" Overlap="#{overlap}" Format="#{format}" xmlns="http://schemas.microsoft.com/deepzoom/2008">
      <Size Width="#{width}" Height="#{height}" />
    </Image>
    """
  end
end
