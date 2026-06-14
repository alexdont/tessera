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

  // Runtime debug toggle: works in any environment without recompiling.
  // Either set `window.tesseraDebug = true` (instant, before reload) or
  // `localStorage.tesseraDebug = "1"` then reload.
  function tesseraDebugFlag() {
    try {
      if (window.tesseraDebug === true) return true;
      return !!(window.localStorage && localStorage.getItem("tesseraDebug") === "1");
    } catch (_) {
      return false;
    }
  }

  // Short human label for a raster source: file name (sans query) + width.
  function sourceLabel(src) {
    if (!src || !src.url) return "?";
    var u = src.url.split("?")[0];
    var name = u.substring(u.lastIndexOf("/") + 1) || u;
    return name + (src.width ? " (" + src.width + "px)" : "");
  }

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
      self.attrDebug = self.el.dataset.debug != null;
      self.debug = self.attrDebug || tesseraDebugFlag();
      // One-line mount marker so you can confirm in the console that this
      // (0.3) build is actually running and whether debug + DZI are active.
      console.log(
        "[Tessera] 0.3 layer mounted — debug:", self.debug,
        "dzi:", !!self.dziUrl,
        "sources:", self.widths,
        "(toggle HUD: localStorage.tesseraDebug='1' or window.tesseraDebug=true, then pan/zoom)"
      );
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

      // Subscribe to the transform events that drive the DZI overlay and the
      // debug HUD. Always subscribed (the per-frame work no-ops when there's
      // no DZI and debug is off) so the HUD can be toggled live at runtime
      // without a reload — it appears on the next pan/zoom.
      var schedule = function() { self._scheduleRender(); };
      self.unsubs.push(handle.on("animation", schedule));
      self.unsubs.push(handle.on("pan", schedule));
      self.unsubs.push(handle.on("zoom", schedule));
      self.unsubs.push(handle.on("resize", schedule));
      self.unsubs.push(handle.on("open", schedule));
      self._scheduleRender();
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
        // Re-read the flag each frame so the HUD can be toggled at runtime.
        self.debug = self.attrDebug || tesseraDebugFlag();
        if (self.dziUrl) self._renderTiles();
        if (self.debug) self._updateHud();
        else self._removeHud();
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

      // Map the DZI pyramid onto the image's ACTUAL canvas-px rect (position +
      // size), per axis. Anchoring to the real image bounds — rather than
      // assuming the image fills getCanvasSize() from the origin, and rather
      // than reusing one width-based ratio for both axes — keeps tiles glued to
      // the image even when the canvas is larger than the image or the variant
      // aspect ratio differs slightly from the DZI's by rounding.
      var imgs = typeof handle.getImages === "function" ? handle.getImages() : null;
      var rect =
        imgs && imgs.length
          ? imgs[0]
          : { x: 0, y: 0, width: size.width, height: size.height };

      // Choose the pyramid level whose width first covers the displayed width.
      var level = clamp(
        Math.ceil(m.maxLevel - Math.log2(m.width / d)),
        0,
        m.maxLevel
      );
      var levelScale = Math.pow(2, m.maxLevel - level); // full-px per level-px
      var levelW = Math.ceil(m.width / levelScale);
      var levelH = Math.ceil(m.height / levelScale);
      // level-px -> canvas-px, per axis (the space imageToScreen consumes).
      var levelToCanvasX = levelScale * (rect.width / m.width);
      var levelToCanvasY = levelScale * (rect.height / m.height);

      var cols = Math.ceil(levelW / m.tileSize);
      var rows = Math.ceil(levelH / m.tileSize);

      // Visible region (canvas-px) -> level-px, to limit tiles to the viewport.
      var vb = handle.getViewportBounds();        // canvas-px {x,y,width,height}
      var vx0 = vb ? (vb.x - rect.x) / levelToCanvasX : 0;
      var vy0 = vb ? (vb.y - rect.y) / levelToCanvasY : 0;
      var vx1 = vb ? (vb.x + vb.width - rect.x) / levelToCanvasX : levelW;
      var vy1 = vb ? (vb.y + vb.height - rect.y) / levelToCanvasY : levelH;

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

          // Tile rect in level-px (incl overlap) -> canvas-px, then both
          // corners through imageToScreen. Sizing from the two projected
          // corners (rather than scale × natW) guarantees the on-screen size
          // matches the position exactly, regardless of how the handle defines
          // its scale.
          var oLevelX = tileX - olLeft;
          var oLevelY = tileY - olTop;
          var tl = handle.imageToScreen({
            x: rect.x + oLevelX * levelToCanvasX,
            y: rect.y + oLevelY * levelToCanvasY
          });
          var br = handle.imageToScreen({
            x: rect.x + (oLevelX + natW) * levelToCanvasX,
            y: rect.y + (oLevelY + natH) * levelToCanvasY
          });

          var img = self.tiles[key];
          if (!img) {
            img = document.createElement("img");
            img.decoding = "async";
            img.draggable = false;
            img.style.position = "absolute";
            img.style.transformOrigin = "top left";
            img.style.pointerEvents = "none";
            img.style.userSelect = "none";
            // Refresh once the tile arrives so the HUD's loaded/loading
            // counts settle even when the viewer is idle (no more frames).
            if (self.debug) {
              img.addEventListener("load", function() { self._scheduleRender(); });
              img.addEventListener("error", function() { self._scheduleRender(); });
            }
            img.src = parts.base + "/" + level + "/" + col + "_" + row + "." + m.format + parts.query;
            self.overlay.appendChild(img);
            self.tiles[key] = img;
          }

          // Round position down and size up by the fractional remainder so
          // adjacent tiles never leave a sub-pixel seam.
          var left = Math.floor(tl.x);
          var top = Math.floor(tl.y);
          img.style.left = left + "px";
          img.style.top = top + "px";
          img.style.width = Math.ceil(br.x - left) + "px";
          img.style.height = Math.ceil(br.y - top) + "px";
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

      // Per-frame stats for the debug HUD.
      if (self.debug) {
        var loaded = 0, loading = 0;
        for (var sk in self.tiles) {
          var im = self.tiles[sk];
          if (im.complete && im.naturalWidth > 0) loaded++;
          else loading++;
        }
        self._stats = {
          level: level,
          levelW: levelW,
          levelH: levelH,
          shown: (colEnd - colStart + 1) * (rowEnd - rowStart + 1),
          loaded: loaded,
          loading: loading
        };
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

    // ---- Debug HUD ---------------------------------------------------------

    _ensureHud: function() {
      var self = this;
      if (self.hud) return;
      var container = self.handle.container;
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }
      var hud = document.createElement("div");
      hud.className = "tessera-hud";
      hud.style.cssText = [
        "position:absolute", "top:8px", "left:8px", "z-index:50",
        "font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
        "white-space:pre", "color:#e5e7eb", "background:rgba(17,24,39,0.82)",
        "padding:8px 10px", "border-radius:8px", "pointer-events:none",
        "box-shadow:0 1px 4px rgba(0,0,0,0.4)", "max-width:60%"
      ].join(";");
      container.appendChild(hud);
      self.hud = hud;
    },

    _removeHud: function() {
      var self = this;
      if (self.hud && self.hud.parentNode) self.hud.parentNode.removeChild(self.hud);
      self.hud = null;
    },

    _updateHud: function() {
      var self = this;
      var handle = self.handle;
      if (!handle) return;
      self._ensureHud();

      var d = displayedFullWidth(handle);
      var t = typeof handle.getTransform === "function" ? handle.getTransform() : null;
      var src = self.sources[self.currentLayer];

      var lines = [];
      lines.push("TESSERA ▸ " + (self.tilesActive ? "TILES" : "raster"));
      lines.push(
        "raster: " + sourceLabel(src) +
        "  [" + (self.currentLayer + 1) + "/" + self.sources.length + "]"
      );
      lines.push(
        "shown:  " + (d != null ? Math.round(d) : "?") + "px" +
        "  @ " + (t && t.s ? t.s.toFixed(2) : "?") + "×"
      );

      if (!self.dziUrl) {
        lines.push("─────────");
        lines.push("DZI: none on this file");
      } else if (!self.manifest) {
        lines.push("─────────");
        lines.push(self.manifestPending ? "DZI: loading manifest…" : "DZI: ready (zoom to activate)");
      } else {
        var m = self.manifest;
        lines.push("─────────");
        lines.push("DZI: " + m.width + "×" + m.height + "  tile " + m.tileSize + " ov " + m.overlap);
        var st = self._stats;
        if (self.tilesActive && st) {
          lines.push("level " + st.level + "/" + m.maxLevel + "  (" + st.levelW + "×" + st.levelH + ")");
          lines.push("tiles: " + st.loaded + " loaded / " + st.shown + " shown / " + st.loading + " loading");
        } else {
          lines.push("tiles: inactive (zoom past top raster)");
        }
      }

      self.hud.textContent = lines.join("\n");
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
      if (self.hud && self.hud.parentNode) {
        self.hud.parentNode.removeChild(self.hud);
      }
      self.hud = null;
      self.handle = null;
    }
  };
})();
