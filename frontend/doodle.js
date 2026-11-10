// 写真への落書き・スタンプ画面(doodle.html)
// 写真 = base、落書き = layer(別キャンバス)。描いた操作は ops に積み、
// もとに戻す / やり直すときは layer を ops から描き直す。
(function () {
  requireLogin();

  const $ = (id) => document.getElementById(id);
  const cv = $('doodle-canvas');
  const ctx = cv.getContext('2d');
  const layer = document.createElement('canvas');
  const layerCtx = layer.getContext('2d');
  const tmp = document.createElement('canvas');
  const tmpCtx = tmp.getContext('2d');

  const state = {
    tool: 'pen',        // pen | marker | pencil | eraser | stamp
    style: 'normal',    // normal | outline | shadow | sparkle
    color: '#ff6b81',
    size: 8,
    stamp: null,        // { shape, color }
  };
  let base = null;      // 元の写真
  let ops = [];
  let redoStack = [];
  let current = null;   // 描いている途中の線

  // ===== 投稿を探して写真を読み込む =====
  const postKey = new URLSearchParams(location.search).get('post');
  const keyOfPost = (p) => String(p.id ?? new Date(p.date).getTime());
  const post = postKey && getPosts().find((p) => keyOfPost(p) === postKey);

  if (!post || !post.photo) {
    $('doodle-status').textContent = '落書きできる写真が見つかりませんでした';
  } else {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);
      [cv, layer, tmp].forEach((c) => { c.width = w; c.height = h; });
      base = img;
      $('doodle-status').textContent = '';
      $('save').disabled = false;
      render();
    };
    img.onerror = () => { $('doodle-status').textContent = '写真を読み込めませんでした'; };
    img.src = post.photo;
  }

  // ===== 描画 =====
  function render() {
    if (!base) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(base, 0, 0, cv.width, cv.height);
    if (current) {
      tmpCtx.clearRect(0, 0, tmp.width, tmp.height);
      tmpCtx.drawImage(layer, 0, 0);
      drawOp(tmpCtx, current);
      ctx.drawImage(tmp, 0, 0);
    } else {
      ctx.drawImage(layer, 0, 0);
    }
  }

  function rebuildLayer() {
    layerCtx.clearRect(0, 0, layer.width, layer.height);
    ops.forEach((op) => drawOp(layerCtx, op));
  }

  function tracePath(c, pts, dx = 0, dy = 0) {
    c.beginPath();
    c.moveTo(pts[0].x + dx, pts[0].y + dy);
    if (pts.length === 1) {
      c.lineTo(pts[0].x + dx + 0.01, pts[0].y + dy);
    } else {
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        c.quadraticCurveTo(pts[i].x + dx, pts[i].y + dy, mx + dx, my + dy);
      }
      const last = pts[pts.length - 1];
      c.lineTo(last.x + dx, last.y + dy);
    }
  }

  function strokeWith(c, pts, width, color, alpha = 1, dx = 0, dy = 0) {
    c.save();
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    tracePath(c, pts, dx, dy);
    c.stroke();
    c.restore();
  }

  function drawOp(c, op) {
    if (op.type === 'stamp') {
      drawShape(c, op.shape, op.x, op.y, op.size, op.color);
      return;
    }
    const { pts, width, color, tool, style } = op;

    if (tool === 'eraser') {
      c.save();
      c.globalCompositeOperation = 'destination-out';
      strokeWith(c, pts, width * 2, '#000');
      c.restore();
      return;
    }

    // エンピツ: いったん別キャンバスに描き、ざらざらの紙目で削ってから重ねる
    if (tool === 'pencil') {
      const g = grainCanvas(c.canvas.width, c.canvas.height);
      const gc = g.getContext('2d');
      gc.clearRect(0, 0, g.width, g.height);
      drawStrokeBody(gc, op);
      applyGrain(gc, g.width, g.height);
      c.drawImage(g, 0, 0);
    } else {
      drawStrokeBody(c, op);
    }

    if (style === 'sparkle') {
      op.sparkles.forEach((s) => drawShape(c, 'sparkle', s.x, s.y, s.r, s.color));
    }
  }

  // ペンの種類ごとの、画面上での線の太さ
  function lineWidthOf(tool, width) {
    if (tool === 'marker') return width * 2.2;
    if (tool === 'pencil') return Math.max(1.5, width * 0.6);
    if (tool === 'eraser') return width * 2;
    return width;
  }

  function drawStrokeBody(c, op) {
    const { pts, width, color, tool, style } = op;
    const w = lineWidthOf(tool, width);
    const alpha = tool === 'marker' ? 0.5 : 1;

    if (style === 'shadow') {
      const off = Math.max(2, w * 0.35);
      strokeWith(c, pts, w, 'rgba(40, 20, 10, 0.45)', alpha, off, off);
    }
    if (style === 'outline') {
      strokeWith(c, pts, w + Math.max(4, w * 0.8), '#ffffff', alpha);
    }
    strokeWith(c, pts, w, color, alpha);
  }

  // ---- エンピツの紙目(毎回同じ模様になるよう、固定の乱数で一度だけ作る) ----
  let grainPattern = null;
  const grainCanvases = {};
  function grainCanvas(w, h) {
    const k = w + 'x' + h;
    if (!grainCanvases[k]) {
      grainCanvases[k] = document.createElement('canvas');
      grainCanvases[k].width = w;
      grainCanvases[k].height = h;
    }
    return grainCanvases[k];
  }

  function applyGrain(c, w, h) {
    if (!grainPattern) {
      const size = 160;
      const t = document.createElement('canvas');
      t.width = t.height = size;
      const tc = t.getContext('2d');
      const img = tc.createImageData(size, size);
      let seed = 20261110;
      const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      // 横方向にすこし伸びた粒(紙の繊維っぽさ) + ところどころ抜ける
      const row = new Float32Array(size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          row[x] = row[x] * 0.6 + rand() * 0.4;
          const n = rand() * 0.5 + row[x] * 0.5;
          let a = 0.3 + 0.75 * Math.pow(n, 1.3);   // 芯の濃さは残す
          if (rand() < 0.12) a *= 0.25;            // ところどころ紙の白が抜ける
          const i = (y * size + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
          img.data[i + 3] = Math.round(Math.min(1, a) * 255);
        }
      }
      tc.putImageData(img, 0, 0);
      grainPattern = c.createPattern(t, 'repeat');
    }
    c.save();
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = grainPattern;
    c.fillRect(0, 0, w, h);
    c.restore();
  }

  // ===== スタンプの形 =====
  function starPath(c, x, y, r, points = 5, inner = 0.45) {
    c.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const rr = i % 2 ? r * inner : r;
      const a = -Math.PI / 2 + (i * Math.PI) / points;
      c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    c.closePath();
  }

  function heartPath(c, x, y, r) {
    c.beginPath();
    c.moveTo(x, y + r * 0.85);
    c.bezierCurveTo(x - r * 1.25, y + r * 0.05, x - r * 0.75, y - r * 1.05, x, y - r * 0.4);
    c.bezierCurveTo(x + r * 0.75, y - r * 1.05, x + r * 1.25, y + r * 0.05, x, y + r * 0.85);
    c.closePath();
  }

  function drawShape(c, shape, x, y, size, color) {
    const r = size / 2;
    c.save();
    c.lineJoin = 'round';
    c.lineCap = 'round';
    const sticker = () => { // 塗りつぶし + 白いふち(シール風)
      c.fillStyle = color;
      c.fill();
      c.lineWidth = Math.max(1.5, size * 0.06);
      c.strokeStyle = '#ffffff';
      c.stroke();
    };
    const outline = () => {
      c.lineWidth = Math.max(2, size * 0.1);
      c.strokeStyle = color;
      c.stroke();
    };

    switch (shape) {
      case 'star': starPath(c, x, y, r); sticker(); break;
      case 'star-o': starPath(c, x, y, r * 0.92); outline(); break;
      case 'heart': heartPath(c, x, y, r); sticker(); break;
      case 'heart-o': heartPath(c, x, y, r * 0.92); outline(); break;
      case 'sparkle': starPath(c, x, y, r, 4, 0.28); c.fillStyle = color; c.fill(); break;
      case 'flower': {
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          c.beginPath();
          c.arc(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.45, 0, Math.PI * 2);
          c.fillStyle = color;
          c.fill();
        }
        c.beginPath();
        c.arc(x, y, r * 0.3, 0, Math.PI * 2);
        c.fillStyle = '#fff8e8';
        c.fill();
        break;
      }
      case 'smile': {
        c.beginPath();
        c.arc(x, y, r * 0.92, 0, Math.PI * 2);
        sticker();
        c.fillStyle = c.strokeStyle = '#4a2810';
        c.beginPath(); c.arc(x - r * 0.32, y - r * 0.2, r * 0.1, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(x + r * 0.32, y - r * 0.2, r * 0.1, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.lineWidth = Math.max(1.5, size * 0.07);
        c.arc(x, y + r * 0.05, r * 0.45, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
        break;
      }
    }
    c.restore();
  }

  // ===== スタンプ一覧 =====
  const STAMP_COLORS = ['#ffd23f', '#ff4d6d', '#3a86ff'];
  const STAMP_SHAPES = ['star', 'heart', 'star-o', 'heart-o', 'flower', 'smile', 'sparkle'];
  STAMP_SHAPES.forEach((shape) => STAMP_COLORS.forEach((color) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'スタンプ';
    const thumb = document.createElement('canvas');
    thumb.width = thumb.height = 96;
    const tc = thumb.getContext('2d');
    // 白いふちが見えるよう、うすい影を付けて描く
    tc.shadowColor = 'rgba(0,0,0,.25)';
    tc.shadowBlur = 4;
    drawShape(tc, shape, 48, 50, 72, color);
    btn.appendChild(thumb);
    btn.addEventListener('click', () => {
      state.stamp = { shape, color };
      document.querySelectorAll('.stamp-grid button').forEach((b) => b.classList.toggle('active', b === btn));
      selectTool('stamp');
    });
    $('stamp-grid').appendChild(btn);
    if (!state.stamp) { state.stamp = { shape, color }; btn.classList.add('active'); }
  }));

  // ===== キャンバス操作 =====
  function toCanvas(e) {
    const rect = cv.getBoundingClientRect();
    const k = cv.width / rect.width;
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k, k };
  }

  cv.addEventListener('pointerdown', (e) => {
    if (!base) return;
    const p = toCanvas(e);

    if (state.tool === 'stamp') {
      if (!state.stamp) return;
      commit({ type: 'stamp', ...state.stamp, x: p.x, y: p.y, size: stampSizeOf(state.size) * p.k });
      return;
    }

    cv.setPointerCapture(e.pointerId);
    current = {
      type: 'stroke',
      tool: state.tool,
      style: state.style,
      color: state.color,
      width: state.size * p.k,
      pts: [{ x: p.x, y: p.y }],
      sparkles: [],
      lastSpark: 0,
    };
    addSparkle(current, p);
    render();
  });

  cv.addEventListener('pointermove', (e) => {
    if (!current) return;
    const p = toCanvas(e);
    const last = current.pts[current.pts.length - 1];
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    if (dist < 1) return;
    current.pts.push({ x: p.x, y: p.y });
    current.lastSpark += dist;
    if (current.lastSpark > Math.max(10, current.width * 2.5)) {
      current.lastSpark = 0;
      addSparkle(current, p);
    }
    render();
  });

  const endStroke = () => {
    if (!current) return;
    const op = current;
    current = null;
    delete op.lastSpark;
    commit(op);
  };
  cv.addEventListener('pointerup', endStroke);
  cv.addEventListener('pointercancel', endStroke);

  // キラキラ: 線のまわりに小さな光を散らす(位置は描いたときに決めて保存)
  function addSparkle(op, p) {
    if (op.style !== 'sparkle' || op.tool === 'eraser') return;
    const spread = op.width * 1.6 + 6;
    op.sparkles.push({
      x: p.x + (Math.random() - 0.5) * spread,
      y: p.y + (Math.random() - 0.5) * spread,
      r: (op.width * 1.2 + 8) * (0.6 + Math.random() * 0.7),
      color: ['#ffffff', '#fff6a8', '#ffd1dc'][Math.floor(Math.random() * 3)],
    });
  }

  // スタンプの画面上での大きさ
  const stampSizeOf = (size) => 24 + size * 2.2;

  // ===== ふとさ / おおきさ の表示とプレビュー =====
  const preview = $('size-preview');
  const pc = preview.getContext('2d');
  function updateSizePreview() {
    const isStamp = state.tool === 'stamp';
    $('size-label').textContent = isStamp ? 'おおきさ' : 'ふとさ';

    // プレビューは画面と同じ大きさで描く(CSSピクセル → キャンバスのピクセル)
    const k = preview.width / preview.getBoundingClientRect().width || 1;
    const W = preview.width, H = preview.height;
    pc.clearRect(0, 0, W, H);

    if (isStamp) {
      const real = stampSizeOf(state.size);
      $('size-value').textContent = Math.round(real) + 'px';
      const fit = Math.min(real * k, H - 8); // 枠より大きいときは縮めて見せる
      if (state.stamp) drawShape(pc, state.stamp.shape, W / 2, H / 2, fit, state.stamp.color);
      return;
    }

    const w = lineWidthOf(state.tool, state.size);
    $('size-value').textContent = Math.round(w) + 'px';
    const s = state.size * k;
    const pts = [];
    for (let x = 18; x <= W - 18; x += 4) pts.push({ x, y: H / 2 + Math.sin((x / W) * Math.PI * 2) * 14 });
    if (state.tool === 'eraser') {
      // ケシゴムは消える範囲を点線の丸で
      pc.save();
      pc.setLineDash([4, 3]);
      pc.lineWidth = 1.5;
      pc.strokeStyle = '#4a2810';
      pc.beginPath();
      pc.arc(W / 2, H / 2, Math.min(w * k, H - 8) / 2, 0, Math.PI * 2);
      pc.stroke();
      pc.restore();
      return;
    }
    const op = { type: 'stroke', tool: state.tool, style: state.style, color: state.color, width: s, pts, sparkles: [] };
    if (state.style === 'sparkle') {
      [0.25, 0.5, 0.75].forEach((t, i) => op.sparkles.push({
        x: W * t, y: H / 2 + (i % 2 ? 16 : -16), r: s * 1.2 + 8, color: '#fff6a8',
      }));
    }
    drawOp(pc, op);
  }

  function commit(op) {
    ops.push(op);
    redoStack = [];
    drawOp(layerCtx, op);
    render();
    updateHistoryButtons();
  }

  function undo() {
    if (!ops.length) return;
    redoStack.push(ops.pop());
    rebuildLayer();
    render();
    updateHistoryButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    const op = redoStack.pop();
    ops.push(op);
    drawOp(layerCtx, op);
    render();
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $('undo').disabled = !ops.length;
    $('redo').disabled = !redoStack.length;
  }

  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  });

  // ===== ツール・線の種類・パネル =====
  function showPanel(name) {
    $('panel-color').hidden = name !== 'color';
    $('panel-stamp').hidden = name !== 'stamp';
    if (name === 'color') oldColor = state.color, updateSwatches();
  }

  function selectTool(tool) {
    state.tool = tool;
    document.querySelectorAll('#tools [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    cv.classList.toggle('eraser', tool === 'eraser');
    cv.classList.toggle('stamp', tool === 'stamp');
    if (tool === 'stamp') showPanel('stamp');
    else if (!$('panel-stamp').hidden) showPanel('color');
    updateSizePreview();
  }

  document.querySelectorAll('#tools [data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => selectTool(btn.dataset.tool));
  });

  $('color-btn').addEventListener('click', () => {
    if (state.tool === 'stamp' || state.tool === 'eraser') selectTool('pen');
    showPanel('color');
  });

  document.querySelectorAll('#styles [data-style]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.style = btn.dataset.style;
      document.querySelectorAll('#styles [data-style]').forEach((b) => b.classList.toggle('active', b === btn));
      if (state.tool === 'eraser' || state.tool === 'stamp') selectTool('pen');
      updateSizePreview();
    });
  });

  $('size').addEventListener('input', () => { state.size = Number($('size').value); updateSizePreview(); });
  window.addEventListener('resize', updateSizePreview);

  // ===== カラーパレット(色相の輪 + あざやかさ・明るさの四角) =====
  const ring = $('hue-ring');
  const box = $('sv-box');
  const picker = $('color-picker');
  const RING_IN = 78;
  const RING_OUT = 98;
  const RING_MID = (RING_IN + RING_OUT) / 2;
  let hsv = hexToHsv(state.color);
  let oldColor = state.color;

  (function drawRing() {
    const rc = ring.getContext('2d');
    const g = rc.createConicGradient(0, 100, 100);
    for (let i = 0; i <= 360; i += 30) g.addColorStop(i / 360, `hsl(${i}, 100%, 50%)`);
    rc.beginPath();
    rc.arc(100, 100, RING_OUT, 0, Math.PI * 2);
    rc.arc(100, 100, RING_IN, 0, Math.PI * 2, true);
    rc.fillStyle = g;
    rc.fill();
  })();

  function drawBox() {
    const bc = box.getContext('2d');
    bc.fillStyle = `hsl(${hsv.h}, 100%, 50%)`;
    bc.fillRect(0, 0, 100, 100);
    const white = bc.createLinearGradient(0, 0, 100, 0);
    white.addColorStop(0, '#fff');
    white.addColorStop(1, 'rgba(255,255,255,0)');
    bc.fillStyle = white;
    bc.fillRect(0, 0, 100, 100);
    const black = bc.createLinearGradient(0, 0, 0, 100);
    black.addColorStop(0, 'rgba(0,0,0,0)');
    black.addColorStop(1, '#000');
    bc.fillStyle = black;
    bc.fillRect(0, 0, 100, 100);
  }

  function updatePicker() {
    drawBox();
    const a = (hsv.h * Math.PI) / 180;
    Object.assign($('hue-knob').style, {
      left: 100 + Math.cos(a) * RING_MID + 'px',
      top: 100 + Math.sin(a) * RING_MID + 'px',
      background: `hsl(${hsv.h}, 100%, 50%)`,
    });
    Object.assign($('sv-knob').style, {
      left: 50 + hsv.s * 100 + 'px',
      top: 50 + (1 - hsv.v) * 100 + 'px',
      background: state.color,
    });
    updateSwatches();
  }

  function updateSwatches() {
    $('swatch-now').style.background = state.color;
    $('swatch-old').style.background = oldColor;
    $('color-dot').style.background = state.color;
    updateSizePreview();
  }

  let dragging = null;
  function pickAt(e) {
    const rect = picker.getBoundingClientRect();
    const x = e.clientX - rect.left - 100;
    const y = e.clientY - rect.top - 100;
    if (dragging === 'hue') {
      hsv.h = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    } else {
      hsv.s = Math.min(1, Math.max(0, (x + 50) / 100));
      hsv.v = Math.min(1, Math.max(0, 1 - (y + 50) / 100));
    }
    state.color = hsvToHex(hsv);
    updatePicker();
  }
  picker.addEventListener('pointerdown', (e) => {
    const rect = picker.getBoundingClientRect();
    const x = e.clientX - rect.left - 100;
    const y = e.clientY - rect.top - 100;
    const d = Math.hypot(x, y);
    if (Math.abs(x) <= 50 && Math.abs(y) <= 50) dragging = 'sv';
    else if (d >= RING_IN - 6 && d <= RING_OUT + 6) dragging = 'hue';
    else return;
    picker.setPointerCapture(e.pointerId);
    pickAt(e);
  });
  picker.addEventListener('pointermove', (e) => { if (dragging) pickAt(e); });
  picker.addEventListener('pointerup', () => { dragging = null; });
  picker.addEventListener('pointercancel', () => { dragging = null; });

  $('swatch-old').addEventListener('click', () => {
    state.color = oldColor;
    hsv = hexToHsv(oldColor);
    updatePicker();
  });

  function hsvToHex({ h, s, v }) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return '#' + [f(5), f(3), f(1)].map((n) => n.toString(16).padStart(2, '0')).join('');
  }

  function hexToHsv(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
  }

  updatePicker();

  // ===== 保存 =====
  $('save').addEventListener('click', () => {
    if (!base) return;
    $('save').disabled = true;
    $('doodle-error').textContent = '';
    const out = document.createElement('canvas');
    out.width = cv.width;
    out.height = cv.height;
    const oc = out.getContext('2d');
    oc.drawImage(base, 0, 0, out.width, out.height);
    oc.drawImage(layer, 0, 0);
    try {
      updatePostPhoto(postKey, out.toDataURL('image/jpeg', 0.9));
      location.href = 'home.html';
    } catch (err) {
      $('doodle-error').textContent = err.message || '保存に失敗しました';
      $('save').disabled = false;
    }
  });
})();
