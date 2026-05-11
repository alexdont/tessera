defmodule Tessera.Storage.Local do
  @moduledoc """
  Default `Tessera.Storage` implementation that copies tiles into a
  caller-supplied root directory on the local filesystem.

  ## Required opt

    * `:root` — base directory; intermediate dirs are created as needed.

  ## Example

      Tessera.generate_tile(input, {1, 0, 0}, "my-image",
        image_width: 4032,
        image_height: 3024,
        storage: Tessera.Storage.Local,
        storage_opts: [root: "/var/tiles"]
      )

  Tiles land at `/var/tiles/my-image_files/1/0_0.jpg`; the manifest from
  `Tessera.generate_manifest/3` lands at `/var/tiles/my-image.dzi`.
  """

  @behaviour Tessera.Storage

  @impl true
  def put(content_path, key, opts) do
    root = Keyword.fetch!(opts, :root)
    target = Path.join(root, key)

    with :ok <- File.mkdir_p(Path.dirname(target)),
         {:ok, _} <- File.copy(content_path, target) do
      :ok
    else
      {:error, reason} -> {:error, reason}
    end
  end
end
