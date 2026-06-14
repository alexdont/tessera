// Tessera 0.3 — progressive-resolution + DZI deep-zoom layer for Fresco.
//
// Rewritten for Fresco's own viewer engine (Fresco 0.5 dropped
// OpenSeadragon for a CSS-transform engine; the OSD `viewport.getZoom()` /
// `tileSources` APIs Tessera 0.2 relied on are gone). Like Etcher, Tessera
// is now a *peer layer*: it grabs the Fresco handle via
// `window.Fresco.onReady`, reads the live transform, and contributes:
//
//   1. Progressive resolution swap — given an ordered `sources` ladder
//      (low → high), swap the Fresco image to a sharper raster as the user
//      zooms in (and back down on zoom-out), via the handle's
//      `swapSourcePreservingBounds` / `setImageSrc`. Hysteresis avoids
//      flicker at the boundaries; the viewport is preserved.
//
//   2. DZI tile streaming — when `data-dzi-url` is present and the user
//      zooms *past* the sharpest raster source (deep zoom on a gigapixel
//      image), lazily fetch the `.dzi` manifest and stream the visible
//      tiles at the matching pyramid level into an overlay aligned to the
//      Fresco transform. Tiles for unviewed regions never load; the overlay
//      hides again when the user zooms back out.
//
// Parent app wiring (fresco.js MUST load first so window.Fresco exists):
//   import "../../deps/fresco/priv/static/fresco.js"
//   import "../../deps/tessera/priv/static/tessera.js"
//   hooks: { ...window.FrescoHooks, ...window.TesseraHooks, ...colocatedHooks }

(function() {
  if (window.TesseraLoaded) return;
  window.TesseraLoaded = true;

  window.TesseraHooks = window.TesseraHooks || {};

  // ===========================================================================
  // Tuning
  // ===========================================================================

  // A raster source may be upscaled up to this factor past its 1:1 pixel
  // width before Tessera swaps to the next source up. A little upscaling is
  // invisible and saves a fetch.
  var UPGRADE_HEADROOM = 1.6;

  // Downgrade hysteresis: only fall back to a lower source once the displayed
  // width drops 15% below that source's upgrade point. Prevents flicker when
  // the user oscillates around a boundary.
  var DOWNGRADE_HYSTERESIS = 0.85;

  // Activate DZI tiles once the displayed full-image width exceeds the top
  // raster's pixel width by this factor (i.e. the sharpest raster is being
  // upscaled). Tiles deactivate below `top_width * this * hysteresis`.
  var TILE_ACTIVATE_HEADROOM = 1.25;

  // ===========================================================================
  // Helpers
  // ===========================================================================

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

  // Displayed width, in screen px, of the *whole* image at the current zoom.
  // This is the quantity we compare against each source's intrinsic width:
  // `scale × canvas-width`. Returns null when the handle can't report it
  // (e.g. a non-canvas viewer handle missing getCanvasSize/getTransform).
  function displayedFullWidth(handle) {
    if (typeof handle.getCanvasSize !== "function" ||
        typeof handle.getTransform !== "function") {
      return null;
    }
    var size = handle.getCanvasSize();
    var t = handle.getTransform();
    if (!size || !t || !size.width || !t.s) return null;
    return t.s * size.width;
  }

  // Pick the raster source index for a given displayed width `d`, walking up
  // when the current source is upscaled past headroom and down (with
  // hysteresis) when a lower source again suffices. `widths[i]` is source i's
  // intrinsic pixel width (Infinity if unknown → never a swap-up target).
  function pickRaster(cur, d, widths) {
    var n = widths.length;
    while (cur + 1 < n && d > widths[cur] * UPGRADE_HEADROOM) cur++;
    while (cur > 0 && d < widths[cur - 1] * UPGRADE_HEADROOM * DOWNGRADE_HYSTERESIS) cur--;
    return cur;
  }

  function swapRaster(handle, url) {
    if (typeof handle.swapSourcePreservingBounds === "function") {
      handle.swapSourcePreservingBounds(url);
    } else if (typeof handle.setImageSrc === "function" &&
               typeof handle.getImages === "function") {
      var imgs = handle.getImages();
      if (imgs && imgs.length) handle.setImageSrc(imgs[0].id, url);
    }
  }

  // Split a `.dzi` URL into the tiles base + preserved query string. DZI
  // convention: a manifest at `<path>/<name>.dzi` has its tiles under
  // `<path>/<name>_files/<level>/<col>_<row>.<format>`. Any query string
  // (e.g. a signed-URL token) is re-appended to each tile URL.
  function dziParts(dziUrl) {
    var query = "";
    var u = dziUrl;
    var qi = dziUrl.indexOf("?");
    if (qi !== -1) {
      query = dziUrl.substring(qi);
      u = dziUrl.substring(0, qi);
    }
    return { base: u.replace(/\.dzi$/i, "_files"), query: query };
  }

  function parseDziManifest(text) {
    var xml = new DOMParser().parseFromString(text, "application/xml");
    var image = xml.getElementsByTagName("Image")[0];
    var size = xml.getElementsByTagName("Size")[0];
    if (!image || !size) return null;

    var width = parseInt(size.getAttribute("Width"), 10);
    var height = parseInt(size.getAttribute("Height"), 10);
    var tileSize = parseInt(image.getAttribute("TileSize"), 10);
    var overlap = parseInt(image.getAttribute("Overlap"), 10);
    var format = image.getAttribute("Format") || "jpg";
    if (!width || !height || !tileSize) return null;

    return {
      width: width,
      height: height,
      tileSize: tileSize,
      overlap: isNaN(overlap) ? 0 : overlap,
      format: format,
      maxLevel: Math.ceil(Math.log2(Math.max(width, height)))
    };
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ===========================================================================
  // TesseraLayer hook
  // ===========================================================================

  window.TesseraHooks.TesseraLayer = {
    mounted: function() {
      var self = this;

      var sources = parseSources(self.el);
      if (!sources) {
        console.warn("[Tessera] Missing or invalid data-sources on", self.el);
        return;
      }

      var frescoId = self.el.dataset.frescoId;
      if (!frescoId) {
        console.warn("[Tessera] Missing data-fresco-id on", self.el);
        return;
      }

      if (!window.Fresco || typeof window.Fresco.onReady !== "function") {
        console.warn(
          "[Tessera] window.Fresco unavailable — import fresco.js before tessera.js"
        );
        return;
      }

      self.sources = sources;
      self.widths = sources.map(function(s) {
        return typeof s.width === "number" && s.width > 0 ? s.width : Infinity;
      });
      // The sharpest raster width — tiles activate past this. Falls back to the
      // largest finite width, else 0 (tiles can still activate via the manifest).
      self.topWidth = self.widths.reduce(function(acc, w) {
        return isFinite(w) ? Math.max(acc, w) : acc;
      }, 0);

      self.dziUrl = self.el.dataset.dziUrl || null;
      self.currentLayer = 0;
      self.swapDebounce = null;
      self.tilesActive = false;
      self.manifest = null;
      self.manifestPending = false;
      self.tiles = {};        // "level/col/row" -> <img>
      self.rafPending = false;
      self.unsubs = [];

      window.Fresco.onReady(frescoId, function(handle) {
        if (!self.el || !self.el.isConnected) return;
        self.handle = handle;
        self._init();
      });
    },

    _init: function() {
      var self = this;
      var handle = self.handle;

      // Initial raster pick so we don't wait for the first zoom event.
      self._evaluateRaster();

      // Raster swap: debounce zoom so the transient events fired right after
      // a source swap (re-fit at the new bitmap) don't re-trigger a swap.
      if (self.sources.length > 1) {
        self.unsubs.push(handle.on("zoom", function() {
          if (self.swapDebounce) clearTimeout(self.swapDebounce);
          self.swapDebounce = setTimeout(function() {
            self.swapDebounce = null;
            self._evaluateRaster();
          }, 180);
        }));
      }

      // DZI tile overlay: re-render aligned to the transform on every
      // animation frame Fresco writes, plus lifecycle moments.
      if (self.dziUrl) {
        var schedule = function() { self._scheduleRender(); };
        self.unsubs.push(handle.on("animation", schedule));
        self.unsubs.push(handle.on("pan", schedule));
        self.unsubs.push(handle.on("zoom", schedule));
        self.unsubs.push(handle.on("resize", schedule));
        self.unsubs.push(handle.on("open", schedule));
        self._scheduleRender();
      }
    },

    // ---- Progressive raster swap ------------------------------------------

    _evaluateRaster: function() {
      var self = this;
      if (!self.handle || self.sources.length < 2) return;

      var d = displayedFullWidth(self.handle);
      if (d == null) return;

      var next = pickRaster(self.currentLayer, d, self.widths);
      if (next !== self.currentLayer) {
        self.currentLayer = next;
        swapRaster(self.handle, self.sources[next].url);
      }
    },

    // ---- DZI tile overlay --------------------------------------------------

    _scheduleRender: function() {
      var self = this;
      if (self.rafPending) return;
      self.rafPending = true;
      requestAnimationFrame(function() {
        self.rafPending = false;
        self._renderTiles();
      });
    },

    _renderTiles: function() {
      var self = this;
      var handle = self.handle;
      if (!handle || !self.dziUrl) return;

      var d = displayedFullWidth(handle);
      if (d == null) return;

      // Activate/deactivate around the top raster width (with hysteresis).
      var on = self.topWidth > 0 ? d > self.topWidth * TILE_ACTIVATE_HEADROOM : true;
      var off = self.topWidth > 0
        ? d < self.topWidth * TILE_ACTIVATE_HEADROOM * DOWNGRADE_HYSTERESIS
        : false;

      if (!self.tilesActive && on) self.tilesActive = true;
      else if (self.tilesActive && off) self.tilesActive = false;

      if (!self.tilesActive) {
        self._clearTiles();
        return;
      }

      // Lazily fetch the manifest the first time we cross into tile range.
      if (!self.manifest) {
        self._ensureManifest();
        return; // re-renders once the manifest resolves
      }

      self._ensureOverlay();
      self._paint(d);
    },

    _ensureManifest: function() {
      var self = this;
      if (self.manifestPending || self.manifest) return;
      self.manifestPending = true;

      fetch(self.dziUrl, { credentials: "same-origin" })
        .then(function(r) { return r.ok ? r.text() : Promise.reject(r.status); })
        .then(function(text) {
          if (!self.handle) return;
          var m = parseDziManifest(text);
          if (!m) { console.warn("[Tessera] Unparseable DZI manifest", self.dziUrl); return; }
          self.manifest = m;
          self.manifestPending = false;
          self._scheduleRender();
        })
        .catch(function(err) {
          self.manifestPending = false;
          console.warn("[Tessera] Failed to load DZI manifest", self.dziUrl, err);
        });
    },

    _ensureOverlay: function() {
      var self = this;
      if (self.overlay) return;
      var container = self.handle.container;
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }
      var overlay = document.createElement("div");
      overlay.className = "tessera-overlay";
      overlay.style.position = "absolute";
      overlay.style.inset = "0";
      overlay.style.overflow = "hidden";
      // Passive: never intercept Fresco's pan/zoom gestures.
      overlay.style.pointerEvents = "none";
      container.appendChild(overlay);
      self.overlay = overlay;
    },

    _paint: function(d) {
      var self = this;
      var handle = self.handle;
      var m = self.manifest;

      var size = handle.getCanvasSize();
      var t = handle.getTransform();
      if (!size || !t) return;

      var canvasW = size.width;
      var fullToCanvas = canvasW / m.width;       // DZI full-px -> canvas-px
      var s = t.s;                                 // canvas-px -> screen-px

      // Choose the pyramid level whose width first covers the displayed width.
      var level = clamp(
        Math.ceil(m.maxLevel - Math.log2(m.width / d)),
        0,
        m.maxLevel
      );
      var levelScale = Math.pow(2, m.maxLevel - level); // full-px per level-px
      var levelW = Math.ceil(m.width / levelScale);
      var levelH = Math.ceil(m.height / levelScale);
      var levelToScreen = (1 / levelScale) * fullToCanvas * s; // level-px -> screen-px

      var cols = Math.ceil(levelW / m.tileSize);
      var rows = Math.ceil(levelH / m.tileSize);

      // Visible region in canvas-px -> level-px, to limit tiles to the viewport.
      // level-px = canvas-px * (full/canvas) / levelScale.
      var canvasToLevelPx = (m.width / canvasW) / levelScale;
      var vb = handle.getViewportBounds();        // canvas-px {x,y,width,height}
      var vx0 = vb ? vb.x * canvasToLevelPx : 0;
      var vy0 = vb ? vb.y * canvasToLevelPx : 0;
      var vx1 = vb ? (vb.x + vb.width) * canvasToLevelPx : levelW;
      var vy1 = vb ? (vb.y + vb.height) * canvasToLevelPx : levelH;

      var colStart = clamp(Math.floor(vx0 / m.tileSize), 0, cols - 1);
      var colEnd = clamp(Math.floor(vx1 / m.tileSize), 0, cols - 1);
      var rowStart = clamp(Math.floor(vy0 / m.tileSize), 0, rows - 1);
      var rowEnd = clamp(Math.floor(vy1 / m.tileSize), 0, rows - 1);

      var parts = self._dziParts || (self._dziParts = dziParts(self.dziUrl));
      var keep = {};

      for (var col = colStart; col <= colEnd; col++) {
        for (var row = rowStart; row <= rowEnd; row++) {
          var key = level + "/" + col + "/" + row;
          keep[key] = true;

          // Tile geometry in level-px, including DZI edge overlap.
          var tileX = col * m.tileSize;
          var tileY = row * m.tileSize;
          var olLeft = col === 0 ? 0 : m.overlap;
          var olTop = row === 0 ? 0 : m.overlap;
          var olRight = tileX + m.tileSize >= levelW ? 0 : m.overlap;
          var olBottom = tileY + m.tileSize >= levelH ? 0 : m.overlap;
          var natW = olLeft + Math.min(m.tileSize, levelW - tileX) + olRight;
          var natH = olTop + Math.min(m.tileSize, levelH - tileY) + olBottom;

          // Top-left of the tile image (incl overlap) -> canvas-px -> screen-px.
          var originCanvas = {
            x: (tileX - olLeft) * levelScale * fullToCanvas,
            y: (tileY - olTop) * levelScale * fullToCanvas
          };
          var screen = handle.imageToScreen(originCanvas);

          var img = self.tiles[key];
          if (!img) {
            img = document.createElement("img");
            img.decoding = "async";
            img.draggable = false;
            img.style.position = "absolute";
            img.style.transformOrigin = "top left";
            img.style.pointerEvents = "none";
            img.style.userSelect = "none";
            img.src = parts.base + "/" + level + "/" + col + "_" + row + "." + m.format + parts.query;
            self.overlay.appendChild(img);
            self.tiles[key] = img;
          }

          img.style.left = screen.x + "px";
          img.style.top = screen.y + "px";
          img.style.width = (natW * levelToScreen) + "px";
          img.style.height = (natH * levelToScreen) + "px";
        }
      }

      // Drop tiles that are no longer visible / not at the current level.
      for (var k in self.tiles) {
        if (!keep[k]) {
          var stale = self.tiles[k];
          if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
          delete self.tiles[k];
        }
      }
    },

    _clearTiles: function() {
      var self = this;
      for (var k in self.tiles) {
        var img = self.tiles[k];
        if (img && img.parentNode) img.parentNode.removeChild(img);
      }
      self.tiles = {};
    },

    destroyed: function() {
      var self = this;
      if (self.swapDebounce) { clearTimeout(self.swapDebounce); self.swapDebounce = null; }
      (self.unsubs || []).forEach(function(fn) {
        if (typeof fn === "function") { try { fn(); } catch (_) {} }
      });
      self.unsubs = [];
      self._clearTiles();
      if (self.overlay && self.overlay.parentNode) {
        self.overlay.parentNode.removeChild(self.overlay);
      }
      self.overlay = null;
      self.handle = null;
    }
  };
})();
