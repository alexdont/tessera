defmodule Tessera.MixProject do
  use Mix.Project

  @version "0.1.0"
  @description "OpenSeadragon-backed deep zoom for Phoenix apps. Generate DZI tile pyramids from images via ImageMagick, render them with a LiveView component."
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
      {:phoenix_live_view, "~> 1.1"},
      {:phoenix_html, "~> 4.0"},
      {:ex_doc, "~> 0.39", only: :dev, runtime: false}
    ]
  end

  defp package do
    [
      name: "tessera",
      licenses: ["MIT"],
      links: %{"GitHub" => @source_url},
      files: ~w(lib priv mix.exs README.md)
    ]
  end

  defp docs do
    [
      name: "Tessera",
      source_ref: "v#{@version}",
      source_url: @source_url,
      main: "Tessera",
      extras: ["README.md"]
    ]
  end
end
