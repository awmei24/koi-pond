(() => {
  "use strict";
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  const pondEl = document.getElementById("pond");
  const glCanvas = document.getElementById("gl");
  const topCanvas = document.getElementById("top");
  const tctx = topCanvas.getContext("2d");

  const sceneC = document.createElement("canvas");
  const sctx = sceneC.getContext("2d");
  const floorC = document.createElement("canvas");
  const shadowC = document.createElement("canvas");
  const shctx = shadowC.getContext("2d");
  const SHS = 0.25; // shadow canvas scale (low res = soft shadows)

  let W = 0, H = 0, SS = 1;
  let time = 0;

  // ---------- helpers ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = Math.random;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const wrapAngle = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };
  const pick = (arr, r = rand) => arr[Math.floor(r() * arr.length)];

  // ---------- water simulation (height field, CPU) ----------
  let cell = 4, cols = 0, rows = 0, cur, prev, wdata;
  function initWater() {
    cell = 4;
    while ((W / cell) * (H / cell) > 120000) cell += 1;
    cols = Math.ceil(W / cell) + 3;
    rows = Math.ceil(H / cell) + 3;
    cur = new Float32Array(cols * rows);
    prev = new Float32Array(cols * rows);
    wdata = new Uint8Array(cols * rows * 4);
  }
  function stepWater() {
    const c = cols, damp = 0.984;
    for (let y = 1; y < rows - 1; y++) {
      let i = y * c + 1;
      for (let x = 1; x < c - 1; x++, i++) {
        const v = (cur[i - 1] + cur[i + 1] + cur[i - c] + cur[i + c]) * 0.5 - prev[i];
        prev[i] = v * damp;
      }
    }
    const t = prev; prev = cur; cur = t;
  }
  function disturb(px, py, radius, amp) {
    const gx = px / cell + 1, gy = py / cell + 1, gr = Math.max(1.2, radius / cell);
    const x0 = Math.max(1, Math.floor(gx - gr)), x1 = Math.min(cols - 2, Math.ceil(gx + gr));
    const y0 = Math.max(1, Math.floor(gy - gr)), y1 = Math.min(rows - 2, Math.ceil(gy + gr));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - gx, y - gy) / gr;
        if (d < 1) cur[y * cols + x] += amp * (0.5 + 0.5 * Math.cos(Math.PI * d));
      }
    }
  }
  function gradAt(px, py) {
    const x = clamp(Math.round(px / cell + 1), 1, cols - 2);
    const y = clamp(Math.round(py / cell + 1), 1, rows - 2);
    const i = y * cols + x;
    return [(cur[i + 1] - cur[i - 1]) * 0.5, (cur[i + cols] - cur[i - cols]) * 0.5, cur[i]];
  }
  const b8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
  function encodeWater() {
    const c = cols;
    let j = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < c; x++) {
        const i = y * c + x;
        const h = cur[i];
        const l = x > 0 ? cur[i - 1] : h, r = x < c - 1 ? cur[i + 1] : h;
        const u = y > 0 ? cur[i - c] : h, d = y < rows - 1 ? cur[i + c] : h;
        wdata[j++] = b8(128 + (r - l) * 52);
        wdata[j++] = b8(128 + (d - u) * 52);
        wdata[j++] = b8(128 + h * 30);
        wdata[j++] = b8(128 - (l + r + u + d - 4 * h) * 70);
      }
    }
  }

  // ---------- shapes ----------
  const MAPLE_LOBES = [[-240, 0.3], [-190, 0.62], [-140, 0.88], [-90, 1], [-40, 0.88], [10, 0.62], [60, 0.3]];
  function maplePath(ctx, R) {
    const P = (deg, r) => [Math.cos(deg * DEG) * r * R, Math.sin(deg * DEG) * r * R];
    ctx.beginPath();
    let p = P(100, 0.12); ctx.moveTo(p[0], p[1]);
    for (let k = 0; k < MAPLE_LOBES.length; k++) {
      const [a, len] = MAPLE_LOBES[k];
      const s1 = P(a - 13, len * 0.62), tip = P(a, len), s2 = P(a + 13, len * 0.62);
      ctx.lineTo(s1[0], s1[1]); ctx.lineTo(tip[0], tip[1]); ctx.lineTo(s2[0], s2[1]);
      if (k < MAPLE_LOBES.length - 1) {
        const v = P((a + MAPLE_LOBES[k + 1][0]) / 2, 0.33); ctx.lineTo(v[0], v[1]);
      }
    }
    p = P(80, 0.12); ctx.lineTo(p[0], p[1]);
    ctx.closePath();
  }
  function ginkgoPath(ctx, R) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(-150 * DEG) * R, Math.sin(-150 * DEG) * R);
    ctx.arc(0, 0, R, -150 * DEG, -95 * DEG);
    ctx.lineTo(0, -R * 0.62);
    ctx.lineTo(Math.cos(-85 * DEG) * R, Math.sin(-85 * DEG) * R);
    ctx.arc(0, 0, R, -85 * DEG, -30 * DEG);
    ctx.closePath();
  }
  function leafPath(ctx, kind, R) {
    if (kind === "maple") maplePath(ctx, R); else ginkgoPath(ctx, R);
  }

  // ---------- pond floor (generated once per size) ----------
  const STONES = [
    ["#8d8572", "#4a4538"], ["#7a7d72", "#3b3e36"], ["#9a8e74", "#514735"],
    ["#6d6a5f", "#34322b"], ["#a49a86", "#5a5244"], ["#7f7466", "#3e352d"], ["#5e6658", "#2c312a"]
  ];
  function buildFloor() {
    floorC.width = Math.round(W * SS); floorC.height = Math.round(H * SS);
    const c = floorC.getContext("2d");
    c.setTransform(SS, 0, 0, SS, 0, 0);
    const r = mulberry32(1987);
    const area = W * H, cx = W / 2, cy = H / 2;
    const g = c.createRadialGradient(cx, cy * 0.96, 0, cx, cy, Math.hypot(W, H) * 0.58);
    g.addColorStop(0, "#14352f");
    g.addColorStop(0.5, "#21443a");
    g.addColorStop(1, "#3a5641");
    c.fillStyle = g; c.fillRect(0, 0, W, H);

    const silts = ["rgba(82,104,66,0.13)", "rgba(16,36,32,0.18)", "rgba(120,108,74,0.09)", "rgba(46,72,52,0.16)"];
    for (let i = 0; i < area / 1500; i++) {
      const rr = 18 + r() * 90;
      c.fillStyle = pick(silts, r);
      c.beginPath(); c.ellipse(r() * W, r() * H, rr, rr * (0.45 + r() * 0.5), r() * Math.PI, 0, TAU); c.fill();
    }
    // pebbles, denser toward the banks
    for (let i = 0; i < area / 520; i++) {
      const x = r() * W, y = r() * H;
      const edge = Math.max(Math.abs(x - cx) / cx, Math.abs(y - cy) / cy);
      if (r() > Math.pow(edge, 3) * 0.97 + 0.012) continue;
      const rad = 2.5 + r() * r() * 15 * (0.6 + edge * 0.6);
      const [lt, dk] = pick(STONES, r);
      c.save(); c.translate(x, y); c.rotate(r() * Math.PI);
      const sq = 0.6 + r() * 0.35;
      c.fillStyle = "rgba(4,14,12,0.35)";
      c.beginPath(); c.ellipse(rad * 0.22, rad * 0.3, rad * 1.05, rad * sq * 1.05, 0, 0, TAU); c.fill();
      const pg = c.createRadialGradient(-rad * 0.35, -rad * 0.35 * sq, rad * 0.1, 0, 0, rad * 1.1);
      pg.addColorStop(0, lt); pg.addColorStop(1, dk);
      c.fillStyle = pg;
      c.beginPath(); c.ellipse(0, 0, rad, rad * sq, 0, 0, TAU); c.fill();
      c.restore();
    }
    // algae film over everything
    for (let i = 0; i < area / 2600; i++) {
      const x = r() * W, y = r() * H, rr = 10 + r() * 50;
      c.fillStyle = r() < 0.5 ? "rgba(52,84,44,0.16)" : "rgba(20,46,34,0.18)";
      c.beginPath(); c.ellipse(x, y, rr, rr * 0.6, r() * Math.PI, 0, TAU); c.fill();
    }
    // sunken, browned leaves
    for (let i = 0; i < Math.max(5, area / 120000); i++) {
      c.save(); c.translate(r() * W, r() * H); c.rotate(r() * TAU);
      c.globalAlpha = 0.45 + r() * 0.2;
      c.fillStyle = r() < 0.6 ? "#5a3a22" : "#6e5a2a";
      if (r() < 0.65) maplePath(c, 12 + r() * 8); else ginkgoPath(c, 10 + r() * 6);
      c.fill(); c.restore();
    }
  }

  // ---------- koi ----------
  const VARIETIES = [
    { name: "Kohaku", zh: "红白", base: "#f4efe5", fin: "#f6f1e8", swatch: "linear-gradient(90deg,#f4efe5 0 35%,#d84a2b 35% 70%,#f4efe5 70%)" },
    { name: "Taisho Sanke", zh: "大正三色", base: "#f3eee3", fin: "#f4efe6", swatch: "linear-gradient(90deg,#f3eee3 0 30%,#d4452a 30% 60%,#1d1b1c 60% 75%,#f3eee3 75%)" },
    { name: "Showa", zh: "昭和三色", base: "#1f1c1e", fin: "#2b2729", swatch: "linear-gradient(90deg,#1f1c1e 0 30%,#d4452a 30% 60%,#f3eee3 60% 78%,#1f1c1e 78%)" },
    { name: "Yamabuki Ogon", zh: "山吹黄金", base: "#e9aa3a", fin: "#f2c15a", metal: true, butterfly: true, swatch: "linear-gradient(90deg,#f7d27a,#e39a2a)" },
    { name: "Tancho", zh: "丹顶", base: "#f5f1ea", fin: "#f7f3ec", swatch: "radial-gradient(circle at 25% 50%,#d63c2a 0 28%,#f5f1ea 30%)" },
    { name: "Asagi", zh: "浅黄", base: "#7b97a8", fin: "#e2733e", swatch: "linear-gradient(180deg,#7b97a8 0 55%,#e2733e 55%)" },
    { name: "Butterfly Kohaku", zh: "蝴蝶红白", base: "#f6f2ea", fin: "#faf6ef", butterfly: true, swatch: "linear-gradient(90deg,#f6f2ea 0 20%,#e05a33 20% 55%,#f6f2ea 55%)" },
    { name: "Chagoi", zh: "茶鲤", base: "#a46a3c", fin: "#b57b4a", swatch: "linear-gradient(90deg,#b8804e,#8a5530)" }
  ];
  function genPatches(v, r) {
    const P = [];
    const red = v.name === "Asagi" ? "#e2733e" : "#d8452b";
    const add = (t, s, rad, el, c) => P.push({ t, s, r: rad, el, c, rot: (r() - 0.5) * 0.5 });
    switch (v.name) {
      case "Kohaku":
      case "Butterfly Kohaku": {
        const n = 3 + Math.floor(r() * 2);
        for (let i = 0; i < n; i++) add(0.06 + (i / n) * 0.66 + r() * 0.08, (r() - 0.5) * 0.9, 0.75 + r() * 0.45, 1.3 + r() * 0.9, red);
        break;
      }
      case "Taisho Sanke": {
        for (let i = 0; i < 3; i++) add(0.08 + i * 0.22 + r() * 0.08, (r() - 0.5) * 0.9, 0.7 + r() * 0.4, 1.4 + r() * 0.8, red);
        for (let i = 0; i < 6; i++) add(0.22 + r() * 0.6, (r() - 0.5) * 1.6, 0.18 + r() * 0.2, 1 + r() * 0.8, "#1c1a1b");
        break;
      }
      case "Showa": {
        for (let i = 0; i < 3; i++) add(0.05 + i * 0.24 + r() * 0.06, (r() - 0.5) * 1.0, 0.7 + r() * 0.35, 1.4 + r() * 0.8, red);
        for (let i = 0; i < 3; i++) add(0.18 + i * 0.22 + r() * 0.1, (r() - 0.5) * 1.4, 0.45 + r() * 0.3, 1.3 + r() * 0.8, "#f1ece2");
        break;
      }
      case "Tancho":
        add(0.1, 0, 0.62, 1.05, "#d63c2a");
        break;
      case "Asagi":
        for (let i = 0; i < 4; i++) {
          const t = 0.14 + i * 0.18;
          add(t, 1.0, 0.5, 2.6, red); add(t, -1.0, 0.5, 2.6, red);
        }
        add(0.03, 0.75, 0.32, 1.4, red); add(0.03, -0.75, 0.32, 1.4, red);
        break;
      default:
        break;
    }
    return P;
  }

  let koi = [];
  let koiLen = 140;
  function makeKoi(v, x, y, seed) {
    const r = mulberry32(seed);
    const L = koiLen * (0.82 + r() * 0.32);
    const N = 14;
    const seg = L / (N - 1);
    const h = r() * TAU;
    const sp = [];
    for (let i = 0; i < N; i++) sp.push({ x: x - Math.cos(h) * seg * i, y: y - Math.sin(h) * seg * i });
    return {
      v, L, W: L * 0.12, N, seg, sp, h,
      speed: 0, cruise: L * (0.3 + r() * 0.12) * (reduceMotion ? 0.6 : 1),
      phase: r() * TAU, wAng: r() * TAU, mood: r() * TAU,
      patches: genPatches(v, r),
      fin: v.butterfly ? 1.75 : 1,
      alarm: 0
    };
  }
  function spineAt(k, t) {
    const f = t * (k.N - 1);
    const i = Math.min(Math.floor(f), k.N - 2);
    const u = f - i;
    const a = k.sp[i], b = k.sp[i + 1];
    let tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len; ty /= len;
    const wave = Math.sin(k.phase - t * 5.2) * k.W * 0.55 * t * t;
    return { x: a.x + (b.x - a.x) * u - ty * wave, y: a.y + (b.y - a.y) * u + tx * wave, tx, ty };
  }
  function widthAt(t) {
    if (t < 0.28) return Math.pow(Math.sin((t / 0.28) * Math.PI / 2), 0.55);
    return 0.13 + 0.87 * Math.pow(1 - (t - 0.28) / 0.72, 1.45);
  }
  function smoothClosed(ctx, pts) {
    const n = pts.length;
    ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    ctx.closePath();
  }
  function strokeSpine(ctx, frames, from, to) {
    ctx.beginPath();
    ctx.moveTo(frames[from].x, frames[from].y);
    for (let s = from + 1; s <= to; s++) ctx.lineTo(frames[s].x, frames[s].y);
    ctx.stroke();
  }
  // pectoral and pelvic fins: [t along spine, length, splay angle, flap amount, width]
  const FINS = [[0.24, 1.05, 1.2, 0.95, 0.5], [0.56, 0.62, 0.7, 0.55, 0.3]];
  function finEllipse(ctx, bx, by, ang, len, wid) {
    ctx.beginPath();
    ctx.ellipse(bx + Math.cos(ang) * len * 0.5, by + Math.sin(ang) * len * 0.5, len * 0.5, wid, ang, 0, TAU);
  }
  function drawKoi(ctx, k, shadow) {
    const S = 24, left = [], right = [];
    const frames = [];
    for (let s = 0; s <= S; s++) {
      const t = s / S;
      const f = spineAt(k, t);
      frames.push(f);
      const w = widthAt(t) * k.W;
      left.push([f.x - f.ty * w, f.y + f.tx * w]);
      right.push([f.x + f.ty * w, f.y - f.tx * w]);
    }
    const outline = left.concat(right.reverse());
    const W = k.W, ph = k.phase;

    // fins first (under the body)
    ctx.save();
    ctx.globalAlpha = shadow ? 1 : (k.v.butterfly ? 0.55 : 0.62);
    ctx.fillStyle = shadow ? "#000" : k.v.fin;
    for (const [t, len, open, flap, wid] of FINS) {
      const f = frames[Math.round(t * S)];
      const base = Math.atan2(f.ty, f.tx);
      for (const side of [1, -1]) {
        const w = widthAt(t) * W * 0.7;
        const bx = f.x - f.ty * w * side, by = f.y + f.tx * w * side;
        const ang = base + side * (open + Math.sin(ph * 0.55 + side) * 0.22 * flap);
        finEllipse(ctx, bx, by, ang, W * 1.35 * len * k.fin, W * wid * (k.v.butterfly ? 1.15 : 1));
        ctx.fill();
      }
    }
    // tail
    const tf = frames[S];
    const tAng = Math.atan2(tf.ty, tf.tx) + Math.cos(ph - 5.2) * 0.45;
    const tl = W * 2.7 * (k.v.butterfly ? 1.45 : 1);
    const ex = (a, l) => [tf.x + Math.cos(tAng + a) * l, tf.y + Math.sin(tAng + a) * l];
    const tipL = ex(0.62, tl), tipR = ex(-0.62, tl), notch = ex(0, tl * 0.58);
    const cL = ex(0.5, tl * 0.7), cR = ex(-0.5, tl * 0.7);
    ctx.beginPath();
    ctx.moveTo(tf.x, tf.y);
    ctx.quadraticCurveTo(cL[0], cL[1], tipL[0], tipL[1]);
    const bl = ex(0.3, tl * 0.9), br = ex(-0.3, tl * 0.9);
    ctx.quadraticCurveTo(bl[0], bl[1], notch[0], notch[1]);
    ctx.quadraticCurveTo(br[0], br[1], tipR[0], tipR[1]);
    ctx.quadraticCurveTo(cR[0], cR[1], tf.x, tf.y);
    ctx.fill();
    ctx.restore();

    // body
    ctx.beginPath();
    smoothClosed(ctx, outline);
    if (shadow) { ctx.fillStyle = "#000"; ctx.fill(); return; }
    ctx.save();
    ctx.fillStyle = k.v.base;
    ctx.fill();
    ctx.clip();
    for (const p of k.patches) {
      const f = frames[Math.round(clamp(p.t, 0, 1) * S)];
      const w = widthAt(p.t) * W;
      const cx = f.x - f.ty * p.s * w, cy = f.y + f.tx * p.s * w;
      ctx.fillStyle = p.c;
      ctx.beginPath();
      ctx.ellipse(cx, cy, W * p.r * p.el * 0.6, W * p.r * 0.6, Math.atan2(f.ty, f.tx) + p.rot, 0, TAU);
      ctx.fill();
    }
    if (k.v.metal) {
      const g = ctx.createLinearGradient(frames[2].x, frames[2].y, frames[16].x, frames[16].y);
      g.addColorStop(0, "rgba(255,240,190,0.55)");
      g.addColorStop(0.5, "rgba(255,220,140,0.1)");
      g.addColorStop(1, "rgba(160,90,10,0.25)");
      ctx.fillStyle = g; ctx.fill();
    }
    // back ridge sheen
    ctx.lineCap = "round";
    ctx.strokeStyle = k.v.metal ? "rgba(255,248,215,0.4)" : "rgba(255,255,255,0.16)";
    ctx.lineWidth = W * 0.5;
    strokeSpine(ctx, frames, 2, 18);
    // rim shading
    ctx.strokeStyle = "rgba(4,22,20,0.26)";
    ctx.lineWidth = W * 0.55;
    ctx.beginPath(); smoothClosed(ctx, outline); ctx.stroke();
    ctx.restore();

    // dorsal ridge
    ctx.strokeStyle = k.v.name === "Showa" ? "rgba(255,255,255,0.12)" : "rgba(30,20,15,0.18)";
    ctx.lineWidth = W * 0.14; ctx.lineCap = "round";
    strokeSpine(ctx, frames, 8, 15);
    // eyes + barbels
    const hf = frames[2], h0 = frames[0];
    const ew = widthAt(2 / S) * W * 0.62;
    ctx.fillStyle = "#121010";
    for (const side of [1, -1]) {
      ctx.beginPath();
      ctx.arc(hf.x - hf.ty * ew * side, hf.y + hf.tx * ew * side, W * 0.085, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(60,40,30,0.45)";
    ctx.lineWidth = Math.max(0.8, W * 0.05);
    for (const side of [1, -1]) {
      const bx = h0.x + hf.tx * W * 0.15 - hf.ty * W * 0.12 * side;
      const by = h0.y + hf.ty * W * 0.15 + hf.tx * W * 0.12 * side;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - hf.tx * W * 0.25 - hf.ty * W * 0.3 * side, by - hf.ty * W * 0.25 + hf.tx * W * 0.3 * side);
      ctx.stroke();
    }
  }

  // ---------- floating things ----------
  let floaters = [];
  let food = [];
  const scares = [];
  const MAPLE_COLS = ["#c63a22", "#d9572a", "#b4262b", "#e07b2b", "#cf4a2e"];
  function makeFloaters() {
    const r = mulberry32(42);
    floaters = [];
    const padR = clamp(Math.min(W, H) * 0.075, 32, 74);
    const nPads = W * H > 700000 ? 6 : 4;
    const spots = [[0.82, 0.22], [0.12, 0.72], [0.9, 0.78], [0.62, 0.9], [0.3, 0.15], [0.07, 0.38]];
    for (let i = 0; i < nPads; i++) {
      const [sx, sy] = spots[i];
      floaters.push({
        kind: "pad", x: sx * W + (r() - 0.5) * 40, y: sy * H + (r() - 0.5) * 40, r: padR * (0.75 + r() * 0.45),
        vx: 0, vy: 0, rot: r() * TAU, av: 0, m: 1, seed: r() * 100,
        blemish: Array.from({ length: 2 + Math.floor(r() * 4) }, () => [r() * TAU, 0.5 + r() * 0.45, 0.08 + r() * 0.14]),
        tone: r()
      });
    }
    const nLeaves = W * H > 700000 ? 9 : 6;
    for (let i = 0; i < nLeaves; i++) {
      const gink = r() < 0.3;
      floaters.push({
        kind: gink ? "ginkgo" : "maple", x: r() * W, y: r() * H, r: (gink ? 13 : 16) + r() * 7,
        vx: 0, vy: 0, rot: r() * TAU, av: 0, m: 0.3, seed: r() * 100,
        col: gink ? (r() < 0.5 ? "#e4b73c" : "#d9a52c") : pick(MAPLE_COLS, r)
      });
    }
  }
  function drawPad(ctx, p, bob) {
    ctx.save();
    ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    const R = p.r * (1 + bob);
    const notch = 0.2;
    const path = () => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, notch, TAU - notch); ctx.closePath(); };
    path();
    const g = ctx.createRadialGradient(-R * 0.25, -R * 0.25, R * 0.05, 0, 0, R);
    const autumn = p.tone > 0.55;
    g.addColorStop(0, autumn ? "#8ea24c" : "#6f9c4c");
    g.addColorStop(0.75, autumn ? "#5d7a33" : "#3f6d34");
    g.addColorStop(1, autumn ? "#6b6a2a" : "#345c2c");
    ctx.fillStyle = g; ctx.fill();
    ctx.save(); ctx.clip();
    for (const [a, d, s] of p.blemish) {
      ctx.fillStyle = autumn ? "rgba(140,92,36,0.55)" : "rgba(120,110,40,0.35)";
      ctx.beginPath(); ctx.ellipse(Math.cos(a) * R * d, Math.sin(a) * R * d, R * s, R * s * 0.7, a, 0, TAU); ctx.fill();
    }
    ctx.strokeStyle = "rgba(220,236,180,0.22)"; ctx.lineWidth = 1;
    for (let i = 0; i < 15; i++) {
      const a = notch + 0.15 + (i / 14) * (TAU - 2 * notch - 0.3);
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.06, Math.sin(a) * R * 0.06);
      ctx.lineTo(Math.cos(a) * R * 0.9, Math.sin(a) * R * 0.9); ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,240,0.09)";
    ctx.beginPath(); ctx.ellipse(-R * 0.3, -R * 0.35, R * 0.45, R * 0.22, -0.6, 0, TAU); ctx.fill();
    ctx.restore();
    path();
    ctx.strokeStyle = autumn ? "rgba(70,60,20,0.8)" : "rgba(30,62,28,0.85)";
    ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
  }
  function drawLeaf(ctx, f) {
    ctx.save();
    ctx.translate(f.x, f.y); ctx.rotate(f.rot);
    leafPath(ctx, f.kind, f.r);
    ctx.fillStyle = f.col; ctx.fill();
    ctx.strokeStyle = "rgba(60,15,5,0.35)"; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.strokeStyle = f.kind === "maple" ? "rgba(90,20,10,0.4)" : "rgba(130,90,10,0.35)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    if (f.kind === "maple") {
      for (const [a, len] of MAPLE_LOBES) {
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a * DEG) * f.r * len * 0.85, Math.sin(a * DEG) * f.r * len * 0.85);
      }
      ctx.moveTo(0, 0); ctx.lineTo(0, f.r * 0.55);
    } else {
      for (let i = 0; i < 7; i++) {
        const a = (-145 + i * 18.5) * DEG;
        ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * f.r * 0.92, Math.sin(a) * f.r * 0.92);
      }
      ctx.moveTo(0, 0); ctx.lineTo(0, f.r * 0.5);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(255,240,220,0.14)";
    ctx.beginPath(); ctx.ellipse(-f.r * 0.2, -f.r * 0.45, f.r * 0.3, f.r * 0.12, -0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }
  function drawPellet(ctx, p) {
    const a = clamp(Math.min(p.age * 4, (40 - p.age) / 4), 0, 1);
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.arc(p.x + 1, p.y + 1.5, 3.4, 0, TAU); ctx.fill();
    ctx.fillStyle = "#8b5a2b";
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,226,180,0.55)";
    ctx.beginPath(); ctx.arc(p.x - 1, p.y - 1, 1.1, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---------- sound (Web Audio, all synthesized) ----------
  const sound = (() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    let ac = null, master, noise, swish, swishPan = null, nextBubble = 0, burst = 0, burstT = 0;
    let muted = false;
    try { muted = localStorage.getItem("koi-muted") === "1"; } catch {}

    function loopNoise(type, freq, q, level, dest = master) {
      const src = ac.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain(); g.gain.value = level;
      src.connect(f); f.connect(g); g.connect(dest);
      src.start(0, Math.random() * 4); // offset so the layers don't share a phase
      return { f, g };
    }
    function lfo(param, rate, depth) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = rate; g.gain.value = depth;
      o.connect(g); g.connect(param); o.start();
    }
    function init() {
      if (ac || !AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0;
      const comp = ac.createDynamicsCompressor();
      master.connect(comp); comp.connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // ambient bed: a low water murmur and a breeze in the leaves, both slowly swelling
      const murmur = loopNoise("lowpass", 260, 0.7, 0.55);
      lfo(murmur.g.gain, 0.07, 0.18);
      const breeze = loopNoise("bandpass", 900, 0.5, 0.05);
      lfo(breeze.g.gain, 0.05, 0.035);
      lfo(breeze.f.frequency, 0.03, 300);
      // hand through the water: a low wash that laps unevenly, plus bubbles (see setSwish)
      const soften = ac.createBiquadFilter(); soften.type = "lowpass"; soften.frequency.value = 900;
      const lap = ac.createGain(); lap.gain.value = 0.75;
      lfo(lap.gain, 1.1, 0.15); lfo(lap.gain, 0.43, 0.1);
      lap.connect(soften);
      if (ac.createStereoPanner) { swishPan = ac.createStereoPanner(); soften.connect(swishPan); swishPan.connect(master); }
      else soften.connect(master);
      swish = loopNoise("lowpass", 300, 0.5, 0, lap);
      apply();
    }
    function apply() {
      if (!ac) return;
      const on = !muted && !document.hidden;
      if (on) ac.resume();
      master.gain.setTargetAtTime(on ? 1 : 0, ac.currentTime, 0.08);
      if (!on) setTimeout(() => { if (muted || document.hidden) ac.suspend(); }, 300);
    }
    // caps how many one-shots can pile up at once (a tap fires ~8)
    function ready() {
      if (!ac || muted || ac.state !== "running") return false;
      const now = ac.currentTime;
      if (now - burstT > 0.08) { burstT = now; burst = 0; }
      return ++burst <= 10;
    }
    const panFor = (x) => clamp((x / W) * 2 - 1, -1, 1) * 0.7;
    function out(x) {
      if (!ac.createStereoPanner) return master;
      const p = ac.createStereoPanner();
      p.pan.value = panFor(x);
      p.connect(master);
      return p;
    }
    // a water drop: a sine whose pitch jumps up as the bubble closes
    function plop(x, vol, pitch = 1, delay = 0) {
      if (!ready()) return;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator(), g = ac.createGain();
      const f0 = 420 * pitch * (0.85 + rand() * 0.3);
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 2.6, t + 0.07);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g); g.connect(out(x));
      o.start(t); o.stop(t + 0.14);
    }
    // a small bubble: a quick, soft upward chirp; pitch is set by bubble size
    function bubble(x, vol) {
      if (!ready()) return;
      const t = ac.currentTime;
      const f0 = 300 + rand() * 600, len = 0.04 + rand() * 0.06;
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + len);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g); g.connect(out(x));
      o.start(t); o.stop(t + len + 0.02);
    }
    function splash(x, vol) {
      if (!ready()) return;
      const t = ac.currentTime;
      const src = ac.createBufferSource(); src.buffer = noise;
      const f = ac.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.8;
      f.frequency.setValueAtTime(2200, t);
      f.frequency.exponentialRampToValueAtTime(700, t + 0.25);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      src.connect(f); f.connect(g); g.connect(out(x));
      src.start(t, rand() * 3); src.stop(t + 0.32);
    }
    function setSwish(speed, x) {
      if (!ac) return;
      const t = ac.currentTime, s = clamp(speed / 1500, 0, 1);
      const target = Math.sqrt(s) * 0.6; // sqrt so slow strokes are still audible
      // swells in gently, settles slowly after the hand stops
      swish.g.gain.setTargetAtTime(target, t, target > swish.g.gain.value ? 0.12 : 0.4);
      swish.f.frequency.setTargetAtTime(280 + s * 420, t, 0.2);
      if (s < 0.02) return;
      if (swishPan) swishPan.pan.setTargetAtTime(panFor(x), t, 0.1);
      // the burble: more bubbles the faster the hand moves
      if (t >= nextBubble) {
        nextBubble = t + (0.03 + rand() * 0.12) / (0.3 + s);
        bubble(x + (rand() - 0.5) * 40, 0.015 + s * 0.04);
      }
    }
    function setMuted(m) {
      muted = m;
      try { localStorage.setItem("koi-muted", m ? "1" : "0"); } catch {}
      if (!m) init();
      apply();
    }
    document.addEventListener("visibilitychange", apply);
    return { supported: !!AC, unlock: init, plop, splash, setSwish, setMuted, isMuted: () => muted };
  })();

  const soundBtn = document.getElementById("sound");
  if (!sound.supported) soundBtn.hidden = true;
  const syncSoundBtn = () => soundBtn.setAttribute("aria-pressed", String(!sound.isMuted()));
  const toggleSound = () => { sound.setMuted(!sound.isMuted()); syncSoundBtn(); };
  syncSoundBtn();
  soundBtn.addEventListener("click", toggleSound);
  window.addEventListener("keydown", (e) => {
    if ((e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey && !e.altKey) toggleSound();
  });

  // ---------- pointers ----------
  const pointers = new Map();
  const FINGER = 17;
  let touched = false;
  pondEl.addEventListener("pointerdown", (e) => {
    pondEl.setPointerCapture?.(e.pointerId);
    const now = performance.now();
    const p = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY,
      vx: 0, vy: 0, t0: now, lastMove: now, lastT: now, moved: 0 };
    pointers.set(e.pointerId, p);
    pondEl.classList.add("pressing");
    disturb(p.x, p.y, FINGER * 1.1, -2.2);
    sound.unlock();
    sound.plop(p.x, 0.08, 0.6);
    if (!touched) { touched = true; document.getElementById("ui").classList.add("touched"); }
  });
  pondEl.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const now = performance.now();
    const dt = Math.max(1, now - p.lastT) / 1000;
    const dx = e.clientX - p.x, dy = e.clientY - p.y, d = Math.hypot(dx, dy);
    p.vx += (dx / dt - p.vx) * 0.5; p.vy += (dy / dt - p.vy) * 0.5;
    p.x = e.clientX; p.y = e.clientY; p.lastT = now;
    p.moved += d;
    if (d > 0.5) p.lastMove = now;
  });
  function release(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (!pointers.size) pondEl.classList.remove("pressing");
    sound.unlock(); // iOS only unlocks audio on touch end
    if (e.type === "pointerup" && p.moved < 8 && performance.now() - p.t0 < 350) scatterFood(p.x, p.y);
  }
  pondEl.addEventListener("pointerup", release);
  pondEl.addEventListener("pointercancel", release);

  function scatterFood(x, y) {
    scares.push({ x, y, t: time });
    sound.splash(x, 0.22);
    const n = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = rand() * TAU, d = rand() * 26;
      const fx = x + Math.cos(a) * d, fy = y + Math.sin(a) * d;
      food.push({ x: fx, y: fy, vx: Math.cos(a) * 20, vy: Math.sin(a) * 20, r: 3, m: 0.15, seed: 0, av: 0, age: 0 });
      disturb(fx, fy, 7, -1.1);
      sound.plop(fx, 0.09, 1.4, 0.02 + rand() * 0.12);
    }
    if (food.length > 60) food.splice(0, food.length - 60);
  }

  function handlePointers() {
    const now = performance.now();
    let fastest = 0, fastestX = 0;
    for (const p of pointers.values()) {
      if (now - p.lastMove > 60) { p.vx *= 0.8; p.vy *= 0.8; }
      const dx = p.x - p.lx, dy = p.y - p.ly;
      const dist = Math.hypot(dx, dy);
      const speed = Math.hypot(p.vx, p.vy);
      if (dist > 0.5) {
        if (speed > fastest) { fastest = speed; fastestX = p.x; }
        const steps = Math.ceil(dist / (FINGER * 0.35));
        const ux = dx / dist, uy = dy / dist;
        const amp = clamp(0.45 + speed * 0.001, 0.45, 1.5);
        for (let s = 1; s <= steps; s++) {
          const x = p.lx + dx * (s / steps), y = p.ly + dy * (s / steps);
          disturb(x, y, FINGER, -amp);
          disturb(x + ux * FINGER * 0.9, y + uy * FINGER * 0.9, FINGER * 0.75, amp * 0.5);
        }
      } else {
        // a still finger keeps a faint pulse going
        disturb(p.x, p.y, FINGER * 0.8, Math.sin(time * 9) * 0.06);
      }
      p.lx = p.x; p.ly = p.y;
    }
    sound.setSwish(fastest, fastestX);
  }

  // ---------- updates ----------
  function updateKoi(dt) {
    const now = performance.now();
    for (const k of koi) {
      const head = k.sp[0];
      let sx = Math.cos(k.h), sy = Math.sin(k.h);
      k.wAng += (rand() - 0.5) * dt * 2.6;
      sx += Math.cos(k.wAng) * 0.55; sy += Math.sin(k.wAng) * 0.55;
      const m = k.L * 0.9;
      if (head.x < m) sx += ((m - head.x) / m) * 2.6;
      if (head.x > W - m) sx -= ((head.x - (W - m)) / m) * 2.6;
      if (head.y < m) sy += ((m - head.y) / m) * 2.6;
      if (head.y > H - m) sy -= ((head.y - (H - m)) / m) * 2.6;
      for (const o of koi) {
        if (o === k) continue;
        const c = o.sp[4];
        const dx = head.x - c.x, dy = head.y - c.y, d = Math.hypot(dx, dy) || 1;
        const R = (k.L + o.L) * 0.4;
        if (d < R) { const f = (1 - d / R) * 1.3; sx += (dx / d) * f; sy += (dy / d) * f; }
      }
      let tSpeed = k.cruise * (0.7 + 0.35 * Math.sin(time * 0.27 + k.mood));
      let alarm = 0;
      for (const p of pointers.values()) {
        const active = now - p.lastMove < 450 || now - p.t0 < 350;
        if (!active) continue;
        const dx = head.x - p.x, dy = head.y - p.y, d = Math.hypot(dx, dy) || 1;
        const R = k.L * 2.1;
        if (d < R) { const f = 1 - d / R; sx += (dx / d) * f * 6; sy += (dy / d) * f * 6; alarm = Math.max(alarm, f); }
      }
      for (const s of scares) {
        const age = time - s.t;
        if (age > 0.6) continue;
        const dx = head.x - s.x, dy = head.y - s.y, d = Math.hypot(dx, dy) || 1;
        const R = k.L * 1.1;
        if (d < R) { const f = (1 - d / R) * (1 - age / 0.6); sx += (dx / d) * f * 5; sy += (dy / d) * f * 5; alarm = Math.max(alarm, f * 0.7); }
      }
      k.alarm = Math.max(alarm, k.alarm - dt * 0.6);
      if (k.alarm > 0.02) tSpeed = Math.max(tSpeed, k.cruise * (1.4 + k.alarm * 4));
      else if (food.length) {
        let best = null, bd = k.L * 7;
        for (const p of food) {
          if (p.age < 0.9) continue;
          const d = Math.hypot(p.x - head.x, p.y - head.y);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) {
          const dx = best.x - head.x, dy = best.y - head.y, d = bd || 1;
          sx += (dx / d) * 2.6; sy += (dy / d) * 2.6;
          tSpeed = k.cruise * (0.55 + Math.min(1.2, d / (k.L * 0.8)));
          if (d < k.W * 1.1) {
            food.splice(food.indexOf(best), 1);
            disturb(best.x, best.y, 10, -1.4);
            disturb(best.x, best.y, 5, 0.9);
            sound.plop(best.x, 0.14, 0.55);
          }
        }
      }
      const target = Math.atan2(sy, sx);
      const diff = wrapAngle(target - k.h);
      const maxTurn = (1.5 + k.alarm * 3.5) * dt;
      k.h = wrapAngle(k.h + clamp(diff, -maxTurn, maxTurn));
      k.speed += (tSpeed - k.speed) * Math.min(1, dt * (tSpeed > k.speed ? 3.2 : 1.1));
      k.phase += dt * (2.6 + (k.speed / k.L) * 7.5);
      const mv = k.h + Math.sin(k.phase) * 0.16;
      head.x += Math.cos(mv) * k.speed * dt;
      head.y += Math.sin(mv) * k.speed * dt;
      for (let i = 1; i < k.N; i++) {
        const a = k.sp[i - 1], b = k.sp[i];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        b.x = a.x + (dx / d) * k.seg; b.y = a.y + (dy / d) * k.seg;
      }
      // a darting fish leaves a faint swirl on the surface above it
      if (k.speed > k.cruise * 1.6) disturb(k.sp[3].x, k.sp[3].y, k.W * 1.6, -0.03 * (k.speed / k.cruise));
    }
    while (scares.length && time - scares[0].t > 1) scares.shift();
  }

  function pushFromPointers(f, dt, reachExtra) {
    for (const p of pointers.values()) {
      const dx = f.x - p.x, dy = f.y - p.y, d = Math.hypot(dx, dy) || 1;
      const reach = f.r + FINGER + reachExtra;
      if (d < reach) {
        const o = 1 - d / reach;
        const c = Math.min(1, o * 7 * dt / f.m);
        f.vx += (p.vx * 0.9 - f.vx) * c; f.vy += (p.vy * 0.9 - f.vy) * c;
        f.vx += (dx / d) * o * 160 * dt / f.m; f.vy += (dy / d) * o * 160 * dt / f.m;
        f.av += ((dx * p.vy - dy * p.vx) / (d * reach)) * o * 0.04 * dt / f.m;
      }
    }
  }
  function moveFloater(f, dt, drag) {
    const [gx, gy] = gradAt(f.x, f.y);
    f.vx -= gx * 260 * dt / f.m; f.vy -= gy * 260 * dt / f.m;
    f.vx += Math.cos(time * 0.07 + f.seed) * 3 * dt;
    f.vy += Math.sin(time * 0.05 + f.seed * 1.3) * 3 * dt;
    const damp = Math.exp(-dt * drag);
    f.vx *= damp; f.vy *= damp;
    const sp = Math.hypot(f.vx, f.vy);
    if (sp > 900) { f.vx *= 900 / sp; f.vy *= 900 / sp; }
    f.x += f.vx * dt; f.y += f.vy * dt;
    const m = f.r * 0.6;
    if (f.x < m) f.vx += (m - f.x) * 8 * dt;
    if (f.x > W - m) f.vx -= (f.x - (W - m)) * 8 * dt;
    if (f.y < m) f.vy += (m - f.y) * 8 * dt;
    if (f.y > H - m) f.vy -= (f.y - (H - m)) * 8 * dt;
    f.x = clamp(f.x, -f.r, W + f.r); f.y = clamp(f.y, -f.r, H + f.r);
    return sp;
  }
  function updateFloaters(dt) {
    for (const f of floaters) {
      pushFromPointers(f, dt, 0);
      const sp = moveFloater(f, dt, f.kind === "pad" ? 0.9 : 1.4);
      f.rot += f.av * dt;
      f.av *= Math.exp(-dt * 1.2);
      f.av += Math.sin(time * 0.2 + f.seed) * 0.004 * dt;
      if (sp > 60) {
        const ux = f.vx / sp, uy = f.vy / sp;
        disturb(f.x + ux * f.r * 0.9, f.y + uy * f.r * 0.9, Math.max(6, f.r * 0.35), Math.min(0.35, sp * 0.0012));
      }
    }
    for (let i = 0; i < floaters.length; i++) {
      for (let j = i + 1; j < floaters.length; j++) {
        const a = floaters[i], b = floaters[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        const min = (a.r + b.r) * 0.85;
        if (d < min) {
          const push = ((min - d) / min) * 440 * dt / (a.m + b.m), ux = dx / d, uy = dy / d;
          a.vx -= ux * push * b.m; a.vy -= uy * push * b.m;
          b.vx += ux * push * a.m; b.vy += uy * push * a.m;
        }
      }
    }
    for (let i = food.length - 1; i >= 0; i--) {
      const p = food[i];
      p.age += dt;
      pushFromPointers(p, dt, 4);
      moveFloater(p, dt, 2.2);
      if (p.age > 40) food.splice(i, 1);
    }
  }

  let nextDrip = 1.2;
  function ambient(dt) {
    if (reduceMotion) return;
    nextDrip -= dt;
    if (nextDrip <= 0) {
      nextDrip = 2.5 + rand() * 5;
      const x = rand() * W;
      disturb(x, rand() * H, 5, -1.3);
      sound.plop(x, 0.16);
    }
  }

  // ---------- drawing ----------
  function drawScene() {
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.drawImage(floorC, 0, 0);
    // shadows on the pond floor
    shctx.setTransform(1, 0, 0, 1, 0, 0);
    shctx.clearRect(0, 0, shadowC.width, shadowC.height);
    shctx.setTransform(SHS, 0, 0, SHS, 0, 0);
    shctx.fillStyle = "#000";
    for (const f of floaters) {
      shctx.save();
      shctx.translate(30, 38);
      if (f.kind === "pad") {
        shctx.beginPath(); shctx.arc(f.x, f.y, f.r, 0, TAU);
      } else {
        shctx.translate(f.x, f.y); shctx.rotate(f.rot);
        leafPath(shctx, f.kind, f.r);
      }
      shctx.fill();
      shctx.restore();
    }
    shctx.save();
    shctx.translate(14, 18);
    for (const k of koi) drawKoi(shctx, k, true);
    shctx.restore();
    sctx.globalAlpha = 0.38;
    sctx.drawImage(shadowC, 0, 0, sceneC.width, sceneC.height);
    sctx.globalAlpha = 1;
    sctx.setTransform(SS, 0, 0, SS, 0, 0);
    for (const k of koi) drawKoi(sctx, k, false);
  }
  function drawOverlay() {
    tctx.setTransform(1, 0, 0, 1, 0, 0);
    tctx.clearRect(0, 0, topCanvas.width, topCanvas.height);
    tctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const p of food) drawPellet(tctx, p);
    for (const f of floaters) {
      // a soft contact shadow right on the surface
      tctx.fillStyle = "rgba(0,10,8,0.18)";
      tctx.beginPath(); tctx.arc(f.x + 2, f.y + 3, f.r * (f.kind === "pad" ? 1.01 : 0.7), 0, TAU); tctx.fill();
      if (f.kind === "pad") {
        const g = gradAt(f.x, f.y);
        drawPad(tctx, f, clamp(g[2] * 0.012, -0.03, 0.03));
      } else drawLeaf(tctx, f);
    }
  }

  // ---------- WebGL composite ----------
  let gl = null, prog, texScene, texWater, waterAllocated = false;
  const uLoc = {};
  const VS = "attribute vec2 p;varying vec2 vUv;void main(){vUv=vec2(p.x*0.5+0.5,0.5-p.y*0.5);gl_Position=vec4(p,0.0,1.0);}";
  const FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene, uWater;
uniform vec2 uRes, uWScale, uWOff;
uniform float uTime;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}
float caustic(vec2 uv,float t){
  vec2 p=mod(uv*6.2831853,6.2831853)-250.0;
  vec2 i=p;float c=1.0;float inten=0.005;
  for(int n=0;n<4;n++){
    float tt=t*(1.0-(3.5/float(n+1)));
    i=p+vec2(cos(tt-i.x)+sin(tt+i.y),sin(tt-i.y)+cos(tt+i.x));
    c+=1.0/length(vec2(p.x/(sin(i.x+tt)/inten),p.y/(cos(i.y+tt)/inten)));
  }
  c/=4.0;c=1.17-pow(c,1.4);
  return clamp(pow(abs(c),8.0),0.0,1.0);
}
void main(){
  vec4 w=texture2D(uWater,vUv*uWScale+uWOff);
  vec2 n=(w.rg-0.5)*2.0;
  float h=(w.b-0.5)*2.0;
  float focus=(w.a-0.5)*2.0;
  vec2 px=vUv*uRes;
  float t=uTime;
  vec2 amb=vec2(noise(px*0.007+vec2(t*0.18,0.0))-0.5,noise(px*0.007+vec2(7.3,t*0.15))-0.5)*0.28;
  amb+=vec2(noise(px*0.02-vec2(t*0.3,0.0))-0.5,noise(px*0.02+vec2(3.1,-t*0.25))-0.5)*0.08;
  vec2 nn=n+amb;
  vec2 off=nn*26.0/uRes;
  vec3 col;
  col.r=texture2D(uScene,vUv+off*1.06).r;
  col.g=texture2D(uScene,vUv+off).g;
  col.b=texture2D(uScene,vUv+off*0.94).b;
  float ca=caustic((px+nn*30.0)/560.0,t*0.32);
  vec3 sun=vec3(1.0,0.93,0.74);
  col+=sun*(ca*0.11+clamp(focus,-0.6,1.0)*0.22)*(0.55+0.45*col);
  float d=length((vUv-0.5)*vec2(uRes.x/uRes.y,1.0));
  vec3 deep=vec3(0.02,0.1,0.1);
  col=mix(col,deep,0.24+d*0.12);
  float dap=smoothstep(0.3,0.78,noise(px*0.0032+vec2(t*0.018,-t*0.013)));
  col*=0.76+dap*0.36;
  vec3 N=normalize(vec3(-nn*1.3,1.0));
  vec3 L=normalize(vec3(-0.45,-0.6,0.66));
  vec3 Hh=normalize(L+vec3(0.0,0.0,1.0));
  float spec=pow(max(dot(N,Hh),0.0),110.0);
  float canopy=noise(px*0.004+vec2(-t*0.01,t*0.008));
  vec3 sky=mix(vec3(0.42,0.6,0.58),vec3(0.95,0.55,0.28),smoothstep(0.45,0.8,canopy));
  float slope=clamp(length(n)*0.6+0.04,0.0,0.6);
  col=mix(col,sky,slope*0.35);
  col+=spec*vec3(1.0,0.95,0.84)*1.1;
  col*=1.0-smoothstep(0.5,1.2,d)*0.5;
  gl_FragColor=vec4(col,1.0);
}`;
  function initGL() {
    try {
      gl = glCanvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    } catch { gl = null; }
    if (!gl) return false;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) { gl = null; return false; }
    prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); gl = null; return false; }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const mk = () => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    texScene = mk(); texWater = mk();
    for (const n of ["uScene", "uWater", "uRes", "uWScale", "uWOff", "uTime"]) uLoc[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(uLoc.uScene, 0); gl.uniform1i(uLoc.uWater, 1);
    return true;
  }
  function renderGL() {
    encodeWater();
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texScene);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sceneC);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texWater);
    if (!waterAllocated) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, wdata);
      waterAllocated = true;
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, wdata);
    gl.uniform2f(uLoc.uRes, W, H);
    gl.uniform2f(uLoc.uWScale, W / (cell * cols), H / (cell * rows));
    gl.uniform2f(uLoc.uWOff, 1.5 / cols, 1.5 / rows);
    gl.uniform1f(uLoc.uTime, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // ---------- setup ----------
  function buildRoster() {
    const ul = document.getElementById("roster");
    ul.innerHTML = "";
    for (const k of koi) {
      const li = document.createElement("li");
      const sw = document.createElement("i");
      sw.style.background = k.v.swatch;
      const zh = document.createElement("span");
      zh.lang = "zh-Hans";
      zh.textContent = k.v.zh;
      li.append(sw, zh, document.createTextNode(k.v.name));
      ul.append(li);
    }
  }
  function resize() {
    const oldW = W, oldH = H;
    W = window.innerWidth; H = window.innerHeight;
    SS = Math.min(DPR, 1.25);
    if (W * H * SS * SS > 2400000) SS = Math.sqrt(2400000 / (W * H));
    const GLS = Math.min(DPR, 1.75);
    glCanvas.width = Math.round(W * GLS); glCanvas.height = Math.round(H * GLS);
    topCanvas.width = Math.round(W * DPR); topCanvas.height = Math.round(H * DPR);
    sceneC.width = Math.round(W * SS); sceneC.height = Math.round(H * SS);
    shadowC.width = Math.max(1, Math.round(W * SHS)); shadowC.height = Math.max(1, Math.round(H * SHS));
    koiLen = clamp(Math.min(W, H) * 0.17, 84, 190);
    initWater();
    waterAllocated = false;
    buildFloor();
    if (!koi.length) {
      const count = W * H > 900000 ? 7 : W * H > 400000 ? 6 : 5;
      const order = [0, 3, 2, 4, 1, 5, 6, 7];
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU + 0.4;
        const x = W / 2 + Math.cos(a) * W * 0.26, y = H / 2 + Math.sin(a) * H * 0.24;
        koi.push(makeKoi(VARIETIES[order[i]], x, y, 101 + i * 17));
      }
      buildRoster();
      makeFloaters();
    } else {
      const sx = W / (oldW || W), sy = H / (oldH || H);
      for (const k of koi) for (const p of k.sp) { p.x *= sx; p.y *= sy; }
      for (const f of floaters) { f.x *= sx; f.y *= sy; }
      for (const f of food) { f.x *= sx; f.y *= sy; }
    }
  }

  const hasGL = initGL();
  if (!hasGL) {
    // fall back to showing the underwater scene directly
    glCanvas.replaceWith(sceneC);
  }
  resize();
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });

  // a few opening ripples so the surface is alive at first glance
  disturb(W * 0.58, H * 0.46, 8, -2.4);
  disturb(W * 0.3, H * 0.62, 6, -1.6);

  const WATER_STEP = 1 / 60, MAX_WATER_STEPS = 3;
  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; time += dt;
    handlePointers();
    updateKoi(dt);
    updateFloaters(dt);
    ambient(dt);
    acc += dt;
    let steps = 0;
    while (acc >= WATER_STEP && steps < MAX_WATER_STEPS) { stepWater(); acc -= WATER_STEP; steps++; }
    if (steps === MAX_WATER_STEPS) acc = 0;
    drawScene();
    drawOverlay();
    if (hasGL) renderGL();
    requestAnimationFrame(frame);
  }
  // settle the koi so they already look mid-swim
  for (let i = 0; i < 40; i++) { time += 1 / 30; updateKoi(1 / 30); }
  requestAnimationFrame(frame);
})();
