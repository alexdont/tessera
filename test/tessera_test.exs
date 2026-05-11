defmodule TesseraTest do
  use ExUnit.Case
  doctest Tessera

  describe "generate/3" do
    test "errors when input file does not exist" do
      output_dir =
        Path.join(System.tmp_dir!(), "tessera-test-#{System.unique_integer([:positive])}")

      on_exit(fn -> File.rm_rf!(output_dir) end)

      assert {:error, :invalid_input} =
               Tessera.generate("/nonexistent/path.jpg", output_dir)
    end
  end
end
