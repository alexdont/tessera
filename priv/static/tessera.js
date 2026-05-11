// Tessera — LiveView hook that mounts OpenSeadragon on an image source.
//
// Lazy-loads OpenSeadragon from jsDelivr on first use, then initializes a
// viewer per element bearing `phx-hook="TesseraViewer"`. The element's
// `data-src` attribute is the source URL: a `.dzi` manifest for deep zoom,
// or a plain image (`.jpg`, `.png`, etc.) for basic pan + zoom.
//
// Parent app wiring:
//   import "../../deps/tessera/priv/static/tessera.js"
//   hooks: { ...window.TesseraHooks, ...colocatedHooks }

(function() {
  if (window.TesseraLoaded) return;
  window.TesseraLoaded = true;

  window.TesseraHooks = window.TesseraHooks || {};

  var OSD_CDN = "https://cdn.jsdelivr.net/npm/openseadragon@4.1.0/build/openseadragon/openseadragon.min.js";
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

  // Detect whether a URL points at a DZI manifest. We look at the path only —
  // a query string (e.g. signed-URL tokens) shouldn't fool the check.
  function isDziUrl(url) {
    if (!url) return false;
    var qIdx = url.indexOf("?");
    var path = qIdx === -1 ? url : url.substring(0, qIdx);
    return path.toLowerCase().endsWith(".dzi");
  }

  // OSD takes either a string (DZI manifest URL) or an object
  // (simple-image source for plain `.jpg` / `.png` / etc.).
  function tileSourceFor(url) {
    if (isDziUrl(url)) return url;
    return { type: "image", url: url };
  }

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
          showNavigationControl: true,
          gestureSettingsTouch: { pinchToZoom: true, dragToPan: true },
          gestureSettingsMouse: { scrollToZoom: true, dragToPan: true, clickToZoom: true, dblClickToZoom: true }
        });
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
      if (this.viewer) {
        try { this.viewer.destroy(); } catch (e) { /* ignore */ }
        this.viewer = null;
      }
    }
  };
})();
