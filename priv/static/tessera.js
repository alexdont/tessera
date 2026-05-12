// Tessera 0.2 — DZI source provider + multi-layer progressive-zoom layer.
//
// Attaches to a Fresco viewer by DOM id. Fresco owns the OpenSeadragon
// instance, the nav overlay, animations, viewport clamping; Tessera
// contributes:
//
//   1. A DZI source provider registered with Fresco so any URL ending in
//      `.dzi` is treated as a tile pyramid (OSD accepts a DZI URL
//      directly as `tileSources`).
//
//   2. The `TesseraLayer` LiveView hook, attached to hidden host divs
//      rendered by `<Tessera.layer fresco_id sources>`. The hook listens
//      to the Fresco viewer's zoom events and swaps between an ordered
//      `sources` list as the user zooms past each layer's threshold,
//      preserving the viewport across each swap.
//
// Parent app wiring:
//   // fresco.js MUST be imported first so window.Fresco exists when
//   // tessera.js's source provider tries to register.
//   import "../../deps/fresco/priv/static/fresco.js"
//   import "../../deps/tessera/priv/static/tessera.js"
//   hooks: { ...window.FrescoHooks, ...window.TesseraHooks, ...colocatedHooks }

(function() {
  if (window.TesseraLoaded) return;
  window.TesseraLoaded = true;

  window.TesseraHooks = window.TesseraHooks || {};

  // ===========================================================================
  // DZI source provider
  // ===========================================================================

  // Detect whether a URL points at a DZI manifest. Look at the path only —
  // a query string (e.g. signed-URL tokens) shouldn't fool the check.
  function isDziUrl(url) {
    if (!url) return false;
    var qIdx = url.indexOf("?");
    var path = qIdx === -1 ? url : url.substring(0, qIdx);
    return path.toLowerCase().endsWith(".dzi");
  }

  // OSD accepts a DZI manifest URL directly as `tileSources` — the source
  // factory just returns the URL unchanged.
  function dziSourceFactory(url) {
    return url;
  }

  // Register the DZI provider with Fresco. Fresco might load before or after
  // us depending on import order, so try immediately and fall back to a
  // short poll.
  function registerDziProvider() {
    if (window.Fresco && typeof window.Fresco.registerSourceProvider === "function") {
      window.Fresco.registerSourceProvider(isDziUrl, dziSourceFactory);
      return true;
    }
    return false;
  }

  if (!registerDziProvider()) {
    var attempts = 0;
    var retry = setInterval(function() {
      attempts++;
      if (registerDziProvider() || attempts > 50) clearInterval(retry);
    }, 50);
  }

  // ===========================================================================
  // Multi-layer progressive-zoom logic
  // ===========================================================================

  // Multiplier on each non-DZI layer's strict 1:1 zoom point. A small amount
  // of upscaling is invisible; this gives every layer a 2× zoom budget past
  // its strict threshold before we swap up.
  var UPGRADE_HEADROOM = 2.0;

  // Downgrade hysteresis: only fall back to a lower layer when zoom is 15%
  // below the previous layer's upgrade threshold. Prevents flicker when the
  // user oscillates around a boundary.
  var DOWNGRADE_HYSTERESIS = 0.85;

  function parseSources(el) {
    var raw = el.dataset.sources;
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (_) {
      console.warn("[Tessera] Failed to parse data-sources", raw);
    }
    return null;
  }

  function computeThresholds(sources, containerWidth) {
    if (!containerWidth || containerWidth <= 0) {
      return sources.map(function() { return Infinity; });
    }
    return sources.map(function(source) {
      if (!source.width || isDziUrl(source.url)) return Infinity;
      return (source.width / containerWidth) * UPGRADE_HEADROOM;
    });
  }

  function pickLayer(currentLayer, ratio, thresholds) {
    var next = currentLayer;

    while (next + 1 < thresholds.length && ratio > thresholds[next]) {
      next += 1;
    }

    while (next > 0 && ratio < thresholds[next - 1] * DOWNGRADE_HYSTERESIS) {
      next -= 1;
    }

    return next;
  }

  // ===========================================================================
  // TesseraLayer hook
  // ===========================================================================

  window.TesseraHooks.TesseraLayer = {
    mounted: function() {
      var self = this;

      var sources = parseSources(self.el);
      if (!sources) {
        console.warn("[Tessera] Missing or invalid data-sources on element", self.el);
        return;
      }

      var frescoId = self.el.dataset.frescoId;
      if (!frescoId) {
        console.warn("[Tessera] Missing data-fresco-id on element", self.el);
        return;
      }

      if (!window.Fresco || typeof window.Fresco.onViewerReady !== "function") {
        console.warn(
          "[Tessera] window.Fresco unavailable — make sure fresco.js is imported before tessera.js"
        );
        return;
      }

      self.sources = sources;
      self.currentLayer = 0;
      self.swapDebounce = null;

      window.Fresco.onViewerReady(frescoId, function(handle) {
        if (!self.el || !self.el.isConnected) return;

        self.handle = handle;
        self.thresholds = computeThresholds(sources, handle.container.clientWidth);

        if (sources.length > 1) {
          // Debounce zoom decisions 200ms after the last event. Calling
          // viewer.open() fires transient zoom events at the new source's
          // home zoom before our viewport restore kicks in; the debounce
          // lets the viewport settle so those transients don't re-trigger
          // a swap.
          self.unsubZoom = handle.on("zoom", function() {
            if (self.swapDebounce) clearTimeout(self.swapDebounce);
            self.swapDebounce = setTimeout(function() {
              self.swapDebounce = null;
              if (!self.handle) return;

              var v = self.handle.viewer;
              if (!v || !v.viewport) return;

              var currentZoom = v.viewport.getZoom();
              var homeZoom = v.viewport.getHomeZoom();
              var ratio = currentZoom / homeZoom;

              var nextLayer = pickLayer(self.currentLayer, ratio, self.thresholds);
              if (nextLayer !== self.currentLayer) {
                self.currentLayer = nextLayer;
                self.handle.swapSourcePreservingBounds(self.sources[nextLayer].url);
              }
            }, 200);
          });
        }

        // Recompute thresholds on container resize (fullscreen toggle,
        // window resize). Layers themselves don't change — just the zoom
        // ratios at which we swap between them.
        if (typeof ResizeObserver === "function") {
          self.resizeObserver = new ResizeObserver(function() {
            if (!self.handle) return;
            self.thresholds = computeThresholds(self.sources, self.handle.container.clientWidth);
          });
          self.resizeObserver.observe(handle.container);
        }
      });
    },

    destroyed: function() {
      if (this.swapDebounce) {
        clearTimeout(this.swapDebounce);
        this.swapDebounce = null;
      }
      if (typeof this.unsubZoom === "function") {
        this.unsubZoom();
        this.unsubZoom = null;
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      this.handle = null;
    }
  };
})();
