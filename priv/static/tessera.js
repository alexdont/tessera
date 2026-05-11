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

  // ---------------------------------------------------------------------------
  // Hook
  // ---------------------------------------------------------------------------

  window.TesseraHooks.TesseraViewer = {
    mounted: function() {
      var self = this;
      loadOSD(function() {
        // Element may be gone (modal closed, navigation) before OSD loads.
        if (!self.el.isConnected) return;

        var src = self.el.dataset.src;
        if (!src) {
          console.warn("[Tessera] Missing data-src on element", self.el);
          return;
        }

        self.currentSrc = src;
        self.viewer = window.OpenSeadragon({
          element: self.el,
          tileSources: tileSourceFor(src),
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

        // Optional progressive-quality swap. When `data-upgrade-src` is
        // present and different from the initial src, leave it parked
        // until the user actually zooms in past the home zoom level, then
        // call viewer.open() once to switch to the higher-quality source.
        var upgradeSrc = self.el.dataset.upgradeSrc;
        if (upgradeSrc && upgradeSrc !== src) {
          self.upgraded = false;
          self.viewer.addHandler("zoom", function(e) {
            if (self.upgraded) return;
            var homeZoom = self.viewer.viewport.getHomeZoom();
            // Wait for a clearly intentional zoom (2x the fit-to-view
            // level) before triggering the swap. A small wheel nudge or
            // layout-driven zoom jitter won't fire it.
            if (e.zoom > homeZoom * 2) {
              self.upgraded = true;
              self.currentSrc = upgradeSrc;

              // Preserve where the user was zoomed into. open() resets the
              // viewport to home by default; capture the current bounds and
              // restore them as soon as the new source is open, without
              // animation so there's no visible jump back to home.
              var keepBounds = self.viewer.viewport.getBounds();
              self.viewer.addOnceHandler("open", function() {
                try { self.viewer.viewport.fitBounds(keepBounds, true); } catch (_) {}
              });

              try { self.viewer.open(tileSourceFor(upgradeSrc)); } catch (_) { /* ignore */ }
            }
          });
        }
      });
    },

    updated: function() {
      // When the src assign changes, swap the source instead of re-creating
      // the whole viewer. OSD's open() handles both DZI and simple-image inputs.
      if (!this.viewer) return;
      var newSrc = this.el.dataset.src;
      if (newSrc && newSrc !== this.currentSrc) {
        this.currentSrc = newSrc;
        try { this.viewer.open(tileSourceFor(newSrc)); } catch (e) { /* ignore */ }
      }
    },

    destroyed: function() {
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
