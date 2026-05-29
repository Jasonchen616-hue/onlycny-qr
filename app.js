(function () {
  "use strict";

  var textEl = document.getElementById("qr-text");
  var sizeEl = document.getElementById("qr-size");
  var ecEl = document.getElementById("qr-ec");
  var fgEl = document.getElementById("qr-fg");
  var fgTextEl = document.getElementById("qr-fg-text");
  var bgEl = document.getElementById("qr-bg");
  var bgTextEl = document.getElementById("qr-bg-text");
  var moduleStyleEl = document.getElementById("qr-module-style");
  var finderStyleEl = document.getElementById("qr-finder-style");
  var quietZoneEl = document.getElementById("qr-quiet-zone");
  var showBorderEl = document.getElementById("qr-show-border");
  var btnGenerate = document.getElementById("btn-generate");
  var btnPng = document.getElementById("btn-png");
  var btnSvg = document.getElementById("btn-svg");
  var btnClear = document.getElementById("btn-clear");
  var hintEl = document.getElementById("hint");
  var previewEmpty = document.getElementById("preview-empty");
  var previewResult = document.getElementById("preview-result");
  var canvasEl = document.getElementById("qr-canvas");

  var lastText = "";
  var lastSvgString = "";
  var lastQrModel = null;

  var LIB_MISSING_MSG = "二维码组件未加载，请确认 lib/qrcode.min.js 文件存在。";
  var BORDER_PX = 2;
  var FINDER_SIZE = 7;

  /** 九宫格点阵：上、下、左、右、中、右下 */
  var GRID9_POSITIONS = [
    [0.5, 1 / 6],
    [0.5, 5 / 6],
    [1 / 6, 0.5],
    [5 / 6, 0.5],
    [0.5, 0.5],
    [5 / 6, 5 / 6],
  ];

  function showHint(message, kind) {
    if (!message) {
      hintEl.hidden = true;
      hintEl.textContent = "";
      hintEl.className = "hint";
      return;
    }
    hintEl.hidden = false;
    hintEl.textContent = message;
    hintEl.className = "hint hint--" + (kind || "info");
  }

  function syncColorInputs(colorInput, textInput) {
    colorInput.addEventListener("input", function () {
      textInput.value = colorInput.value;
    });
    textInput.addEventListener("input", function () {
      var v = textInput.value.trim();
      if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
        colorInput.value = v;
      }
    });
    textInput.addEventListener("blur", function () {
      var v = textInput.value.trim();
      if (!/^#[0-9A-Fa-f]{6}$/.test(v)) {
        textInput.value = colorInput.value;
      }
    });
  }

  function normalizeHex(input, fallback) {
    var v = String(input || "").trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) return v;
    if (/^[0-9A-Fa-f]{6}$/.test(v)) return "#" + v;
    return fallback;
  }

  function getRenderOptions() {
    return {
      pixelSize: parseInt(sizeEl.value, 10) || 300,
      ecLevel: ecEl.value,
      fg: normalizeHex(fgTextEl.value, "#000000"),
      bg: normalizeHex(bgTextEl.value, "#ffffff"),
      quietZone: (function () {
        var qz = parseInt(quietZoneEl.value, 10);
        return isNaN(qz) ? 4 : qz;
      })(),
      moduleStyle: moduleStyleEl.value,
      finderStyle: finderStyleEl.value,
      showBorder: !!showBorderEl.checked,
    };
  }

  function getInputText() {
    return (textEl.value || "").trim();
  }

  function timestampFilename(ext) {
    var d = new Date();
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    var stamp =
      d.getFullYear() +
      pad(d.getMonth() + 1) +
      pad(d.getDate()) +
      "-" +
      pad(d.getHours()) +
      pad(d.getMinutes()) +
      pad(d.getSeconds());
    return "qrcode-" + stamp + "." + ext;
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function setPreviewState(hasQr) {
    previewEmpty.hidden = hasQr;
    previewResult.hidden = !hasQr;
    btnPng.disabled = !hasQr;
    btnSvg.disabled = !hasQr;
  }

  function ensureLibrary() {
    if (typeof qrcode !== "function") {
      showHint(LIB_MISSING_MSG, "error");
      return false;
    }
    return true;
  }

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildQrModel(text, ecLevel) {
    var qr = qrcode(0, ecLevel);
    qr.addData(text);
    qr.make();
    return qr;
  }

  function getFinderCorner(row, col, n) {
    if (row < FINDER_SIZE && col < FINDER_SIZE) return { r: 0, c: 0 };
    if (row < FINDER_SIZE && col >= n - FINDER_SIZE) return { r: 0, c: n - FINDER_SIZE };
    if (row >= n - FINDER_SIZE && col < FINDER_SIZE) return { r: n - FINDER_SIZE, c: 0 };
    return null;
  }

  function isFinderModule(row, col, n) {
    return getFinderCorner(row, col, n) !== null;
  }

  function createLayout(qrModel, opts) {
    var n = qrModel.getModuleCount();
    var margin = opts.quietZone;
    var total = n + margin * 2;
    var cell = opts.pixelSize / total;
    var size = Math.max(1, Math.floor(cell * total));
    return {
      n: n,
      margin: margin,
      cell: cell,
      size: size,
      qr: qrModel,
      opts: opts,
      px: function (col) {
        return (col + margin) * cell;
      },
      py: function (row) {
        return (row + margin) * cell;
      },
    };
  }

  function drawModuleCanvas(ctx, x, y, cell, style, fg) {
    ctx.fillStyle = fg;
    var cx = x + cell / 2;
    var cy = y + cell / 2;
    var i;

    if (style === "dot") {
      ctx.beginPath();
      ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (style === "rounded") {
      var r = cell * 0.22;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x, y, cell, cell, r);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, cell, cell);
      }
      return;
    }

    if (style === "gap") {
      var inset = cell * 0.12;
      ctx.fillRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2);
      return;
    }

    if (style === "grid9") {
      var dotR = cell * 0.14;
      for (i = 0; i < GRID9_POSITIONS.length; i++) {
        ctx.beginPath();
        ctx.arc(x + GRID9_POSITIONS[i][0] * cell, y + GRID9_POSITIONS[i][1] * cell, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    ctx.fillRect(x, y, cell, cell);
  }

  function appendModuleSvg(parts, x, y, cell, style, fg) {
    var cx = x + cell / 2;
    var cy = y + cell / 2;
    var i;
    var fgEsc = escapeXml(fg);

    if (style === "dot") {
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + cell * 0.42 + '" fill="' + fgEsc + '"/>');
      return;
    }

    if (style === "rounded") {
      parts.push(
        '<rect x="' +
          x +
          '" y="' +
          y +
          '" width="' +
          cell +
          '" height="' +
          cell +
          '" rx="' +
          cell * 0.22 +
          '" ry="' +
          cell * 0.22 +
          '" fill="' +
          fgEsc +
          '"/>'
      );
      return;
    }

    if (style === "gap") {
      var inset = cell * 0.12;
      parts.push(
        '<rect x="' +
          (x + inset) +
          '" y="' +
          (y + inset) +
          '" width="' +
          (cell - inset * 2) +
          '" height="' +
          (cell - inset * 2) +
          '" fill="' +
          fgEsc +
          '"/>'
      );
      return;
    }

    if (style === "grid9") {
      var dotR = cell * 0.14;
      for (i = 0; i < GRID9_POSITIONS.length; i++) {
        parts.push(
          '<circle cx="' +
            (x + GRID9_POSITIONS[i][0] * cell) +
            '" cy="' +
            (y + GRID9_POSITIONS[i][1] * cell) +
            '" r="' +
            dotR +
            '" fill="' +
            fgEsc +
            '"/>'
        );
      }
      return;
    }

    parts.push('<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" fill="' + fgEsc + '"/>');
  }

  function drawFinderCanvas(ctx, layout, corner) {
    var qr = layout.qr;
    var cell = layout.cell;
    var fg = layout.opts.fg;
    var bg = layout.opts.bg;
    var style = layout.opts.finderStyle;
    var x0 = layout.px(corner.c);
    var y0 = layout.py(corner.r);
    var s = FINDER_SIZE * cell;

    if (style === "standard") {
      var dr;
      var dc;
      ctx.fillStyle = fg;
      for (dr = 0; dr < FINDER_SIZE; dr++) {
        for (dc = 0; dc < FINDER_SIZE; dc++) {
          if (qr.isDark(corner.r + dr, corner.c + dc)) {
            ctx.fillRect(x0 + dc * cell, y0 + dr * cell, cell, cell);
          }
        }
      }
      return;
    }

    if (style === "rounded") {
      var r1 = cell * 1.2;
      ctx.fillStyle = fg;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(x0, y0, s, s, r1);
        ctx.fill();
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(x0 + cell, y0 + cell, s - 2 * cell, s - 2 * cell, r1 * 0.65);
        ctx.fill();
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.roundRect(x0 + 2 * cell, y0 + 2 * cell, s - 4 * cell, s - 4 * cell, r1 * 0.35);
        ctx.fill();
      } else {
        ctx.fillRect(x0, y0, s, s);
        ctx.fillStyle = bg;
        ctx.fillRect(x0 + cell, y0 + cell, s - 2 * cell, s - 2 * cell);
        ctx.fillStyle = fg;
        ctx.fillRect(x0 + 2 * cell, y0 + 2 * cell, s - 4 * cell, s - 4 * cell);
      }
      return;
    }

    if (style === "circle") {
      var cx = x0 + s / 2;
      var cy = y0 + s / 2;
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(cx, cy, s / 2 - cell, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(cx, cy, s / 2 - 2 * cell, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (style === "simple") {
      ctx.strokeStyle = fg;
      ctx.lineWidth = Math.max(1, cell * 0.35);
      ctx.strokeRect(x0 + ctx.lineWidth / 2, y0 + ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
      ctx.fillStyle = fg;
      ctx.fillRect(x0 + 2 * cell, y0 + 2 * cell, s - 4 * cell, s - 4 * cell);
    }
  }

  function appendFinderSvg(parts, layout, corner) {
    var qr = layout.qr;
    var cell = layout.cell;
    var fg = escapeXml(layout.opts.fg);
    var bg = escapeXml(layout.opts.bg);
    var style = layout.opts.finderStyle;
    var x0 = layout.px(corner.c);
    var y0 = layout.py(corner.r);
    var s = FINDER_SIZE * cell;
    var dr;
    var dc;

    if (style === "standard") {
      for (dr = 0; dr < FINDER_SIZE; dr++) {
        for (dc = 0; dc < FINDER_SIZE; dc++) {
          if (qr.isDark(corner.r + dr, corner.c + dc)) {
            parts.push(
              '<rect x="' +
                (x0 + dc * cell) +
                '" y="' +
                (y0 + dr * cell) +
                '" width="' +
                cell +
                '" height="' +
                cell +
                '" fill="' +
                fg +
                '"/>'
            );
          }
        }
      }
      return;
    }

    if (style === "rounded") {
      var r1 = cell * 1.2;
      parts.push(
        '<rect x="' +
          x0 +
          '" y="' +
          y0 +
          '" width="' +
          s +
          '" height="' +
          s +
          '" rx="' +
          r1 +
          '" fill="' +
          fg +
          '"/>'
      );
      parts.push(
        '<rect x="' +
          (x0 + cell) +
          '" y="' +
          (y0 + cell) +
          '" width="' +
          (s - 2 * cell) +
          '" height="' +
          (s - 2 * cell) +
          '" rx="' +
          r1 * 0.65 +
          '" fill="' +
          bg +
          '"/>'
      );
      parts.push(
        '<rect x="' +
          (x0 + 2 * cell) +
          '" y="' +
          (y0 + 2 * cell) +
          '" width="' +
          (s - 4 * cell) +
          '" height="' +
          (s - 4 * cell) +
          '" rx="' +
          r1 * 0.35 +
          '" fill="' +
          fg +
          '"/>'
      );
      return;
    }

    if (style === "circle") {
      var cx = x0 + s / 2;
      var cy = y0 + s / 2;
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + s / 2 + '" fill="' + fg + '"/>');
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (s / 2 - cell) + '" fill="' + bg + '"/>');
      parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (s / 2 - 2 * cell) + '" fill="' + fg + '"/>');
      return;
    }

    if (style === "simple") {
      parts.push(
        '<rect x="' +
          x0 +
          '" y="' +
          y0 +
          '" width="' +
          s +
          '" height="' +
          s +
          '" fill="none" stroke="' +
          fg +
          '" stroke-width="' +
          Math.max(1, cell * 0.35) +
          '"/>'
      );
      parts.push(
        '<rect x="' +
          (x0 + 2 * cell) +
          '" y="' +
          (y0 + 2 * cell) +
          '" width="' +
          (s - 4 * cell) +
          '" height="' +
          (s - 4 * cell) +
          '" fill="' +
          fg +
          '"/>'
      );
    }
  }

  function drawBorderCanvas(ctx, layout) {
    var n = layout.n;
    var cell = layout.cell;
    var margin = layout.margin;
    var x = layout.px(0);
    var y = layout.py(0);
    var w = n * cell;
    ctx.strokeStyle = layout.opts.fg;
    ctx.lineWidth = BORDER_PX;
    ctx.strokeRect(x + BORDER_PX / 2, y + BORDER_PX / 2, w - BORDER_PX, w - BORDER_PX);
  }

  function appendBorderSvg(parts, layout) {
    var n = layout.n;
    var cell = layout.cell;
    var x = layout.px(0);
    var y = layout.py(0);
    var w = n * cell;
    parts.push(
      '<rect x="' +
        (x + BORDER_PX / 2) +
        '" y="' +
        (y + BORDER_PX / 2) +
        '" width="' +
        (w - BORDER_PX) +
        '" height="' +
        (w - BORDER_PX) +
        '" fill="none" stroke="' +
        escapeXml(layout.opts.fg) +
        '" stroke-width="' +
        BORDER_PX +
        '"/>'
    );
  }

  function renderQr(layout, ctx, svgParts) {
    var qr = layout.qr;
    var n = layout.n;
    var opts = layout.opts;
    var row;
    var col;
    var corners = [
      { r: 0, c: 0 },
      { r: 0, c: n - FINDER_SIZE },
      { r: n - FINDER_SIZE, c: 0 },
    ];
    var ci;

    if (ctx) {
      ctx.fillStyle = opts.bg;
      ctx.fillRect(0, 0, layout.size, layout.size);
    } else if (svgParts) {
      svgParts.push('<rect width="100%" height="100%" fill="' + escapeXml(opts.bg) + '"/>');
    }

    for (ci = 0; ci < corners.length; ci++) {
      if (ctx) drawFinderCanvas(ctx, layout, corners[ci]);
      else appendFinderSvg(svgParts, layout, corners[ci]);
    }

    for (row = 0; row < n; row++) {
      for (col = 0; col < n; col++) {
        if (!qr.isDark(row, col) || isFinderModule(row, col, n)) continue;
        var mx = layout.px(col);
        var my = layout.py(row);
        if (ctx) drawModuleCanvas(ctx, mx, my, layout.cell, opts.moduleStyle, opts.fg);
        else appendModuleSvg(svgParts, mx, my, layout.cell, opts.moduleStyle, opts.fg);
      }
    }

    if (opts.showBorder) {
      if (ctx) drawBorderCanvas(ctx, layout);
      else appendBorderSvg(svgParts, layout);
    }
  }

  function renderToCanvas(qrModel, opts) {
    var layout = createLayout(qrModel, opts);
    var ctx = canvasEl.getContext("2d");
    canvasEl.width = layout.size;
    canvasEl.height = layout.size;
    renderQr(layout, ctx, null);
  }

  function buildSvgString(qrModel, opts) {
    var layout = createLayout(qrModel, opts);
    var parts = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
        layout.size +
        '" height="' +
        layout.size +
        '" viewBox="0 0 ' +
        layout.size +
        " " +
        layout.size +
        '">',
    ];
    renderQr(layout, null, parts);
    parts.push("</svg>");
    return parts.join("");
  }

  function renderOutput(qrModel, opts) {
    renderToCanvas(qrModel, opts);
    lastSvgString = buildSvgString(qrModel, opts);
  }

  function generate() {
    if (!ensureLibrary()) return;

    var text = getInputText();
    if (!text) {
      showHint("请先输入要编码的内容（网址、文字或编号等）。", "warn");
      setPreviewState(false);
      return;
    }

    var opts = getRenderOptions();

    try {
      lastQrModel = buildQrModel(text, opts.ecLevel);
      renderOutput(lastQrModel, opts);
      lastText = text;
      setPreviewState(true);
      showHint("已生成。", "info");
    } catch (err) {
      lastQrModel = null;
      lastSvgString = "";
      lastText = "";
      setPreviewState(false);
      showHint("生成失败，请检查内容长度或颜色设置后重试。", "error");
    }
  }

  function downloadPng() {
    if (!lastText || previewResult.hidden || !lastQrModel) {
      showHint("请先生成二维码。", "warn");
      return;
    }
    try {
      renderToCanvas(lastQrModel, getRenderOptions());
      canvasEl.toBlob(
        function (blob) {
          if (!blob) {
            showHint("PNG 导出失败，请重试。", "error");
            return;
          }
          downloadBlob(blob, timestampFilename("png"));
          showHint("PNG 已下载。", "info");
        },
        "image/png",
        1
      );
    } catch (e) {
      showHint("PNG 导出失败，请重试。", "error");
    }
  }

  function downloadSvg() {
    if (!lastText || previewResult.hidden || !lastQrModel) {
      showHint("请先生成二维码。", "warn");
      return;
    }

    if (!ensureLibrary()) return;

    try {
      var svg = buildSvgString(lastQrModel, getRenderOptions());
      lastSvgString = svg;
      var blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, timestampFilename("svg"));
      showHint("SVG 已下载。", "info");
    } catch (e) {
      showHint("SVG 导出失败，请重试。", "error");
    }
  }

  function clearAll() {
    textEl.value = "";
    lastText = "";
    lastSvgString = "";
    lastQrModel = null;
    sizeEl.value = "300";
    ecEl.value = "M";
    fgEl.value = "#000000";
    fgTextEl.value = "#000000";
    bgEl.value = "#ffffff";
    bgTextEl.value = "#ffffff";
    moduleStyleEl.value = "square";
    finderStyleEl.value = "standard";
    quietZoneEl.value = "4";
    showBorderEl.checked = false;
    setPreviewState(false);
    showHint("", "");
    textEl.focus();
  }

  syncColorInputs(fgEl, fgTextEl);
  syncColorInputs(bgEl, bgTextEl);

  btnGenerate.addEventListener("click", generate);
  btnPng.addEventListener("click", downloadPng);
  btnSvg.addEventListener("click", downloadSvg);
  btnClear.addEventListener("click", clearAll);

  textEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      generate();
    }
  });

  setPreviewState(false);
})();
