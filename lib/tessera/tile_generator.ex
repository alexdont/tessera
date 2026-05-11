defmodule Tessera.TileGenerator do
  @moduledoc """
  Generates DZI (Deep Zoom Image) tile pyramids from input images by shelling
  out to ImageMagick.

  ## Output

  Given `output_dir` and `:base_name "photo"`, ImageMagick writes:

      output_dir/photo.dzi              # XML manifest
      output_dir/photo_files/0/0_0.jpg  # zoom level 0 (smallest)
      output_dir/photo_files/1/0_0.jpg
      ...
      output_dir/photo_files/N/c_r.jpg  # zoom level N (full res), col c, row r

  The package does not pick a default `output_dir`. Callers are responsible
  for where the tiles end up and how they're served.

  ## Requirements

  ImageMagick (`magick` binary) must be on the host `PATH`.
  """

  @type opts :: [
          tile_size: pos_integer(),
          overlap: non_neg_integer(),
          format: :jpg | :png,
          base_name: String.t()
        ]

  @type result :: %{manifest: Path.t(), tiles_dir: Path.t()}

  @default_tile_size 256
  @default_overlap 1
  @default_format :jpg

  @doc """
  Generate a DZI tile pyramid for `input_path` into `output_dir`.

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
  @spec generate(Path.t(), Path.t(), opts()) :: {:ok, result()} | {:error, term()}
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

  defp ensure_magick do
    if System.find_executable("magick"), do: :ok, else: {:error, :imagemagick_not_found}
  end

  defp ensure_input(path) do
    if File.exists?(path), do: :ok, else: {:error, :invalid_input}
  end

  defp default_base_name(input_path) do
    Path.basename(input_path, Path.extname(input_path))
  end
end
