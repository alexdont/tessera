// Tessera — LiveView hook that mounts OpenSeadragon on an image source.
//
// Lazy-loads OpenSeadragon from jsDelivr on first use, then initializes a
// viewer per element bearing `phx-hook="TesseraViewer"`. The element's
// `data-src` attribute is the source URL: a `.dzi` manifest for deep zoom,
// or a plain image (`.jpg`, `.png`, etc.) for basic pan + zoom.
//
// We disable OSD's built-in navigation controls (which ship as PNG sprites)
// and render our own Heroicons-based overlay instead — looks better against
// arbitrary image content and avoids the prefixUrl/CDN dance.
//
// Parent app wiring:
//   import "../../deps/tessera/priv/static/tessera.js"
//   hooks: { ...window.TesseraHooks, ...colocatedHooks }

(function() {
  if (window.TesseraLoaded) return;
  window.TesseraLoaded = true;

  window.TesseraHooks = window.TesseraHooks || {};

  var OSD_VERSION = "4.1.0";
  var OSD_CDN = "https://cdn.jsdelivr.net/npm/openseadragon@" + OSD_VERSION + "/build/openseadragon/openseadragon.min.js";
  var loading = false;
  var callbacks = [];

  function loadOSD(callback) {
    if (window.OpenSeadragon) {
      callback();
      return;
    }

    callbacks.push(callback);

    if (loading) return;
    loading = true;

    var script = document.createElement("script");
    script.src = OSD_CDN;
    script.onload = function() {
      callbacks.forEach(function(cb) { cb(); });
      callbacks = [];
    };
    script.onerror = function() {
      console.error("[Tessera] Failed to load OpenSeadragon from CDN");
    };
    document.head.appendChild(script);
  }

  // ---------------------------------------------------------------------------
  // Heroicons (outline, 24×24, stroke="currentColor")
  // ---------------------------------------------------------------------------

  var ICONS = {
    zoomIn: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM10.5 7.5v6m3-3h-6"/></svg>',
    zoomOut: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607ZM13.5 10.5h-6"/></svg>',
    reset:   '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>',
    expand:  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/></svg>'
  };

  // ---------------------------------------------------------------------------
  // Toolbar styles (injected once per page)
  // ---------------------------------------------------------------------------

  var stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var css = [
      ".tessera-nav {",
      "  position: absolute; top: 12px; left: 12px; z-index: 10;",
      "  display: flex; flex-direction: column; gap: 6px;",
      "  pointer-events: auto;",
      "}",
      ".tessera-nav button {",
      "  width: 36px; height: 36px;",
      "  display: inline-flex; align-items: center; justify-content: center;",
      "  border: none; padding: 0; cursor: pointer;",
      "  background: rgba(0, 0, 0, 0.55); color: #fff;",
      "  border-radius: 8px;",
      "  transition: background 120ms ease;",
      "}",
      ".tessera-nav button:hover { background: rgba(0, 0, 0, 0.78); }",
      ".tessera-nav button:focus-visible {",
      "  outline: 2px solid rgba(255, 255, 255, 0.7); outline-offset: 1px;",
      "}",
      ".tessera-nav svg { width: 18px; height: 18px; }"
    ].join("\n");

    var style = document.createElement("style");
    style.setAttribute("data-tessera", "");
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Toolbar construction
  // ---------------------------------------------------------------------------

  function makeButton(svg, title, onClick) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.title = title;
    btn.setAttribute("aria-label", title);
    btn.innerHTML = svg;
    btn.addEventListener("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  function buildNav(viewer, container) {
    injectStyles();

    var nav = document.createElement("div");
    nav.className = "tessera-nav";

    var zoomFactor = 1.4;

    nav.appendChild(makeButton(ICONS.zoomIn, "Zoom in", function() {
      viewer.viewport.zoomBy(zoomFactor);
      viewer.viewport.applyConstraints();
    }));

    nav.appendChild(makeButton(ICONS.zoomOut, "Zoom out", function() {
      viewer.viewport.zoomBy(1 / zoomFactor);
      viewer.viewport.applyConstraints();
    }));

    nav.appendChild(makeButton(ICONS.reset, "Reset view", function() {
      viewer.viewport.goHome();
    }));

    nav.appendChild(makeButton(ICONS.expand, "Toggle fullscreen", function() {
      viewer.setFullPage(!viewer.isFullPage());
    }));

    // The OSD root needs `position: relative` so our absolute nav is positioned
    // against the viewer (not whatever ancestor happens to be relative).
    if (getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.appendChild(nav);

    return nav;
  }

  // ---------------------------------------------------------------------------
  // Source-type detection (DZI vs plain image)
  // ---------------------------------------------------------------------------

  function isDziUrl(url) {
    if (!url) return false;
    var qIdx = url.indexOf("?");
    var path = qIdx === -1 ? url : url.substring(0, qIdx);
    return path.toLowerCase().endsWith(".dzi");
  }

  function tileSourceFor(url) {
    if (isDziUrl(url)) return url;
    return { type: "image", url: url };
  }

  // Swap an open OSD viewer's tile source while preserving where the
  // user was zoomed/panned. open() resets to home by default; we capture
  // the current bounds and restore them on the new source's open event
  // without animation, so visually it's just the image getting sharper
  // (or fuzzier) — no jump back to fit-to-view.
  function swapSourcePreservingBounds(viewer, url) {
    var keepBounds = viewer.viewport.getBounds();
    viewer.addOnceHandler("open", function() {
      try { viewer.viewport.fitBounds(keepBounds, true); } catch (_) {}
    });
    try { viewer.open(tileSourceFor(url)); } catch (_) { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Hook
  // ---------------------------------------------------------------------------

  // Multiplier on each non-DZI layer's strict 1:1 zoom point. A small
  // amount of upscaling is invisible; this gives every layer a 2× zoom
  // budget past its strict threshold before we swap up.
  var UPGRADE_HEADROOM = 2.0;

  // Downgrade hysteresis: only fall back to a lower layer when zoom is
  // 15% below the previous layer's upgrade threshold. Prevents flicker
  // when the user oscillates around a boundary.
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

  // For each source, the zoom ratio (over home zoom) at which the layer
  // should swap to the next one up. DZI / unknown-width sources get
  // Infinity — they always count as the top layer.
  function computeThresholds(sources, containerWidth) {
    if (!containerWidth || containerWidth <= 0) {
      return sources.map(function() { return Infinity; });
    }
    return sources.map(function(source) {
      if (!source.width || isDziUrl(source.url)) return Infinity;
      return (source.width / containerWidth) * UPGRADE_HEADROOM;
    });
  }

  // Pick which layer index is appropriate for the current zoom ratio,
  // applying hysteresis around the boundary between `currentLayer` and
  // `currentLayer - 1`. Returns an index in [0, sources.length).
  function pickLayer(currentLayer, ratio, thresholds) {
    var next = currentLayer;

    // Upgrade as far as needed (handles fast zooms that skip multiple layers).
    while (next + 1 < thresholds.length && ratio > thresholds[next]) {
      next += 1;
    }

    // Downgrade with hysteresis. Don't downgrade past 0.
    while (next > 0 && ratio < thresholds[next - 1] * DOWNGRADE_HYSTERESIS) {
      next -= 1;
    }

    return next;
  }

  window.TesseraHooks.TesseraViewer = {
    mounted: function() {
      var self = this;
      loadOSD(function() {
        // Element may be gone (modal closed, navigation) before OSD loads.
        if (!self.el.isConnected) return;

        var sources = parseSources(self.el);
        if (!sources) {
          console.warn("[Tessera] Missing or invalid data-sources on element", self.el);
          return;
        }

        self.sources = sources;
        self.currentLayer = 0;
        self.thresholds = computeThresholds(sources, self.el.clientWidth);
        self.swapDebounce = null;

        self.viewer = window.OpenSeadragon({
          element: self.el,
          tileSources: tileSourceFor(sources[0].url),
          // Built-in PNG sprite nav is replaced by our heroicon overlay.
          showNavigationControl: false,
          // Default 1.1 barely lets you zoom past 100% of native resolution.
          // 8x is enough headroom for inspecting detail in plain-image mode
          // (DZI is naturally capped by its tile pyramid's max level).
          maxZoomPixelRatio: 8,
          // Snappier feel: tighten the spring + cut tween duration. Default
          // (1.2s / 6.5) feels like slow-motion drift; these values track
          // user input more directly without going fully instant.
          animationTime: 0.3,
          springStiffness: 10,
          // Keep the image fully clamped to the viewer rectangle. OSD's
          // defaults (visibilityRatio 0.5, constrainDuringPan false) let
          // the user drag the image until only half of it is on-screen
          // and only snap back on release — felt loose and floaty.
          // 1.0 + true together pin the image's edges to the viewport edges
          // when zoomed out, and pin the viewport inside the image bounds
          // when zoomed in. Either way, no empty space drift.
          visibilityRatio: 1.0,
          constrainDuringPan: true,
          gestureSettingsTouch: { pinchToZoom: true, dragToPan: true },
          gestureSettingsMouse: { scrollToZoom: true, dragToPan: true, clickToZoom: true, dblClickToZoom: true }
        });

        self.nav = buildNav(self.viewer, self.el);

        // Recompute thresholds when the container resizes (modal fullscreen
        // toggle, browser window resize). Layers themselves don't change —
        // just the zoom ratios at which we swap between them.
        if (typeof ResizeObserver === "function") {
          self.resizeObserver = new ResizeObserver(function() {
            self.thresholds = computeThresholds(self.sources, self.el.clientWidth);
          });
          self.resizeObserver.observe(self.el);
        }

        // Multi-layer progressive zoom. As the user zooms, swap to whichever
        // layer's native resolution best matches the viewport's current
        // rendered pixel density. Each layer covers a zoom band:
        //
        //   layer 0 (lowest quality) | up to thresholds[0]
        //   layer 1                  | thresholds[0] .. thresholds[1]
        //   ...
        //   layer N-1 (top, usually  | thresholds[N-2] .. ∞
        //              a DZI source)
        //
        // The decision is debounced 200ms after the last zoom event.
        // viewer.open() fires transient zoom events at the new source's
        // home zoom before fitBounds restores the user's position; the
        // debounce lets the viewport settle so those transients don't
        // re-trigger a swap.
        //
        // Viewport bounds are preserved across each swap so the user
        // never sees a jump to home.
        if (sources.length > 1) {
          self.viewer.addHandler("zoom", function() {
            if (self.swapDebounce) clearTimeout(self.swapDebounce);
            self.swapDebounce = setTimeout(function() {
              self.swapDebounce = null;
              if (!self.viewer || !self.viewer.viewport) return;

              var currentZoom = self.viewer.viewport.getZoom();
              var homeZoom = self.viewer.viewport.getHomeZoom();
              var ratio = currentZoom / homeZoom;

              var nextLayer = pickLayer(self.currentLayer, ratio, self.thresholds);
              if (nextLayer !== self.currentLayer) {
                self.currentLayer = nextLayer;
                swapSourcePreservingBounds(self.viewer, self.sources[nextLayer].url);
              }
            }, 200);
          });
        }
      });
    },

    destroyed: function() {
      if (this.swapDebounce) {
        clearTimeout(this.swapDebounce);
        this.swapDebounce = null;
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect();
        this.resizeObserver = null;
      }
      if (this.nav && this.nav.parentNode) {
        this.nav.parentNode.removeChild(this.nav);
      }
      this.nav = null;
      if (this.viewer) {
        try { this.viewer.destroy(); } catch (e) { /* ignore */ }
        this.viewer = null;
      }
    }
  };
})();
