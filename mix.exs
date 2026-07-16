defmodule Tessera.MixProject do
  use Mix.Project

  @version "0.3.3"
  @description "DZI deep-zoom + progressive-resolution layer for Fresco image viewers in Phoenix. Generate DZI tile pyramids from images via ImageMagick; render them as a Fresco peer layer that swaps raster resolutions on zoom and streams DZI tiles for deep zoom on gigapixel images."
  @source_url "https://github.com/alexdont/tessera"

  def project do
    [
      app: :tessera,
      version: @version,
      description: @description,
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      package: package(),
      docs: docs()
    ]
  end

  def application do
    [extra_applications: [:logger]]
  end

  defp deps do
    [
      {:fresco, "~> 0.5.9 or ~> 0.6.0 or ~> 0.7.0 or ~> 0.8.0 or ~> 0.9.0"},
      {:phoenix_live_view, "~> 1.1"},
      {:phoenix_html, "~> 4.0"},
      {:jason, "~> 1.4"},
      {:ex_doc, "~> 0.39", only: :dev, runtime: false}
    ]
  end

  defp package do
    [
      name: "tessera",
      maintainers: ["Alexander Don"],
      licenses: ["MIT"],
      links: %{"GitHub" => @source_url},
      files: ~w(lib priv mix.exs README.md LICENSE CHANGELOG.md)
    ]
  end

  defp docs do
    [
      name: "Tessera",
      source_ref: "v#{@version}",
      source_url: @source_url,
      main: "Tessera",
      extras: ["README.md", "CHANGELOG.md", "LICENSE"]
    ]
  end
end
