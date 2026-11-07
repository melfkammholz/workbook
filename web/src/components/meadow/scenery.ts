import { E, F, INK, P, curve, dot, line, mix, outline, pen, scale, screenTransform, view, viewW, visible, worldTransform } from './pen';
import type { Decor, DecorKind, Ellipse } from './types';
import { BIOMES, FLOE, H, HZ, PATH, POND, POOL, SHORE0, W, WORLD, biomeAt, clamp, depth, shoreX, type Flower } from './world';

const SHADOW = 'rgba(30,45,25,0.16)';
const PALETTES: readonly (readonly [string, string, string])[] = [
  ['#5e8f4a', '#6f9f57', '#7aab60'],
  ['#5b8c4c', '#6a9c55', '#78a85d'],
  ['#d99bb3', '#e8b3c6', '#f1c9d6'],
  ['#5f914a', '#6d9e52', '#7aab5d'],
  ['#3f7a44', '#4a8a4c', '#5a9a56'],
  ['#7fa391', '#8fb3a0', '#9cc0ad'],
];

function mushroom(x: number, y: number, s: number, red: boolean) {
  const ctx = pen.ctx;
  ctx.fillStyle = '#f2ead8'; ctx.beginPath(); ctx.roundRect(x - 1.4 * s, y - 6 * s, 2.8 * s, 6 * s, 1 * s); ctx.fill(); outline(0.7);
  ctx.beginPath(); ctx.ellipse(x, y - 5.5 * s, 5 * s, 4 * s, 0, Math.PI, 0); ctx.closePath(); ctx.fillStyle = red ? '#d6453d' : '#b9824f'; ctx.fill(); outline(0.7);
  if (red) { ctx.fillStyle = '#ffffff'; for (const [dx, dy] of [[-2.4, -7.2], [1.2, -8.4], [2.8, -6.6]] as const) { E(x + dx * s, y + dy * s, 0.8 * s, 0.7 * s); ctx.fill(); } }
}
function rock(x: number, y: number, s: number, moss: boolean) {
  const ctx = pen.ctx;
  ctx.fillStyle = SHADOW; E(x, y, 15 * s, 3 * s); ctx.fill();
  P([[x - 14 * s, y], [x - 11 * s, y - 9 * s], [x - 3 * s, y - 14 * s], [x + 8 * s, y - 12 * s], [x + 14 * s, y - 4 * s], [x + 13 * s, y]]);
  ctx.fillStyle = '#a5a9b1'; ctx.fill(); outline(1);
  P([[x - 9 * s, y - 9 * s], [x - 3 * s, y - 12.6 * s], [x + 7 * s, y - 11 * s], [x + 2 * s, y - 8 * s]]); ctx.fillStyle = '#bfc3ca'; ctx.fill();
  if (moss) { ctx.fillStyle = '#86ad69'; E(x - 8 * s, y - 2 * s, 4 * s, 1.6 * s); ctx.fill(); }
}

/** Everything that stands on the ground and is sorted by depth with the animals. */
export const DECOR: Record<DecorKind, (o: Decor, t: number) => void> = {
  round(o) {
    const ctx = pen.ctx, { x, y, s } = o, pal = PALETTES[o.palette ?? 0]!;
    ctx.fillStyle = SHADOW; E(x, y, 32 * s, 6 * s); ctx.fill();
    const bark = o.trunk ?? '#7a5a40';
    ctx.fillStyle = bark;
    P([[x - 7 * s, y], [x - 5 * s, y - 70 * s], [x + 5 * s, y - 70 * s], [x + 8 * s, y]]); ctx.fill(); outline(1.1);
    const branch = (x1: number, y1: number) => { ctx.fillStyle = bark; P([[x + 3 * s, y - 49 * s], [x1, y1 - 1.5 * s], [x1, y1 + 1.5 * s], [x + 4 * s, y - 44 * s]]); ctx.fill(); outline(1.1); };
    if (o.owl) branch(WORLD.perch.x + 10, WORLD.perch.gy - WORLD.perch.alt + 2.5);
    if (o.sloth) branch(WORLD.sloth.x + WORLD.sloth.span + 10 * s, WORLD.sloth.gy - WORLD.sloth.alt);
    for (const [dx, dy, r, c] of [[-22, -88, 26, 0], [20, -92, 24, 0], [-4, -110, 30, 1], [-14, -80, 20, 1], [14, -78, 18, 2]] as const) {
      E(x + dx * s, y + dy * s, r * s, r * 0.9 * s); ctx.fillStyle = pal[c]; ctx.fill(); outline(1.1);
    }
    if (o.vines) {
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const vx = x + (-24 + i * 9.5) * s, top = y - (66 - (i % 2) * 6) * s, len = (14 + ((i * 7) % 5) * 4) * s;
        ctx.strokeStyle = '#3d6b3c'; ctx.lineWidth = 1.1; line(vx, top, vx + Math.sin(i) * 1.5 * s, top + len);
        ctx.fillStyle = '#5a9a56';
        for (let j = 1; j <= 3; j++) { E(vx + (j % 2 ? 1.6 : -1.6) * s, top + (len * j) / 3.4, 1.6 * s, 0.9 * s, j % 2 ? 0.5 : -0.5); ctx.fill(); }
      }
    }
    if (o.koala) { ctx.fillStyle = bark; P([[x - 2 * s, y - 56 * s], [x - 16 * s, y - 62 * s], [x - 15 * s, y - 59 * s], [x - 1 * s, y - 53 * s]]); ctx.fill(); outline(1); }
    if (o.palette === 0 || o.palette === 2 || o.palette === 3) {
      ctx.fillStyle = o.palette === 2 ? '#fff4f8' : '#e04f45';
      for (const [dx, dy] of [[-18, -96], [10, -104], [22, -84], [-6, -76], [-28, -82], [4, -118]] as const) { E(x + dx * s, y + dy * s, 2.4 * s, 2.4 * s); ctx.fill(); }
    }
    if (o.palette === 3) { ctx.fillStyle = '#e04f45'; for (const dx of [-14, 9]) { E(x + dx * s, y + 2 * s, 2.6 * s, 2.3 * s); ctx.fill(); outline(0.6); } }
  },
  pine(o) {
    const ctx = pen.ctx, { x, y, s } = o;
    ctx.fillStyle = SHADOW; E(x, y, 22 * s, 5 * s); ctx.fill();
    ctx.fillStyle = '#6e4f36'; ctx.beginPath(); ctx.rect(x - 3 * s, y - 14 * s, 6 * s, 14 * s); ctx.fill(); outline(1);
    for (let i = 0; i < 4; i++) {
      const w = (26 - i * 5) * s, b = y - (10 + i * 15) * s, t = b - 26 * s;
      P([[x - w, b], [x, t], [x + w, b]]); ctx.fillStyle = i % 2 ? '#56864f' : '#4b7946'; ctx.fill(); outline(1);
    }
  },
  poplar(o, t) {
    // one tall, slightly swaying crown, with a few strokes for the leaves
    const ctx = pen.ctx, { x, y, s } = o, sway = Math.sin(t * 0.9 + o.x * 0.01) * 1.6 * s;
    ctx.fillStyle = SHADOW; E(x, y, 16 * s, 4 * s); ctx.fill();
    ctx.fillStyle = '#7a5a40'; P([[x - 3 * s, y], [x - 2 * s, y - 24 * s], [x + 2 * s, y - 24 * s], [x + 3 * s, y]]); ctx.fill(); outline(1);
    const c = o.seed > 5 ? ['#6f9f57', '#5e8f4a'] : ['#7aab60', '#679a50'];
    ctx.beginPath(); ctx.moveTo(x, y - 16 * s);
    ctx.bezierCurveTo(x - 15 * s, y - 26 * s, x - 12 * s + sway * 0.5, y - 76 * s, x + sway, y - 96 * s);
    ctx.bezierCurveTo(x + 12 * s + sway * 0.5, y - 76 * s, x + 15 * s, y - 26 * s, x, y - 16 * s);
    ctx.fillStyle = c[0]!; ctx.fill(); outline(1.1);
    ctx.strokeStyle = c[1]!; ctx.lineWidth = 1.2 * s; ctx.lineCap = 'round';
    for (const [dx, y0, len] of [[-6, -34, 10], [4, -42, 12], [-3, -56, 11], [6, -62, 9], [-5, -72, 8], [2, -80, 7]] as const) {
      const bx = x + dx * s + sway * (-y0 / 96);
      ctx.beginPath(); ctx.moveTo(bx, y + y0 * s); ctx.quadraticCurveTo(bx + 2 * s, y + (y0 - len / 2) * s, bx + 0.5 * s, y + (y0 - len) * s); ctx.stroke();
    }
  },
  acacia(o) {
    // a thin forked trunk and a flat, layered crown: the giraffe's favourite
    const ctx = pen.ctx, { x, y, s } = o;
    ctx.fillStyle = SHADOW; E(x, y, 32 * s, 5 * s); ctx.fill();
    ctx.fillStyle = '#7a5a40';
    P([[x - 2.6 * s, y], [x - 1.6 * s, y - 40 * s], [x - 15 * s, y - 74 * s], [x - 12 * s, y - 75 * s], [x, y - 50 * s], [x + 11 * s, y - 78 * s], [x + 14 * s, y - 77 * s], [x + 2.6 * s, y - 40 * s], [x + 3 * s, y]]); ctx.fill(); outline(1);
    for (const [dx, dy, rx, ry, c] of [[-9, -80, 29, 7, '#7d9a4a'], [12, -84, 25, 6, '#8aa857'], [1, -89, 20, 5, '#94b35f']] as const) { E(x + dx * s, y + dy * s, rx * s, ry * s); ctx.fillStyle = c; ctx.fill(); outline(1); }
  },
  termite(o) {
    const ctx = pen.ctx, { x, y, s } = o;
    ctx.fillStyle = SHADOW; E(x, y, 13 * s, 3 * s); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x - 10 * s, y); ctx.quadraticCurveTo(x - 8 * s, y - 14 * s, x - 3 * s, y - 24 * s); ctx.lineTo(x - 1 * s, y - 27 * s);
    ctx.quadraticCurveTo(x + 2 * s, y - 26 * s, x + 3 * s, y - 18 * s); ctx.quadraticCurveTo(x + 6 * s, y - 16 * s, x + 6 * s, y - 10 * s); ctx.quadraticCurveTo(x + 9 * s, y - 6 * s, x + 10 * s, y); ctx.closePath();
    ctx.fillStyle = '#c08f5f'; ctx.fill(); outline(1);
    ctx.fillStyle = '#a8774a'; for (const [dx, dy] of [[-4, -8], [1, -14], [-2, -19], [4, -6], [0, -4]] as const) { E(x + dx * s, y + dy * s, 1 * s, 0.7 * s); ctx.fill(); }
  },
  palm(o, t) {
    const ctx = pen.ctx, { x, y, s } = o, sway = Math.sin(t * 0.8 + o.x * 0.01) * 1.5 * s;
    const tx = x + 12 * s + sway, ty = y - 78 * s, cx = x + 1 * s, cy = y - 42 * s;
    const at = (q: number): [number, number] => [(1 - q) * (1 - q) * x + 2 * (1 - q) * q * cx + q * q * tx, (1 - q) * (1 - q) * y + 2 * (1 - q) * q * cy + q * q * ty];
    ctx.fillStyle = SHADOW; E(x + 6 * s, y, 22 * s, 4.5 * s); ctx.fill();
    // the trunk: a tapering, ringed band along the curve
    const n = 12, left: [number, number][] = [], right: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const q = i / n, [px, py] = at(q), [qx, qy] = at(Math.min(1, q + 0.02)), [rx, ry] = at(Math.max(0, q - 0.02));
      const dx = qx - rx, dy = qy - ry, l = Math.hypot(dx, dy) || 1, w = (4.2 - 1.8 * q) * s + (i === 0 ? 1.5 * s : 0);
      left.push([px - (dy / l) * w, py + (dx / l) * w]); right.push([px + (dy / l) * w, py - (dx / l) * w]);
    }
    P([...left, ...right.reverse()]); ctx.fillStyle = '#a3794d'; ctx.fill(); outline(1);
    ctx.strokeStyle = '#7d5a37'; ctx.lineWidth = 0.9;
    for (let i = 1; i < 11; i++) { const q = i / 11, [px, py] = at(q), w = (4.2 - 1.8 * q) * s; ctx.beginPath(); ctx.moveTo(px - w, py + 0.6 * s); ctx.quadraticCurveTo(px, py - 1.4 * s, px + w, py + 0.6 * s); ctx.stroke(); }
    // fronds: a midrib with leaflets, drooping under their own weight
    const frond = (ang: number, len: number, i: number, shade: string) => {
      const L = len * 1.3 * s, ex = tx + Math.cos(ang) * L, ey = ty + Math.sin(ang) * L * 0.5 + 9 * s + Math.sin(t * 1.1 + i) * 0.7 * s;
      const mx = tx + Math.cos(ang) * L * 0.5, my = ty + Math.sin(ang) * L * 0.4 - 6 * s;
      const pt = (q: number): [number, number] => [(1 - q) * (1 - q) * tx + 2 * (1 - q) * q * mx + q * q * ex, (1 - q) * (1 - q) * ty + 2 * (1 - q) * q * my + q * q * ey];
      const up: [number, number][] = [], down: [number, number][] = [], N = 14;
      for (let k = 0; k <= N; k++) {
        const q = k / N, [px, py] = pt(q), [qx, qy] = pt(Math.min(1, q + 0.03)), [rx, ry] = pt(Math.max(0, q - 0.03));
        const dx = qx - rx, dy = qy - ry, l = Math.hypot(dx, dy) || 1;
        const w = Math.sin(Math.PI * Math.min(1, q * 1.15)) * 5.2 * s * (k % 2 ? 1 : 0.55);
        up.push([px - (dy / l) * w + (dx / l) * w * 0.4, py + (dx / l) * w * 0.5 + w * 0.5]);
        down.push([px + (dy / l) * w + (dx / l) * w * 0.4, py - (dx / l) * w * 0.5 + w * 0.9]);
      }
      P([...up, ...down.reverse()]); ctx.fillStyle = shade; ctx.fill(); outline(0.8);
      ctx.strokeStyle = '#3f6e35'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.quadraticCurveTo(mx, my, ex, ey); ctx.stroke();
    };
    const back = [[-1.95, 15], [-1.25, 15], [0.15, 18]] as const;
    const front = [[-2.95, 24], [-2.55, 26], [-2.05, 22], [-1.65, 17], [-1.15, 21], [-0.65, 26], [-0.2, 24]] as const;
    back.forEach(([ang, len], i) => frond(ang, len, i + 7, '#4f8a44'));
    for (const [dx, dy, r, c] of [[-2, 2.4, 2, '#7a5a3a'], [1.6, 2.8, 1.9, '#6b4f33'], [0, 4, 1.8, '#86643f']] as const) { E(tx + dx * s, ty + dy * s, r * s, r * s); ctx.fillStyle = c; ctx.fill(); outline(0.6); }
    front.forEach(([ang, len], i) => frond(ang, len, i, i % 2 ? '#5f9a4e' : '#6fae58'));
  },
  bigleaf(o, t) {
    const ctx = pen.ctx, { x, y, s } = o;
    ctx.fillStyle = SHADOW; E(x, y, 16 * s, 3.5 * s); ctx.fill();
    [-2.5, -2.1, -1.6, -1.1, -0.65].forEach((ang, i) => {
      const a0 = ang + Math.sin(t * 1.1 + i + o.x) * 0.06, L = (14 + (i % 2) * 4) * s;
      const lx = x + Math.cos(a0) * L, ly = y + Math.sin(a0) * L * 0.9 - 4 * s;
      ctx.strokeStyle = '#3f7a44'; ctx.lineWidth = 1.2; line(x, y, lx, ly);
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(a0 + Math.PI / 2);
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.bezierCurveTo(-8 * s, 0, -6 * s, -10 * s, 0, -9 * s); ctx.bezierCurveTo(6 * s, -10 * s, 8 * s, 0, 0, 2); ctx.closePath();
      ctx.fillStyle = i % 2 ? '#3f8a4f' : '#4f9a58'; ctx.fill(); outline(0.9);
      ctx.strokeStyle = '#2f6a3c'; ctx.lineWidth = 0.6; line(0, 1, 0, -8 * s); line(0, -3 * s, -3.5 * s, -5 * s); line(0, -5 * s, 3.5 * s, -6.5 * s);
      ctx.restore();
    });
  },
  bush(o) {
    const ctx = pen.ctx, { x, y, s } = o;
    ctx.fillStyle = SHADOW; E(x, y, 20 * s, 4 * s); ctx.fill();
    const cols = o.dry ? ['#9aa45a', '#a9b264'] : ['#5f9147', '#6a9c50'];
    for (const [dx, dy, r, c] of [[-10, -8, 9, 0], [9, -8, 10, 0], [0, -13, 11, 1]] as const) { E(x + dx * s, y + dy * s, r * s, r * 0.85 * s); ctx.fillStyle = cols[c]!; ctx.fill(); outline(1); }
    if (o.berries) { ctx.fillStyle = o.berries; for (const [dx, dy] of [[-8, -10], [5, -15], [10, -7], [-2, -6], [2, -18]] as const) { E(x + dx * s, y + dy * s, 1.6 * s, 1.6 * s); ctx.fill(); } }
  },
  rock(o) { rock(o.x, o.y, o.s, o.seed > 5); },
  log(o) {
    const ctx = pen.ctx, { x, y, s } = o;
    ctx.fillStyle = SHADOW; E(x, y, 26 * s, 4 * s); ctx.fill();
    ctx.fillStyle = '#8a6544'; ctx.beginPath(); ctx.roundRect(x - 22 * s, y - 9 * s, 44 * s, 9 * s, 4 * s); ctx.fill(); outline(1);
    ctx.strokeStyle = '#6d4e33'; ctx.lineWidth = 0.8; line(x - 16 * s, y - 5 * s, x + 6 * s, y - 5 * s); line(x - 8 * s, y - 2.6 * s, x + 14 * s, y - 2.6 * s);
    E(x + 22 * s, y - 4.5 * s, 3 * s, 4.5 * s); ctx.fillStyle = '#c79f72'; ctx.fill(); outline(1);
    E(x + 22 * s, y - 4.5 * s, 1.4 * s, 2.2 * s); ctx.strokeStyle = '#8a6544'; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.fillStyle = '#d6453d'; E(x - 10 * s, y - 9 * s, 3 * s, 1.8 * s); ctx.fill(); outline(0.7);
  },
  mushroom(o) { mushroom(o.x, o.y, o.s * 0.9, o.seed <= 7); },
  fern(o) {
    const ctx = pen.ctx, { x, y, s } = o;
    ctx.strokeStyle = '#4f8a45'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + i * 5 * s, y - 14 * s, x + i * 9 * s, y - (8 - Math.abs(i)) * s); ctx.stroke(); }
  },
  post(o) {
    const ctx = pen.ctx, { x, y } = o;
    ctx.fillStyle = SHADOW; E(x, y, 7, 2); ctx.fill();
    ctx.fillStyle = '#8a6a4d'; ctx.beginPath(); ctx.roundRect(x - 3.5, y - 30, 7, 30, 1.5); ctx.fill(); outline(1);
    E(x, y - 30, 3.5, 1.4); ctx.fillStyle = '#b08a64'; ctx.fill(); outline(1);
  },
  bamboo(o, t) {
    const ctx = pen.ctx, { x, y, s } = o;
    ctx.fillStyle = SHADOW; E(x, y, 14 * s, 3.5 * s); ctx.fill();
    for (const [dx, h, c] of [[-7, 62, '#7fae4a'], [-2, 74, '#6c9c3f'], [3, 66, '#86b551'], [8, 56, '#76a646']] as const) {
      const sway = Math.sin(t * 0.8 + dx) * 1.2 * s, bx = x + dx * s;
      ctx.strokeStyle = INK; ctx.lineWidth = 3.4 * s; ctx.lineCap = 'butt'; line(bx, y, bx + sway, y - h * s);
      ctx.strokeStyle = c; ctx.lineWidth = 2.2 * s; line(bx, y, bx + sway, y - h * s);
      ctx.strokeStyle = INK; ctx.lineWidth = 0.6;
      for (let k = 12; k < h; k += 12) { const f = k / h; line(bx + sway * f - 1.4 * s, y - k * s, bx + sway * f + 1.4 * s, y - k * s); }
      for (const k of [h * 0.55, h * 0.8, h]) { const lx = bx + sway * (k / h); ctx.strokeStyle = INK; E(lx + 4 * s, y - k * s + 2 * s, 4.2 * s, 1.1 * s, 0.4); F('#8cbc58'); E(lx - 3.6 * s, y - k * s + 3 * s, 3.8 * s, 1 * s, -0.5); F('#7aab4a'); }
    }
  },
  stump(o) {
    const ctx = pen.ctx, { x, y, s } = o;
    ctx.fillStyle = SHADOW; E(x, y, 10 * s, 2.5 * s); ctx.fill();
    ctx.fillStyle = '#8a6544'; P([[x - 6 * s, y], [x - 5 * s, y - 10 * s], [x - 1 * s, y - 15 * s], [x + 1.5 * s, y - 9 * s], [x + 5 * s, y - 11 * s], [x + 6 * s, y]]); ctx.fill(); outline(1);
    ctx.fillStyle = '#d8b88a'; P([[x - 3 * s, y - 9 * s], [x - 1 * s, y - 13 * s], [x + 0.6 * s, y - 8 * s]]); ctx.fill();
    for (const [dx, dy] of [[-9, -0.5], [8, 0.4], [10, -1]] as const) { E(x + dx * s, y + dy * s, 1.4 * s, 0.6 * s); ctx.fill(); }
  },
  lodge(o) {
    const ctx = pen.ctx, { x, y } = o;
    ctx.beginPath(); ctx.ellipse(x, y, 20, 13, 0, Math.PI, 0); ctx.closePath(); ctx.fillStyle = '#8a6a4d'; ctx.fill(); outline(1);
    ctx.strokeStyle = '#5e4630'; ctx.lineWidth = 1; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) { const a0 = Math.PI + (i / 9) * Math.PI; line(x + Math.cos(a0) * 18, y + Math.sin(a0) * 11, x + Math.cos(a0 + 0.9) * 10, y + Math.sin(a0 + 0.9) * 6); }
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2; E(x, y + 0.5, 22, 2.4); ctx.stroke();
  },
  nest(o) {
    const ctx = pen.ctx, tr = o.tree!, s = tr.s, nx = tr.x + 18 * s, ny = tr.y - 66 * s;
    ctx.fillStyle = '#7a5a40'; P([[tr.x + 3 * s, tr.y - 58 * s], [nx, ny + 2 * s], [nx, ny + 4 * s], [tr.x + 4 * s, tr.y - 54 * s]]); ctx.fill(); outline(1);
    E(nx - 1.5 * s, ny - 2.6 * s, 1.8 * s, 1.5 * s); F('#cfe3ef'); E(nx + 1.5 * s, ny - 2.8 * s, 1.8 * s, 1.5 * s); F('#cfe3ef'); E(nx, ny - 3.2 * s, 1.8 * s, 1.5 * s); F('#dbeaf2');
    ctx.beginPath(); ctx.ellipse(nx, ny - 1.5 * s, 6 * s, 3.4 * s, 0, 0, Math.PI); ctx.closePath(); ctx.fillStyle = '#9a7350'; ctx.fill(); outline(1);
    ctx.strokeStyle = '#6d4e33'; ctx.lineWidth = 0.6; line(nx - 5 * s, ny - 0.8 * s, nx + 4 * s, ny + 0.6 * s); line(nx - 4 * s, ny + 0.8 * s, nx + 5 * s, ny - 0.6 * s);
  },
  ring(o) {
    const ctx = pen.ctx, { x, y, s } = o;
    const spots: [number, number, number][] = [];
    for (let i = 0; i < 10; i++) { const a0 = (i / 10) * Math.PI * 2; spots.push([x + Math.cos(a0) * 20 * s, y + Math.sin(a0) * 6 * s, i]); }
    spots.sort((p, q) => p[1] - q[1]);
    for (const [mx, my, i] of spots) { mushroom(mx, my, s * (0.75 + (i % 3) * 0.12), true); pen.glows.push({ m: ctx.getTransform(), soft: [mx, my - 5 * s, 3 * s, i] }); }
  },
  dandelion(o, t) {
    const ctx = pen.ctx, { x, y, s } = o;
    for (const [dx, dy, h, puff] of [[-10, -2, 15, true], [-4, 1, 19, true], [3, -3, 13, false], [8, 1, 17, true], [12, -1, 11, false], [-13, 2, 9, false]] as const) {
      const bx = x + dx * s, by = y + dy * s, tx = bx + Math.sin(t * 1.2 + dx) * 0.8 * s, ty = by - h * s;
      ctx.strokeStyle = '#6f9a52'; ctx.lineWidth = 1.1; line(bx, by, tx, ty);
      if (puff) {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 0.5;
        for (let i = 0; i < 12; i++) { const a0 = (i / 12) * Math.PI * 2; line(tx, ty, tx + Math.cos(a0) * 4.2 * s, ty + Math.sin(a0) * 4.2 * s); }
        E(tx, ty, 4.4 * s, 4.4 * s); ctx.strokeStyle = 'rgba(160,170,180,0.6)'; ctx.lineWidth = 0.6; ctx.stroke();
        dot(tx, ty, 0.8 * s, '#c9b98a');
      } else {
        ctx.fillStyle = '#f2c230';
        for (let i = 0; i < 8; i++) { const a0 = (i / 8) * Math.PI * 2; E(tx + Math.cos(a0) * 1.8 * s, ty + Math.sin(a0) * 1.8 * s, 1.3 * s, 1.3 * s); ctx.fill(); }
        dot(tx, ty, 1 * s, '#e39b2d');
      }
    }
    E(x - 2 * s, y + 1, 10 * s, 2.2 * s); ctx.fillStyle = '#5f9147'; ctx.fill();
  },
  rockflower(o, t) {
    const ctx = pen.ctx, { x, y } = o, s = o.s * 1.15;
    rock(x, y, s, false);
    ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(x - 1 * s, y - 14 * s); ctx.lineTo(x + 1 * s, y - 9 * s); ctx.lineTo(x - 0.5 * s, y - 5 * s); ctx.stroke();
    const fx = x + 0.2 * s + Math.sin(t * 1.3) * 0.5 * s, fy = y - 22 * s;
    ctx.strokeStyle = '#5f9147'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x - 0.8 * s, y - 12 * s); ctx.quadraticCurveTo(x + 1.5 * s, y - 17 * s, fx, fy); ctx.stroke();
    E(x + 2.4 * s, y - 15 * s, 2.4 * s, 1 * s, -0.5); ctx.fillStyle = '#6fa65a'; ctx.fill();
    ctx.fillStyle = '#e77fa8'; for (let i = 0; i < 5; i++) { const a0 = (i / 5) * Math.PI * 2 - 0.3; E(fx + Math.cos(a0) * 2 * s, fy + Math.sin(a0) * 2 * s, 1.5 * s, 1.5 * s); ctx.fill(); }
    dot(fx, fy, 0.9 * s, '#f2cf3a');
  },
};

// ───────────── sky and backdrop ─────────────

/** Sky, moon, stars and clouds: on the main canvas, not tinted at night. */
export function drawSky(dt: number) {
  const ctx = pen.ctx, { cam, base, CW, CH, night } = view, t = view.clock;
  screenTransform();
  const horizon = (HZ - cam.y) * scale();
  const g = ctx.createLinearGradient(0, 0, 0, Math.max(10, horizon));
  g.addColorStop(0, mix('#c8d8f0', '#141a33', night)); g.addColorStop(1, mix('#eef2ef', '#36406a', night));
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  const sl = (f: number) => base * (1 + (cam.z - 1) * f);
  if (night > 0.01) {
    const ls = sl(0.05), ox = cam.x * 0.05;
    for (const st of WORLD.stars) {
      const sx = (st.x - ox) * ls, sy = horizon - st.h * ls;
      if (sx < -4 || sx > CW + 4) continue;
      ctx.globalAlpha = night * (0.5 + 0.5 * Math.sin(t * 1.5 + st.p)); ctx.fillStyle = '#fff8e6'; E(sx, sy, st.r, st.r); ctx.fill();
    }
    const mx = CW * 0.84 - (cam.x / W) * 50, my = horizon - (HZ - 30) * ls;
    ctx.globalAlpha = night * 0.2; ctx.fillStyle = '#fff3c4'; E(mx, my, 20 * ls, 20 * ls); ctx.fill();
    ctx.globalAlpha = night; E(mx, my, 10 * ls, 10 * ls); ctx.fill();
    ctx.fillStyle = '#e8dcae'; E(mx - 3 * ls, my - 2 * ls, 2 * ls, 2 * ls); ctx.fill(); E(mx + 3 * ls, my + 3 * ls, 1.4 * ls, 1.4 * ls); ctx.fill();
    ctx.globalAlpha = 1;
  }
  const ls = sl(0.15), ox = cam.x * 0.15;
  ctx.fillStyle = night > 0.5 ? `rgba(120,132,170,${0.5 * night})` : `rgba(255,255,255,${0.85 * (1 - night)})`;
  for (const c of WORLD.clouds) {
    if (!view.paused) c.x += dt * 4 * c.s;
    const span = 1500, lx = (((c.x - ox) % span) + span) % span - 100;
    const sx = lx * ls, sy = horizon - (HZ - c.h) * ls, s = ls * c.s;
    E(sx, sy, 26 * s, 9 * s); ctx.fill(); E(sx - 14 * s, sy + 3 * s, 14 * s, 7 * s); ctx.fill(); E(sx + 12 * s, sy - 4 * s, 15 * s, 9 * s); ctx.fill();
  }
}

/** A row of hills behind the ground, moving slower than it (parallax). */
export function hills(f: number, color: string, height: (lx: number) => number, trees: string | null) {
  const ctx = pen.ctx, { cam, base, CW } = view;
  screenTransform();
  const horizon = (HZ - cam.y) * scale();
  const ls = base * (1 + (cam.z - 1) * f), ox = cam.x * f;
  ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(0, horizon + 2);
  for (let sx = 0; sx <= CW + 6; sx += 6) ctx.lineTo(sx, horizon - height(sx / ls + ox) * ls);
  ctx.lineTo(CW, horizon + 2); ctx.closePath(); ctx.fill();
  if (!trees) return;
  ctx.fillStyle = trees;
  const step = 23, first = Math.floor(ox / step) * step;
  for (let lx = first; lx < ox + CW / ls + step; lx += step) {
    const n = Math.sin(lx * 12.9898) * 43758.5453, frac = n - Math.floor(n);
    if (frac < 0.45) continue;
    const sx = (lx - ox + frac * 10) * ls, top = horizon - height(lx + frac * 10) * ls;
    if (frac > 0.8) { P([[sx - 5 * ls, top + 2 * ls], [sx, top - 13 * ls], [sx + 5 * ls, top + 2 * ls]]); ctx.fill(); }
    else { E(sx, top - 4 * ls, 7 * ls * (0.7 + frac * 0.5), 6 * ls * (0.7 + frac * 0.5)); ctx.fill(); }
  }
}

// ───────────── ground and water ─────────────

function fishShape(x: number, y: number, len: number, dir: number) {
  const ctx = pen.ctx;
  ctx.beginPath(); ctx.ellipse(x, y, len, len * 0.36, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - dir * len * 0.9, y); ctx.lineTo(x - dir * len * 1.6, y - len * 0.4); ctx.lineTo(x - dir * len * 1.6, y + len * 0.4); ctx.closePath(); ctx.fill();
}
function drawWater(p: Ellipse, main: boolean) {
  const ctx = pen.ctx, t = view.clock;
  E(p.cx, p.cy, p.rx + 8, p.ry + 5); ctx.fillStyle = main ? '#d6cb9e' : '#c9bd8a'; ctx.fill();
  E(p.cx, p.cy, p.rx, p.ry); ctx.fillStyle = main ? '#8fc0d8' : '#7ab2ca'; ctx.fill(); outline(1);
  E(p.cx - p.rx * 0.1, p.cy - p.ry * 0.25, p.rx * 0.7, p.ry * 0.45); ctx.fillStyle = main ? '#a9d2e4' : '#94c4d8'; ctx.fill();
  ctx.fillStyle = 'rgba(40,80,100,0.2)';
  for (const f of WORLD.fish) if (f.water === p) { const a0 = t * f.s + f.p; fishShape(p.cx + Math.cos(a0) * p.rx * f.r * 1.4, p.cy + Math.sin(a0) * p.ry * f.r, 4.5, -Math.sign(Math.sin(a0)) || 1); }
  if (view.night > 0.01 && main) {
    // the moon in the pond, bright enough to survive the night tint
    ctx.save(); ctx.globalAlpha = view.night * 0.9; ctx.strokeStyle = '#fffbe8'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const w = 12 - i * 2.5, yy = p.cy - p.ry * 0.3 + i * 3.2, xx = p.cx + p.rx * 0.2 + Math.sin(t * 1.4 + i) * 1.5; line(xx - w, yy, xx + w, yy); }
    ctx.restore();
  }
}
function flower(f: Flower, t: number) {
  const ctx = pen.ctx, s = depth(f.y), sway = Math.sin(t * 1.1 + f.x) * 0.5;
  ctx.strokeStyle = '#6f9a52'; ctx.lineWidth = 1.1;
  if (f.kind === 'lavender') {
    for (const dx of [-2, 0, 2]) {
      line(f.x + dx * s, f.y, f.x + dx * 1.6 * s + sway, f.y - 10 * s);
      ctx.fillStyle = '#9b7ad6';
      for (let i = 0; i < 4; i++) { E(f.x + dx * 1.6 * s + sway, f.y - (7 + i * 1.6) * s, 1 * s, 1 * s); ctx.fill(); }
    }
    return;
  }
  if (f.kind === 'buttercup') { ctx.fillStyle = '#f2cf3a'; for (const [dx, dy] of [[0, -4], [-2.6, -2.4], [2.4, -3]] as const) { E(f.x + dx * s, f.y + dy * s, 1.3 * s, 1.3 * s); ctx.fill(); } return; }
  line(f.x, f.y, f.x + sway, f.y - 7 * s);
  const x = f.x + sway;
  if (f.kind === 'tulip') {
    ctx.beginPath(); ctx.moveTo(x - 2.4 * s, f.y - 10.5 * s); ctx.lineTo(x - 1.2 * s, f.y - 9 * s); ctx.lineTo(x, f.y - 10.8 * s); ctx.lineTo(x + 1.2 * s, f.y - 9 * s); ctx.lineTo(x + 2.4 * s, f.y - 10.5 * s);
    ctx.quadraticCurveTo(x + 2.6 * s, f.y - 6.6 * s, x, f.y - 6.6 * s); ctx.quadraticCurveTo(x - 2.6 * s, f.y - 6.6 * s, x - 2.4 * s, f.y - 10.5 * s);
    ctx.fillStyle = f.c; ctx.fill(); outline(0.5);
    return;
  }
  ctx.fillStyle = '#fbfbf4';
  for (let i = 0; i < 5; i++) { const ang = (i / 5) * Math.PI * 2; E(x + Math.cos(ang) * 2.4 * s, f.y - 8 * s + Math.sin(ang) * 2.4 * s, 1.7 * s, 1.7 * s); ctx.fill(); }
  E(x, f.y - 8 * s, 1.3 * s, 1.3 * s); ctx.fillStyle = '#e39b2d'; ctx.fill();
}
function drawSea() {
  const ctx = pen.ctx, t = view.clock;
  const ys: number[] = []; for (let y = HZ; y <= H + 0.1; y += 6) ys.push(y);
  const along = (xOf: (y: number) => number, back: (y: number) => number) => {
    ctx.beginPath(); ys.forEach((y, i) => (i ? ctx.lineTo(xOf(y), y) : ctx.moveTo(xOf(y), y)));
    for (let i = ys.length - 1; i >= 0; i--) ctx.lineTo(back(ys[i]!), ys[i]!);
    ctx.closePath();
  };
  along((y) => shoreX(y) - 62 - (y - HZ) * 0.08, (y) => shoreX(y) + 2); ctx.fillStyle = '#e8d9ab'; ctx.fill();
  along((y) => shoreX(y) - 10, (y) => shoreX(y) + 2); ctx.fillStyle = '#d7c391'; ctx.fill();
  const g = ctx.createLinearGradient(0, HZ, 0, H); g.addColorStop(0, '#a9cfe0'); g.addColorStop(1, '#6aa6c9');
  ctx.beginPath(); ys.forEach((y, i) => (i ? ctx.lineTo(shoreX(y), y) : ctx.moveTo(shoreX(y), y)));
  ctx.lineTo(W + 300, H); ctx.lineTo(W + 300, HZ); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
  ctx.fillStyle = 'rgba(30,70,100,0.18)';
  for (const f of WORLD.fish) if (!f.water) fishShape(f.x + Math.sin(t * f.s + f.p) * 50, f.y + Math.sin(t * 0.7 + f.p) * 4, 4 * depth(f.y), Math.cos(t * f.s + f.p) > 0 ? 1 : -1);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.lineCap = 'round';
  for (const w of WORLD.waves) { const s = depth(w.y), x = w.x + Math.sin(t * 0.5 + w.p) * 6; ctx.beginPath(); ctx.moveTo(x - 4 * s, w.y); ctx.quadraticCurveTo(x, w.y - 2 * s, x + 4 * s, w.y); ctx.stroke(); }
  // foam along the beach
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ys.forEach((y, i) => { const x = shoreX(y) + 2 + Math.sin(t * 1.4 + y * 0.12) * 2.2; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1; line(shoreX(HZ), HZ + 0.5, W + 300, HZ + 0.5);
  // the ice floe, where penguins and seals rest
  if (visible(FLOE.cx, FLOE.rx + 10)) {
    const f = FLOE;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2; E(f.cx, f.cy + 3, f.rx + 4, f.ry + 2.5 + Math.sin(t * 1.3) * 0.5); ctx.stroke();
    E(f.cx, f.cy + 2.6, f.rx, f.ry); ctx.fillStyle = '#b9d5e4'; ctx.fill(); outline(1);
    E(f.cx, f.cy, f.rx, f.ry); ctx.fillStyle = '#f4f8fb'; ctx.fill(); outline(1);
    ctx.strokeStyle = '#d3e4ee'; ctx.lineWidth = 0.9; line(f.cx - 30, f.cy - 2, f.cx - 8, f.cy + 3); line(f.cx + 12, f.cy - 5, f.cx + 34, f.cy + 1);
  }
  ctx.fillStyle = '#f3e9d9'; for (const [dy, dx] of [[150, 30], [210, 22], [258, 44]] as const) { E(shoreX(dy) - dx, dy, 1.6, 1); ctx.fill(); }
}

/** Everything flat on the ground: grass, biomes, the path, water, flowers. */
export function drawGround() {
  const ctx = pen.ctx, t = view.clock;
  worldTransform();
  const x0 = view.cam.x - 20, x1 = view.cam.x + viewW() + 20;
  const gr = ctx.createLinearGradient(0, HZ, 0, H);
  gr.addColorStop(0, '#bcd8a3'); gr.addColorStop(1, '#a9cc8e');
  ctx.fillStyle = gr; ctx.fillRect(x0, HZ, x1 - x0, H - HZ + 2);
  for (const b of BIOMES) {
    if (b.x1 + b.edge < x0 || b.x0 - b.edge > x1) continue;
    const span = b.x1 - b.x0 + 2 * b.edge, g = ctx.createLinearGradient(b.x0 - b.edge, 0, b.x1 + b.edge, 0);
    const rgba = (al: number) => `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${al})`;
    g.addColorStop(0, rgba(0)); g.addColorStop((2 * b.edge) / span, rgba(b.a)); g.addColorStop(1 - (2 * b.edge) / span, rgba(b.a)); g.addColorStop(1, rgba(0));
    ctx.fillStyle = g; ctx.fillRect(b.x0 - b.edge, HZ, span, H - HZ + 2);
  }
  ctx.globalAlpha = 0.55;
  for (const p of WORLD.patches) if (p.x + p.rx > x0 && p.x - p.rx < x1) { E(p.x, p.y, p.rx, p.ry); ctx.fillStyle = p.c; ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const trace = () => {
    ctx.beginPath(); ctx.moveTo(PATH[0]![0], PATH[0]![1]);
    for (let i = 1; i < PATH.length - 1; i++) { const [px, py] = PATH[i]!, [qx, qy] = PATH[i + 1]!; ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2); }
    const [lx, ly] = PATH[PATH.length - 1]!; ctx.lineTo(lx, ly);
  };
  trace(); ctx.strokeStyle = '#cdbb8e'; ctx.lineWidth = 15; ctx.stroke();
  trace(); ctx.strokeStyle = '#ddcfa6'; ctx.lineWidth = 11; ctx.stroke();
  if (x1 > SHORE0 - 120) drawSea();
  if (visible(POND.cx, POND.rx + 20)) {
    const p = POND;
    drawWater(p, true);
    for (const [dx, dy, r] of [[0.45, 0.3, 7], [-0.2, 0.5, 5.5], [0.62, -0.15, 4.5]] as const) {
      const lx = p.cx + p.rx * dx, ly = p.cy + p.ry * dy;
      E(lx, ly, r, r * 0.42); ctx.fillStyle = '#6fa65a'; ctx.fill(); outline(0.6);
      ctx.strokeStyle = '#8fc0d8'; ctx.lineWidth = 1.6; line(lx, ly, lx + r, ly - 1);
    }
    E(p.cx + p.rx * 0.45 + 2, p.cy + p.ry * 0.3 - 2.2, 2, 1.6); ctx.fillStyle = '#f5f0f6'; ctx.fill(); outline(0.5);
    for (let i = 0; i < 6; i++) {
      const x = p.cx + p.rx * (0.7 + i * 0.05), y = p.cy - p.ry * (0.55 - i * 0.12), h = 14 + (i % 3) * 4, sway = Math.sin(t + i) * 0.8;
      ctx.strokeStyle = '#5f8c49'; ctx.lineWidth = 1.3; line(x, y, x + sway, y - h);
      if (i % 2 === 0) { E(x + sway, y - h + 3, 1.4, 3.2); ctx.fillStyle = '#7a5236'; ctx.fill(); }
    }
    ctx.fillStyle = '#b4b2ad'; for (const [dx, dy] of [[0.2, 1.06], [0.35, 1.08], [-0.6, 0.93], [0.9, -0.55]] as const) { E(p.cx + p.rx * dx, p.cy + p.ry * dy, 2.2, 1.4); ctx.fill(); }
  }
  if (visible(POOL.cx, POOL.rx + 20)) drawWater(POOL, false);
  ctx.lineWidth = 1.2; ctx.lineCap = 'round';
  for (const tf of WORLD.tufts) {
    if (tf.x < x0 || tf.x > x1) continue;
    const b = biomeAt(tf.x), dry = b === 'savanna';
    ctx.strokeStyle = dry ? '#b4a35c' : b === 'jungle' ? '#4f8f45' : b === 'bamboo' ? '#6f9e58' : '#86ad69';
    const s = depth(tf.y) * (dry ? 4.2 : 3.2), sway = Math.sin(t * 1.2 + tf.x * 0.05) * (dry ? 1 : 0.6);
    ctx.beginPath();
    ctx.moveTo(tf.x - s, tf.y); ctx.lineTo(tf.x - s * 1.4 + sway, tf.y - s * 1.6);
    ctx.moveTo(tf.x, tf.y); ctx.lineTo(tf.x + sway, tf.y - s * 2.2);
    ctx.moveTo(tf.x + s, tf.y); ctx.lineTo(tf.x + s * 1.5 + sway, tf.y - s * 1.5);
    ctx.stroke();
  }
  for (const f of WORLD.flat) if (f.x > x0 && f.x < x1) flower(f, t);
}

/** Mist beyond the part of the meadow opened up so far. */
export function drawMist() {
  const ctx = pen.ctx, { open } = view;
  worldTransform();
  const top = HZ - 30;
  for (const [edge, dir] of [[open.l, -1], [open.r, 1]] as const) {
    if ((dir < 0 && edge <= 1) || (dir > 0 && edge >= W - 1)) continue;
    const g = ctx.createLinearGradient(edge, 0, edge + dir * 150, 0);
    g.addColorStop(0, 'rgba(236,241,236,0)'); g.addColorStop(1, 'rgba(236,241,236,0.93)');
    ctx.fillStyle = g;
    if (dir > 0) ctx.fillRect(edge, top, W + 300 - edge, H - top + 2); else ctx.fillRect(-300, top, edge + 300, H - top + 2);
    const vg = ctx.createLinearGradient(0, top - 30, 0, top + 10);
    vg.addColorStop(0, 'rgba(236,241,236,0)'); vg.addColorStop(1, 'rgba(236,241,236,0.6)');
    ctx.fillStyle = vg;
    if (dir > 0) ctx.fillRect(edge + 90, top - 30, W + 300 - edge, 40); else ctx.fillRect(-300, top - 30, edge + 210, 40);
  }
}

/** Lights that shine at night, drawn after the tint: glowing eyes, the mushroom ring, fireflies. */
export function drawNightLights() {
  const ctx = pen.ctx, { night } = view, t = view.clock;
  if (night < 0.01) return;
  ctx.save();
  for (const g of pen.glows) {
    ctx.setTransform(g.m);
    if ('soft' in g) {
      const [x, y, r, i] = g.soft, on = 0.6 + 0.4 * Math.sin(t * 1.3 + i);
      ctx.globalAlpha = night * 0.22 * on; ctx.fillStyle = '#d9ffcf'; E(x, y, r * 1.6, r); ctx.fill();
      continue;
    }
    for (const [x, y] of g.pts) { ctx.globalAlpha = night * 0.9; ctx.fillStyle = '#ffd36b'; E(x, y, 0.9, 0.9); ctx.fill(); ctx.globalAlpha = night * 0.25; E(x, y, 2.2, 2.2); ctx.fill(); }
  }
  worldTransform();
  for (const f of WORLD.flies) {
    const x = f.x + Math.sin(t * 0.4 * f.s + f.p) * 30, y = f.y + Math.cos(t * 0.6 * f.s + f.p) * 12;
    if (!visible(x, 10) || x < view.open.l || x > view.open.r) continue;
    const on = 0.5 + 0.5 * Math.sin(t * 2 * f.s + f.p);
    ctx.globalAlpha = night * on * 0.3; ctx.fillStyle = '#e8ff8a'; E(x, y, 5, 5); ctx.fill();
    ctx.globalAlpha = night * on; E(x, y, 1.4, 1.4); ctx.fill();
  }
  ctx.restore();
}

/** The water's colour where an animal swims, to see its submerged part through. */
export function waterColor(x: number, y: number): readonly [number, number, number] {
  const inside = (p: Ellipse) => { const dx = (x - p.cx) / (p.rx * 1.05), dy = (y - p.cy) / (p.ry * 1.05); return dx * dx + dy * dy < 1; };
  if (inside(POND)) return [143, 192, 216];
  if (inside(POOL)) return [122, 178, 202];
  const f = clamp((y - HZ) / (H - HZ), 0, 1);
  return [Math.round(169 + (106 - 169) * f), Math.round(207 + (166 - 207) * f), Math.round(224 + (201 - 224) * f)];
}

