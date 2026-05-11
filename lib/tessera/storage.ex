defmodule Tessera.Storage do
  @moduledoc """
  Write-only storage abstraction for tile output.

  Tessera generates a tile (or manifest) into a temporary local file and
  hands it off to a storage adapter via `put/3`. The adapter is responsible
  for moving / copying / uploading the file to its permanent home. Tessera
  cleans up the temp file after `put/3` returns.

  ## Why write-only

  Reads, existence checks, and deletes are the consumer's job. Tessera
  never reads back what it wrote: it produces output, hands it off, and
  forgets. Caching, eviction, cleanup, and serving live entirely in the
  consumer (e.g., PhoenixKit's `FileController`).

  ## Default implementation

  `Tessera.Storage.Local` writes to a caller-supplied `:root` directory on
  the local filesystem. Used unless `opts[:storage]` says otherwise.

  ## Custom adapters

  Implement the behaviour and pass the module via `opts[:storage]`:

      defmodule MyApp.S3TileStorage do
        @behaviour Tessera.Storage

        def put(content_path, key, opts) do
          bucket = Keyword.fetch!(opts, :bucket)
          ExAws.S3.put_object(bucket, key, File.read!(content_path))
          |> ExAws.request()
          |> case do
            {:ok, _} -> :ok
            {:error, reason} -> {:error, reason}
          end
        end
      end

      Tessera.generate_tile(input, {1, 0, 0}, "my-image",
        image_width: 4032,
        image_height: 3024,
        storage: MyApp.S3TileStorage,
        storage_opts: [bucket: "my-tiles"]
      )
  """

  @doc """
  Persist a freshly-generated tile or manifest from `content_path` under
  the given relative `key` (e.g. `"my-image.dzi"` or
  `"my-image_files/3/0_0.jpg"`).

  Return `:ok` on success, `{:error, reason}` otherwise. The implementation
  may assume `content_path` exists and is readable.
  """
  @callback put(content_path :: Path.t(), key :: String.t(), opts :: keyword()) ::
              :ok | {:error, term()}
end
