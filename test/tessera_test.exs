defmodule TesseraTest do
  use ExUnit.Case
  doctest Tessera

  import Phoenix.LiveViewTest

  describe "generate/3" do
    test "errors when input file does not exist" do
      output_dir =
        Path.join(System.tmp_dir!(), "tessera-test-#{System.unique_integer([:positive])}")

      on_exit(fn -> File.rm_rf!(output_dir) end)

      assert {:error, :invalid_input} =
               Tessera.generate("/nonexistent/path.jpg", output_dir)
    end
  end

  describe "generate_manifest/3 with Tessera.Storage.Local" do
    setup do
      root =
        Path.join(System.tmp_dir!(), "tessera-manifest-#{System.unique_integer([:positive])}")

      on_exit(fn -> File.rm_rf!(root) end)
      {:ok, root: root}
    end

    test "writes a valid DZI manifest", %{root: root} do
      assert :ok =
               Tessera.generate_manifest({4032, 3024}, "test-image",
                 storage: Tessera.Storage.Local,
                 storage_opts: [root: root]
               )

      manifest_path = Path.join(root, "test-image.dzi")
      assert File.exists?(manifest_path)

      content = File.read!(manifest_path)
      assert content =~ ~s(Width="4032")
      assert content =~ ~s(Height="3024")
      assert content =~ ~s(TileSize="256")
      assert content =~ ~s(Overlap="1")
      assert content =~ ~s(Format="jpg")
    end

    test "creates intermediate directories from base_name with slashes", %{root: root} do
      assert :ok =
               Tessera.generate_manifest({100, 100}, "abc/abc",
                 storage: Tessera.Storage.Local,
                 storage_opts: [root: root]
               )

      assert File.exists?(Path.join([root, "abc", "abc.dzi"]))
    end

    test "honors :tile_size and :format options", %{root: root} do
      assert :ok =
               Tessera.generate_manifest({100, 100}, "custom",
                 tile_size: 512,
                 format: :png,
                 storage: Tessera.Storage.Local,
                 storage_opts: [root: root]
               )

      content = File.read!(Path.join(root, "custom.dzi"))
      assert content =~ ~s(TileSize="512")
      assert content =~ ~s(Format="png")
    end
  end

  describe "generate_tile/4 input validation" do
    test "errors when input file does not exist" do
      assert {:error, :invalid_input} =
               Tessera.generate_tile("/nonexistent.jpg", {0, 0, 0}, "x",
                 image_width: 100,
                 image_height: 100
               )
    end

    test "errors when image dimensions are not supplied" do
      # Need a real file to get past `ensure_input`
      tmp = Path.join(System.tmp_dir!(), "tessera-noop-#{System.unique_integer([:positive])}.jpg")
      File.write!(tmp, "not actually a jpeg")
      on_exit(fn -> File.rm(tmp) end)

      assert {:error, :missing_image_dims} =
               Tessera.generate_tile(tmp, {0, 0, 0}, "x", [])
    end
  end

  describe "Tessera.layer/1" do
    test "renders a hidden host element with the TesseraLayer hook + data-fresco-id + JSON sources" do
      html =
        render_component(&Tessera.layer/1,
          fresco_id: "photo",
          sources: [
            %{url: "/medium.jpg", width: 1024},
            %{url: "/dzi/photo.dzi"}
          ]
        )

      assert html =~ ~s(phx-hook="TesseraLayer")
      assert html =~ ~s(data-fresco-id="photo")
      assert html =~ ~s(id="tessera-layer-photo")
      # Sources JSON is HTML-encoded; verify the substrings are present.
      assert html =~ "/medium.jpg"
      assert html =~ "1024"
      assert html =~ "/dzi/photo.dzi"
      # Visually hidden — it's a hook host, not user-visible UI.
      assert html =~ "hidden"
    end

    test "honors a custom :id" do
      html =
        render_component(&Tessera.layer/1,
          fresco_id: "x",
          id: "my-layer",
          sources: [%{url: "/a.jpg"}]
        )

      assert html =~ ~s(id="my-layer")
    end

    test "renders data-dzi-url when a dzi_url is given" do
      html =
        render_component(&Tessera.layer/1,
          fresco_id: "photo",
          sources: [%{url: "/medium.jpg", width: 1024}],
          dzi_url: "/tiles/abc/photo.dzi"
        )

      assert html =~ ~s(data-dzi-url="/tiles/abc/photo.dzi")
    end

    test "omits data-dzi-url when no dzi_url is given" do
      html =
        render_component(&Tessera.layer/1,
          fresco_id: "photo",
          sources: [%{url: "/medium.jpg", width: 1024}]
        )

      refute html =~ "data-dzi-url"
    end

    test "renders data-debug when debug is enabled, omits it otherwise" do
      on =
        render_component(&Tessera.layer/1,
          fresco_id: "photo",
          sources: [%{url: "/medium.jpg", width: 1024}],
          debug: true
        )

      assert on =~ "data-debug"

      off =
        render_component(&Tessera.layer/1,
          fresco_id: "photo",
          sources: [%{url: "/medium.jpg", width: 1024}]
        )

      refute off =~ "data-debug"
    end
  end
end
