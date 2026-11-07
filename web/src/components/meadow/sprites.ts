import { E, F, INK, P, T, curve, dot, eye, leg, line, pen, spikes, striped } from './pen';
import { FIRST_WING } from './species';
import type { Actor, Sprite } from './types';
import { inFloe } from './world';

// Every animal is drawn facing right, feet at (0, 0), y up is negative, in sprite units.

interface CanineColours { coat: string; ear: string; light: string; tip: string; leg: string; legFar: string; socks: string; tall: number; tailRot: number }
function foxHead(a: Actor, coat: string, ear: string, light: string) {
  P([[-2.5, -2.5], [-1.4, -8], [0.8, -3]]); F(coat);
  P([[0.5, -3], [2.7, -7.6], [3.2, -2.2]]); F(ear);
  E(0, 0, 4.2, 3.7); F(coat);
  P([[2, -1.4], [7, 0.6], [2.4, 2.4]]); F(light);
  dot(7, 0.5, 0.75);
  eye(a, 1.7, -1.1);
}
function canine(a: Actor, c: CanineColours) {
  const ctx = pen.ctx, m = a.state === 'go', ph = a.phase;
  if (a.sleep > 0) {
    // curled up, nose under the tail
    const br = Math.sin(a.t * 1.6) * 0.25;
    E(-1, -4, 8, 4.4 + br); F(c.coat);
    E(5.4, -3.6, 3.8, 3.1); F(c.coat);
    P([[4, -6], [4.6, -9.4], [6.4, -6.1]]); F(c.ear);
    P([[6.2, -5.4], [9.2, -2.8], [6.4, -1.8]]); F(c.light);
    eye(a, 6.2, -4.3);
    E(1.2, -1.6, 8.2, 2.4, 0.04); F(c.coat);
    E(8.6, -1.6, 2.4, 1.7); F(c.tip);
    return;
  }
  if (a.special === 'sit' || a.special === 'howl') {
    E(-3, -5.4, 6, 5.2); F(c.coat);
    E(2.6, -10, 4.6, 6.8 + c.tall * 0.3, 0.25); F(c.coat);
    E(4.3, -9.4, 2.3, 4.6, 0.25); F(c.light);
    leg(3.8, -5, 3.8, 0, 1.4, c.socks); leg(6.2, -5, 6.2, 0, 1.4, c.socks);
    ctx.save(); ctx.translate(-3, -2); ctx.rotate(Math.sin(a.t * 1.4 + a.seed) * 0.05);
    E(3.4, 0.7, 7.6, 2.2); F(c.coat); E(10.2, 0.7, 2.3, 1.7); F(c.tip); ctx.restore();
    ctx.save(); ctx.translate(5.6, -17.6 - c.tall * 0.5);
    ctx.rotate(a.special === 'howl' ? -0.8 + Math.sin(a.t * 0.8) * 0.05 : Math.sin(a.t * 0.9 + a.seed) * 0.08);
    foxHead(a, c.coat, c.ear, c.light); ctx.restore();
    return;
  }
  const sniff = a.special === 'sniff';
  const bob = m ? -Math.abs(Math.sin(ph)) * 0.7 : 0;
  const top = -5 - c.tall;
  for (const [lx, off, far] of [[-6, 0, 1], [4.5, Math.PI, 1], [-3.5, Math.PI, 0], [7, 0, 0]] as const) {
    const sw = m ? Math.sin(ph + off) * 1.8 : 0;
    leg(lx, top + bob, lx + sw, 0, 1.4, far ? c.legFar : lx > 0 ? c.socks : c.leg);
  }
  ctx.save(); ctx.translate(0, bob - c.tall);
  ctx.save(); ctx.translate(-8, -8); ctx.rotate((sniff ? -0.9 : c.tailRot) + Math.sin(a.t * (sniff ? 6 : 2.2) + a.seed) * 0.18);
  E(-5, 0, 6, 2.7); F(c.coat); E(-10, 0, 2.3, 1.9); F(c.tip); ctx.restore();
  E(0, -8, 8.5, 4.2); F(c.coat);
  E(6.5, -7.5, 2.8, 3.2); F(c.light);
  if (sniff) { ctx.translate(11, -7.5 + c.tall + Math.sin(a.t * 9) * 0.25); ctx.rotate(0.45); }
  else { ctx.translate(10, -12.5); ctx.rotate(!m ? Math.sin(a.t * 0.9 + a.seed) * 0.08 : 0); }
  foxHead(a, c.coat, c.ear, c.light);
  ctx.restore();
}

interface BearColours { body: string; ear: string; leg: string; legFar: string; muzzle: string; belly?: string; dark?: string; panda?: boolean }
function bearLike(a: Actor, c: BearColours) {
  const ctx = pen.ctx, m = a.state === 'go', ph = a.phase, dark = c.dark ?? INK;
  const head = () => {
    E(-2.6, -4.4, 1.9, 1.9); F(c.ear); E(1.6, -4.9, 1.9, 1.9); F(c.ear);
    E(0, 0, 5, 4.6); F(c.body);
    if (c.panda) { E(1.3, -1, 1.5, 2, 0.5); F(dark); }
    E(4, 1, 2.6, 2); F(c.muzzle);
    dot(6.2, 0.3, 0.9);
    if (c.panda && a.sleep <= 0) { dot(1.6, -1.3, 0.6, '#f3f3ee'); dot(1.75, -1.25, 0.32); } else if (!c.panda) eye(a, 1.6, -1.4);
  };
  if (a.sleep > 0) {
    // lying on its belly, chin on the paws
    const br = Math.sin(a.t * 1.3) * 0.35;
    E(0, -5, 11, 5 + br); F(c.body);
    if (c.panda) { E(5, -5.5, 3.4, 4.6); F(dark); }
    E(-8, -1, 3, 1.3); F(c.leg);
    ctx.save(); ctx.translate(10.5, -4.4); head(); ctx.restore();
    E(13.5, -0.8, 2.8, 1.3); F(c.leg);
    return;
  }
  if (a.special === 'sit' || a.special === 'eat') {
    leg(6, -3, 9, -1, 3, c.leg);
    E(-1, -9, 8.5, 9, -0.15); F(c.body);
    if (c.panda) { E(1.5, -8, 4.5, 5.5); F(c.body); E(2, -13.5, 5.6, 2.6, -0.2); F(dark); } else { E(1.5, -8, 4.5, 5.5); F(c.belly ?? c.body); }
    const munch = a.special === 'eat' ? Math.sin(a.t * 6) * 0.3 : 0;
    if (a.special === 'eat') {
      ctx.save(); ctx.strokeStyle = '#5f9a3e'; ctx.lineWidth = 1.3; ctx.lineCap = 'round'; line(8, -5, 10.5, -21); ctx.restore();
      ctx.strokeStyle = INK; E(11, -20.5, 2.4, 0.8, -0.6); F('#7bb04a'); E(9.6, -17.6, 2.2, 0.7, 0.5); F('#7bb04a');
    }
    leg(5, -11, 8, -6, 2.8, c.leg);
    ctx.save(); ctx.translate(4, -19 + munch); head(); ctx.restore();
    return;
  }
  const fish = a.special === 'fish';
  const bob = m ? -Math.abs(Math.sin(ph)) * 0.8 : Math.sin(a.t * 1.4) * 0.25;
  for (const [lx, off, far] of [[-7, 0, 1], [5, Math.PI, 1], [-4, Math.PI, 0], [8, 0, 0]] as const) {
    if (fish && lx === 8) continue;
    const sw = m ? Math.sin(ph + off) * 1.6 : 0;
    leg(lx, -6 + bob, lx + sw, 0, 2.8, far ? c.legFar : c.leg);
  }
  E(0, -10 + bob, 11, 6.5); F(c.body);
  if (c.panda) { E(4.5, -10.5 + bob, 3.4, 6.4); F(dark); }
  if (a.variant.mark === 'chest') { E(8.4, -8 + bob, 2.2, 1.1, 0.3); ctx.fillStyle = '#efdcbc'; ctx.fill(); }
  if (fish) {
    // one paw up, ready to swipe at a fish
    const up = Math.sin(a.swipe * Math.PI);
    leg(8, -8, 12 + up * 3, -13 + up * 9, 2.8, c.leg);
    ctx.save(); ctx.translate(11.5, -12.5); ctx.rotate(0.35); head(); ctx.restore();
    return;
  }
  ctx.save(); ctx.translate(11, -14.5 + bob + (!m && (a.t + a.seed) % 7 < 1.2 ? 2.5 : 0)); head(); ctx.restore();
}

interface CatColours { coat: string; dark: string; belly: string; tuft: string; mane?: string; stripes?: boolean }
function catLike(a: Actor, c: CatColours) {
  const ctx = pen.ctx, m = a.state === 'go', ph = a.phase;
  const stripes = () => { if (!c.stripes) return; ctx.lineWidth = 1.1; for (const x of [-7, -4, -1, 2, 5]) { ctx.beginPath(); ctx.moveTo(x, -16); ctx.quadraticCurveTo(x + 1.6, -10, x + 0.4, -3); ctx.stroke(); } };
  const head = () => {
    if (c.mane) { E(-0.8, 0, 6.6, 6.2); F(c.mane); }
    E(-1.6, -3.6, 1.4, 1.4); F(c.coat); E(1.8, -3.9, 1.4, 1.4); F(c.coat);
    E(0.6, 0, 4.2, 3.8); F(c.coat);
    if (c.stripes) { ctx.save(); ctx.lineWidth = 0.6; line(-0.4, -3.6, 0.1, -2); line(1.2, -3.8, 1.5, -2.3); line(-3.2, 0.2, -1.8, 0.6); ctx.restore(); E(1.4, 1.6, 2.4, 1.6); ctx.fillStyle = c.belly; ctx.fill(); }
    E(3.4, 1.2, 2.2, 1.6); F(c.belly);
    P([[4.6, -0.1], [5.8, 0.2], [5, 1]]); F('#7a4a3a');
    if (a.yawn > 0) { E(3.6, 2.8, 1.1, 1.5 * Math.sin(a.yawn * Math.PI)); ctx.fillStyle = '#7a3a3a'; ctx.fill(); }
    eye(a, 1.8, -1, 0.55);
  };
  const tail = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number) => { curve([x0, y0, x1, y1, x2, y2], 0.9, c.coat); dot(x2, y2, 1.2, c.tuft); };
  if (a.sleep > 0 || a.special === 'lie') {
    tail(-9, -2, -14, -1, -16.5, -1.6 + Math.sin(a.t * 1.5) * 0.4);
    striped(() => E(0, -4.6, 10, 4.4), c.coat, stripes);
    E(10.4, -0.9, 3.2, 1.2); F(c.coat); E(8.6, -0.6, 3, 1.1); F(c.coat);
    ctx.save(); ctx.translate(10, a.sleep > 0 ? -5.5 : -8.5); if (a.sleep > 0) ctx.rotate(0.2); head(); ctx.restore();
    return;
  }
  const bob = m ? -Math.abs(Math.sin(ph)) * 0.7 : 0;
  for (const [lx, off, far] of [[-7, 0, 1], [5, Math.PI, 1], [-4.5, Math.PI, 0], [7.5, 0, 0]] as const) {
    const sw = m ? Math.sin(ph + off) * 1.7 : 0;
    leg(lx, -6 + bob, lx + sw, 0, 2.4, far ? c.dark : c.coat);
  }
  tail(-9.5, -10 + bob, -15, -9 + bob, -15.5, -4 + bob + Math.sin(a.t * 1.6) * 1);
  striped(() => E(0, -10 + bob, 10, 5.2), c.coat, () => { ctx.save(); ctx.translate(0, bob + 3); stripes(); ctx.restore(); });
  ctx.save(); ctx.translate(10.5, -13.5 + bob); head(); ctx.restore();
}

export const SPRITES: Record<Exclude<Sprite, 'emoji'>, (a: Actor) => void> = {
  fox(a) {
    const socks = a.variant.mark === 'socks' ? '#fbf3e6' : T('#3b2a25');
    canine(a, { coat: T('#e8792f'), ear: T('#d9661f'), light: '#fbf3e6', tip: '#fbf3e6', leg: T('#3b2a25'), legFar: T('#2e211d'), socks, tall: 0, tailRot: -0.5 });
  },
  wolf(a) {
    canine(a, { coat: T('#8e96a3'), ear: T('#6f7784'), light: T('#dfe2e7'), tip: T('#5d6470'), leg: T('#7d8592'), legFar: T('#68707c'), socks: T('#7d8592'), tall: 2, tailRot: 0.35 });
  },
  bear(a) { bearLike(a, { body: T('#8a5a3b'), ear: T('#8a5a3b'), leg: T('#5e3b26'), legFar: T('#4c2f1f'), muzzle: '#c9a27e', belly: T('#a8764f') }); },
  panda(a) { bearLike(a, { body: T('#f3f3ee'), ear: '#2b2b30', leg: '#2b2b30', legFar: '#1f1f24', dark: '#2b2b30', muzzle: T('#f3f3ee'), panda: true }); },
  lion(a) { catLike(a, { coat: T('#d9a441'), dark: T('#b98a30'), belly: '#f1dcae', mane: T('#a8692e'), tuft: T('#7a4a2a') }); },
  tiger(a) { catLike(a, { coat: T('#e98a2e'), dark: T('#c9701e'), belly: '#fbf3e6', stripes: true, tuft: INK }); },
  hedgehog(a) {
    const ctx = pen.ctx, m = a.state === 'go', ph = a.phase;
    if (a.special === 'curl' || a.hop > 0.4) {
      const br = a.sleep > 0 ? Math.sin(a.t * 1.8) * 0.3 : 0;
      spikes(0, -5.2, 5 + br, 6.8 + br, 0, Math.PI * 2, 22); F(T('#6b5440'));
      E(0.8, -4.6, 3.8, 3.4); F(T('#a88866'));
      return;
    }
    leg(-3, -1.5, -3 + (m ? Math.sin(ph) : 0), 0, 1.1, '#5b4636');
    leg(3.5, -1.5, 3.5 + (m ? Math.sin(ph + Math.PI) : 0), 0, 1.1, '#5b4636');
    const bob = m ? -Math.abs(Math.sin(ph * 1.5)) * 0.4 : 0;
    ctx.save(); ctx.translate(0, bob);
    E(1.5, -2.6, 6.5, 2.6); F('#c9a27e');
    spikes(-0.5, -2, 5.6, 8, Math.PI, Math.PI * 2.05, 13); F(T('#6b5440'));
    E(5.6, -3.2, 3.3, 2.6, 0.1); F('#d9b48d');
    dot(8.8, -2.9, 0.8);
    eye(a, 6.3, -4, 0.55);
    ctx.restore();
  },
  owl(a) {
    const ctx = pen.ctx, flying = a.state === 'go', B = T('#8b6b4a');
    ctx.scale(a.dir, 1); // the owl looks at you
    if (flying) {
      const f = Math.sin(a.t * 14);
      E(-5, -8 - f * 2, 5.5, 2.2, -0.3 - f * 0.4); F(T('#6f5338'));
      E(5, -8 - f * 2, 5.5, 2.2, 0.3 + f * 0.4); F(T('#6f5338'));
    } else { leg(-1.5, -1, -1.5, 0.6, 0.9, '#e0a431'); leg(1.5, -1, 1.5, 0.6, 0.9, '#e0a431'); }
    const br = a.sleep > 0 ? Math.sin(a.t * 1.5) * 0.2 : 0;
    E(0, -7, 5 + br, 7); F(B);
    E(0, -5.5, 3.4 + br, 5); F('#e8d6b5');
    P([[-4, -11.5], [-3.6, -15.5], [-1.4, -12.5]]); F(B);
    P([[4, -11.5], [3.6, -15.5], [1.4, -12.5]]); F(B);
    E(0, -10.6, 4.3, 3.1); F('#d8c09a');
    if (a.sleep > 0) {
      ctx.save(); ctx.lineWidth = 0.7; ctx.strokeStyle = INK; ctx.lineCap = 'round';
      for (const ex of [-1.9, 1.9]) { ctx.beginPath(); ctx.arc(ex, -11.4, 1.3, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); }
      ctx.restore();
    } else {
      E(-1.9, -10.9, 1.6, 1.6); F('#ffffff'); E(1.9, -10.9, 1.6, 1.6); F('#ffffff');
      const lx = a.look * 0.5;
      if ((a.t + a.seed * 7) % 5.1 < 0.18) { ctx.save(); ctx.strokeStyle = INK; line(-3.2, -10.9, -0.6, -10.9); line(0.6, -10.9, 3.2, -10.9); ctx.restore(); }
      else {
        dot(-1.9 + lx, -10.9, 0.8); dot(1.9 + lx, -10.9, 0.8);
        // No glow in flight: it would shine through the trees the owl passes behind.
        if (!flying) pen.glows.push({ m: ctx.getTransform(), pts: [[-1.9 + lx, -10.9], [1.9 + lx, -10.9]] });
      }
    }
    P([[-0.7, -9.6], [0.7, -9.6], [0, -8.1]]); F('#e0a431');
  },
  penguin(a) {
    const ctx = pen.ctx, m = a.state === 'go', ph = a.phase, asleep = a.sleep > 0, K = T('#262a3c');
    if ((a.sink > 1 || a.jump) && !inFloe(a.x, a.y)) {
      // swimming: flat in the water like a little torpedo
      const stroke = Math.sin(a.t * (m ? 10 : 3));
      E(-0.5, -2.2, 3.2, 1.1, 0.5 + stroke * 0.5); F(K);
      E(0, -1.4, 8.5, 3.2); F(K);
      E(1, -0.4, 6.6, 1.8); ctx.fillStyle = '#f6f7fb'; ctx.fill();
      E(7.6, -3.2, 3, 2.6); F(K);
      P([[10.2, -3.6], [13.2, -2.8], [10.2, -2.2]]); F('#f0a030');
      E(8.2, -3.8, 1, 1); ctx.fillStyle = '#ffffff'; ctx.fill();
      eye(a, 8.4, -3.8, 0.5);
      P([[-8, -1.6], [-10.6, -2.6], [-10.2, -0.4]]); F(K);
      return;
    }
    ctx.rotate(m ? Math.sin(ph) * 0.14 : asleep ? 0.1 : Math.sin(a.t * 1.3 + a.seed) * 0.03);
    E(0.5, -0.2 - (m ? Math.max(0, Math.sin(ph)) * 0.8 : 0), 2.2, 0.9); F('#f0a030');
    E(3.6, -0.2 - (m ? Math.max(0, -Math.sin(ph)) * 0.8 : 0), 2.2, 0.9); F('#f0a030');
    const br = asleep ? Math.sin(a.t * 1.5) * 0.25 : 0;
    E(1, -9, 5.2 + br, 8.8); F(K);
    E(2.7, -8, 3.4 + br, 6.8); F('#f6f7fb');
    E(-0.6, -9, 1.6, 4.6, 0.25 + (m ? Math.sin(ph) * 0.3 : asleep ? 0 : Math.sin(a.t * 3) * 0.05)); F(K);
    const hd = asleep ? 1.2 : 0;
    P([[5, -15.2 + hd], [8.6, -14.2 + hd * 1.6], [5, -13.2 + hd]]); F('#f0a030');
    if (!asleep) { E(4, -15.6, 1, 1); ctx.fillStyle = '#ffffff'; ctx.fill(); }
    eye(a, 4.2, -15.6 + hd, 0.5);
  },
  turtle(a) {
    const ctx = pen.ctx, m = a.state === 'go', ph = a.phase, asleep = a.sleep > 0, S = T('#9bbf6a');
    for (const [lx, off] of [[-5, 0], [4, Math.PI]] as const) { E(lx + (m ? Math.sin(ph + off) * 1.1 : 0), -0.9, 1.6, asleep ? 0.9 : 1.3); F(S); }
    P([[-8, -2.2], [-10.5, -1.6], [-8, -1]]); F(S);
    // asleep, the head is pulled in under the shell
    const nod = m ? Math.sin(ph * 2) * 0.3 : asleep ? 0.6 : Math.sin(a.t * 0.8 + a.seed) * 0.4;
    const hx = asleep ? 7.2 : 8.6;
    E(hx, -3.2 + nod, 2.7, 2.1); F(S);
    eye(a, hx + 1, -3.8 + nod, 0.5);
    ctx.beginPath(); ctx.ellipse(0, -1.8, 8, 6.4, 0, Math.PI, 0); ctx.closePath(); F(T('#5b8a3c'));
    ctx.save(); ctx.lineWidth = 0.45; ctx.strokeStyle = '#3d6627';
    P([[-2.5, -3.5], [2.5, -3.5], [3.5, -5.8], [0, -7.4], [-3.5, -5.8]]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-2.5, -3.5); ctx.lineTo(-4.5, -1.8); ctx.moveTo(2.5, -3.5); ctx.lineTo(4.5, -1.8); ctx.moveTo(-3.5, -5.8); ctx.lineTo(-6.5, -4.5); ctx.moveTo(3.5, -5.8); ctx.lineTo(6.5, -4.5); ctx.stroke();
    ctx.lineWidth = 1.4; line(-8.4, -1.8, 8.4, -1.8); ctx.restore();
  },
  bee(a) {
    const ctx = pen.ctx, asleep = a.sleep > 0;
    const f = asleep ? 0.3 : 0.35 + 0.65 * Math.abs(Math.sin(a.t * 38));
    ctx.save(); ctx.globalAlpha = 0.85;
    E(-1, -3.4, 2.8, 1.7 * f, asleep ? -1.1 : -0.4); F('#eef6fb'); E(1.2, -3.6, 2.4, 1.4 * f, asleep ? -0.8 : 0.35); F('#eef6fb'); ctx.restore();
    P([[-4, 0], [-5.6, 0.4], [-4, 0.9]]); F(INK);
    E(0, 0, 4, 2.8); ctx.fillStyle = T('#f2c230'); ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = INK; ctx.fillRect(-1.6, -3, 1.3, 6); ctx.fillRect(1.1, -3, 1.3, 6); ctx.restore();
    E(0, 0, 4, 2.8); ctx.stroke();
    E(4.2, -0.4, 1.8, 1.8); F(INK);
  },
  butterfly(a) {
    const ctx = pen.ctx;
    ctx.scale(a.dir, 1);
    const [c1, c2] = a.variant.wing ?? FIRST_WING;
    // resting: wings folded up, slowly opening and closing a little
    const f = a.sleep > 0 || (a.state === 'idle' && a.alt < 12) ? 0.12 + 0.06 * Math.sin(a.t * 0.8) : 0.2 + 0.8 * Math.abs(Math.cos(a.t * 9 + a.seed));
    for (const s of [-1, 1]) {
      E(s * 3.4 * f, -2, 3.9 * f, 3.4); F(c1);
      E(s * 2.4 * f, 2.2, 2.8 * f, 2.4); F(c2);
      dot(s * 4 * f, -2.4, 0.9 * f + 0.1, '#ffd166');
    }
    E(0, 0, 0.9, 3.6); F(INK);
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(-0.3, -3.4); ctx.quadraticCurveTo(-1, -6, -2, -6.4); ctx.moveTo(0.3, -3.4); ctx.quadraticCurveTo(1, -6, 2, -6.4); ctx.stroke(); ctx.restore();
  },
  otter(a) {
    const ctx = pen.ctx, m = a.state === 'go', O = T('#7a5236'), O2 = T('#6b4730');
    if (a.special === 'float') {
      // on its back; asleep, it holds its paws together on its chest
      const br = a.sleep > 0 ? Math.sin(a.t * 1.4) * 0.25 : 0;
      ctx.translate(0, -2.2);
      E(-9, -0.5, 3, 1, 0.1); F(O);
      E(0, -1.3, 8, 2.7 + br); F(O);
      E(0.4, -2.5, 5.6, 1.4 + br); F('#c9a27e');
      E(8, -2.6, 3.1, 2.7); F(O);
      E(9.2, -4.6, 1.8, 1.3); F('#c9a27e');
      if (a.sleep > 0) eye(a, 9.4, -6, 0.5); else dot(9.6, -5.8, 0.6);
      if (a.sleep > 0) { E(3.4, -4.4, 1.2, 1.1); F(O2); E(4.6, -4.6, 1.2, 1.1); F(O2); }
      else { E(2.3, -4.4, 1.1, 1.1); F(O2); E(4.4, -4.6, 1.1, 1.1); F(O2); E(3.4, -5.6, 1.4, 1, 0.3); F('#b8c0cc'); }
      return;
    }
    const land = a.sink < 1;
    if (land) {
      // on the bank: a long, low body on short legs, the back arching as it bounds
      const ph = a.phase, arch = m ? Math.abs(Math.sin(ph)) * 1.2 : 0;
      for (const [lx, off] of [[-5, 0], [5, Math.PI], [-3.5, Math.PI], [6.5, 0]] as const) leg(lx, -3, lx + (m ? Math.sin(ph + off) * 1.3 : 0), 0, 1.4, O2);
      ctx.translate(0, -2 - arch);
    } else ctx.translate(0, Math.sin(a.t * 2 + a.seed) * 0.4);
    curve([-7, -2, -11, -1.5, -14, land ? 0.5 : -1 + Math.sin(a.t * 3) * 0.4], 1.6, O);
    E(0, -2, 8, 3); F(O);
    E(7.8, -4.4, 3.4, 3); F(O);
    E(6.4, -7, 1, 1); F(O2);
    E(10.2, -3.6, 1.9, 1.5); F('#c9a27e');
    dot(11.8, -4, 0.7);
    eye(a, 8.4, -5.3, 0.55);
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.3; ctx.beginPath(); ctx.moveTo(11, -3.2); ctx.lineTo(13.5, -2.6); ctx.moveTo(11, -3.6); ctx.lineTo(13.5, -3.9); ctx.stroke(); ctx.restore();
  },
  elephant(a) {
    const ctx = pen.ctx, m = a.state === 'go', ph = a.phase, asleep = a.sleep > 0, G = T('#9aa0ad');
    const bob = m ? -Math.abs(Math.sin(ph)) * 0.5 : 0;
    for (const [lx, off, far] of [[-9, 0, 1], [6, Math.PI, 1], [-5.5, Math.PI, 0], [9.5, 0, 0]] as const) {
      const sw = m ? Math.sin(ph + off) * 1.4 : 0;
      ctx.save(); ctx.translate(lx, -8 + bob); ctx.rotate(-sw * 0.06);
      ctx.beginPath(); ctx.roundRect(-1.8, 0, 3.6, 8 - bob, 1.2); F(far ? T('#80868f') : G); ctx.restore();
    }
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(-12, -15 + bob); ctx.quadraticCurveTo(-14.5, -12 + bob, -13.6 + (asleep ? 0 : Math.sin(a.t * 2) * 0.6), -8 + bob); ctx.stroke(); ctx.restore();
    const br = asleep ? Math.sin(a.t * 1.1) * 0.35 : 0;
    E(0, -14 + bob, 12.5, 8 + br); F(G);
    // asleep: standing, the head a little lower, the trunk hanging still
    ctx.save(); ctx.translate(12, -17 + bob + (asleep ? 1 : 0));
    const sway = asleep ? 0 : Math.sin(a.t * 1.6 + a.seed) * 1.6 + (m ? Math.sin(ph) * 0.6 : 0);
    curve([4.2, 1, asleep ? 6.5 : 8.5, 4, (asleep ? 5.5 : 7) + sway, 12], 3.2, G);
    E(0, 0, 6, 6); F(G);
    P([[3.5, 4.2], [6.8, 5.8], [3.6, 5.2]]); F('#f6f1e4');
    E(-2.4, 0.6, 4, 5.8, -0.1 + (asleep ? 0 : Math.sin(a.t * 1.5 + a.seed) * 0.12)); F(T('#868c9a'));
    eye(a, 2.4, -1.4, 0.65);
    ctx.restore();
  },
  giraffe(a) {
    const ctx = pen.ctx, m = a.state === 'go', ph = a.phase, asleep = a.sleep > 0;
    const Y = T('#e8c15a'), Y2 = T('#d4ac48'), SP = T('#a8692e');
    const browse = a.special === 'browse';
    let by: number, nb: readonly [readonly [number, number], readonly [number, number]], nx: number, ny: number;
    if (asleep) {
      // lying down, legs folded, the neck still up
      by = -6; E(-6, -1, 3, 1.4); F(Y2); E(6, -1, 3, 1.4); F(Y2);
      E(0, by, 10, 5.5); F(Y); nb = [[4.5, -9], [8.5, -6]]; nx = 10.5; ny = -27;
    } else {
      const bob = m ? -Math.abs(Math.sin(ph)) * 0.6 : 0;
      for (const [lx, off, far] of [[-7, 0, 1], [5, Math.PI, 1], [-5, Math.PI, 0], [7, 0, 0]] as const) {
        const sw = m ? Math.sin(ph + off) * 1.6 : 0;
        leg(lx, -15 + bob, lx + sw, 0, 1.8, far ? Y2 : Y);
      }
      ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.6; line(-9.5, -19 + bob, -11.5, -11 + bob); ctx.restore(); dot(-11.5, -10.6 + bob, 0.9, SP);
      by = -19 + bob; E(0, by, 10, 5.8); F(Y);
      nb = [[4.5, by - 3], [8.5, by + 1]];
      nx = browse ? 15 : 12; ny = browse ? -47 + Math.sin(a.t * 5) * 0.4 : -41 + (m ? Math.sin(ph * 2) * 0.4 : 0);
    }
    for (const [x, y, r] of [[-5, -1, 1.8], [0, -3, 1.6], [4.5, 0.5, 1.7], [-1.5, 2, 1.3], [6, -2.5, 1.2], [-7.5, 1.5, 1.1]] as const) dot(x, by + y, r, SP);
    P([nb[0], nb[1], [nx + 1.6, ny + 2.5], [nx - 1.4, ny + 0.6]]); F(Y);
    dot((nb[0][0] + nx) / 2 + 1, (nb[0][1] + ny) / 2 + 1, 1.2, SP); dot(nx, ny + 7, 1, SP);
    ctx.save(); ctx.translate(nx, ny); ctx.rotate(browse ? -0.15 : 0.35);
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.7; line(-0.6, -1.8, -1, -4.4); line(0.8, -1.8, 0.6, -4.4); ctx.restore();
    dot(-1, -4.6, 0.7, SP); dot(0.6, -4.6, 0.7, SP);
    E(-1.6, -1.3, 1.6, 0.7, -0.5); F(Y);
    E(2.2, 0, 4, 2.2); F(Y); E(5.2, 0.5, 1.7, 1.5); F(Y2); dot(6.3, 0.1, 0.35);
    eye(a, 1.6, -0.6, 0.5);
    ctx.restore();
  },
  zebra(a) {
    const ctx = pen.ctx, m = a.state === 'go', ph = a.phase, Wh = T('#f6f6f2'), K = '#26262c';
    const graze = a.special === 'graze' || a.sleep > 0;
    const bob = m ? -Math.abs(Math.sin(ph)) * 0.6 : 0;
    for (const [lx, off, far] of [[-7, 0, 1], [5, Math.PI, 1], [-5, Math.PI, 0], [7, 0, 0]] as const) {
      const sw = m ? Math.sin(ph + off) * 1.8 : 0;
      leg(lx, -12 + bob, lx + sw, -0.6, 1.8, far ? T('#dcdcd6') : Wh); dot(lx + sw, -0.3, 1, K);
    }
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.6; line(-9.5, -16 + bob, -11, -9 + bob + Math.sin(a.t * 2) * 0.5); ctx.restore(); dot(-11, -8.6 + bob, 1, K);
    striped(() => E(0, -15 + bob, 10, 5.5), Wh, () => { ctx.lineWidth = 1.3; for (const x of [-7, -4.2, -1.4, 1.4, 4.2, 7]) { ctx.beginPath(); ctx.moveTo(x, -21 + bob); ctx.quadraticCurveTo(x + 1.6, -15 + bob, x - 0.4, -9 + bob); ctx.stroke(); } });
    // The neck keeps its thickness whichever way it points: it is built across its own direction.
    const bx = 7, by = -17 + bob, hx = graze ? 14 : 12.5, hy = graze ? -4.5 : -25 + bob;
    const len = Math.hypot(hx - bx, hy - by), vx = (hx - bx) / len, vy = (hy - by) / len, nx = -vy, ny = vx;
    const neck = () => P([[bx + nx * 3.4, by + ny * 3.4], [bx - nx * 3.4, by - ny * 3.4], [hx - nx * 2, hy - ny * 2], [hx + nx * 2, hy + ny * 2]]);
    striped(neck, Wh, () => { ctx.lineWidth = 1.1; for (const f of [0.3, 0.6]) { const cx = bx + (hx - bx) * f, cy = by + (hy - by) * f, w = 3.4 - f * 1.4; line(cx + nx * w, cy + ny * w, cx - nx * w + vx * 1.2, cy - ny * w + vy * 1.2); } });
    ctx.save(); ctx.strokeStyle = K; ctx.lineWidth = 1.6; ctx.setLineDash([0.9, 0.7]);
    const mx = vy * 3.2, my = -vx * 3.2; // the mane runs along the top of the neck
    line(bx + mx * 1.05, by + my * 1.05, hx + mx * 0.55 - vx * 1.5, hy + my * 0.55 - vy * 1.5); ctx.restore();
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(graze ? 1.25 + Math.sin(a.t * 3) * 0.04 : 0.55);
    P([[-0.6, -1.6], [-1.4, -4.2], [0.6, -2]]); F(Wh);
    E(2.6, 0, 5, 2.2); F(Wh);
    ctx.save(); ctx.lineWidth = 0.7; line(0.4, -2, 0.8, 2); line(2.2, -2.1, 2.6, 2.1); ctx.restore();
    E(6.6, 0.3, 1.8, 1.7); F(K);
    eye(a, 1.4, -0.6, 0.45);
    ctx.restore();
  },
  kangaroo(a) {
    // upright on big hind legs and long feet, the thick tail resting on the ground
    const ctx = pen.ctx, m = a.state === 'go', C = T('#c58a55'), L = T('#e8c39a'), D = T('#a8703f');
    const h = m ? Math.max(0, Math.sin(a.phase * 0.9)) : 0;
    const lean = m ? 0.4 + h * 0.15 : a.special === 'graze' ? 0.8 : 0.12;
    ctx.translate(0, -h * 8);
    ctx.beginPath(); ctx.moveTo(-2, -7); ctx.quadraticCurveTo(-9, -3.5 - h * 2, -16, -0.6 - h * 4); ctx.lineTo(-15.4, 0.8 - h * 4); ctx.quadraticCurveTo(-8.6, -1.2 - h * 2, -1.2, -2.6); ctx.closePath(); F(C);
    ctx.save(); ctx.translate(0.5, -1.2); ctx.rotate(m ? -h * 0.5 : 0); E(2.6, 0.2, 5, 1.2); F(D); ctx.restore();
    E(-0.6, -5.4, 4.8, 4.4, -0.35); F(C);
    ctx.save(); ctx.translate(-0.5, -6); ctx.rotate(lean);
    E(0.6, -6, 4.2, 7.2); F(C); E(2.2, -5.2, 2.2, 5, 0.05); F(L);
    leg(3, -9.5, 5.2, -6.6, 1, C);
    ctx.translate(1.4, -14.4); ctx.rotate(-lean * 0.85);
    E(-1.7, -3, 0.85, 2.6, -0.35); F(C); E(-0.3, -3.3, 0.85, 2.6, -0.1); F(C);
    E(0, 0, 2.8, 2.2, 0.1); F(C); E(2.8, 0.7, 1.9, 1.3, 0.1); F(C);
    dot(4.5, 0.5, 0.55); eye(a, 0.9, -0.6, 0.45);
    ctx.restore();
  },
  peacock(a) {
    const ctx = pen.ctx, white = a.variant.mark === 'white', m = a.state === 'go', ph = a.phase;
    const B = white ? '#f4f2ec' : T('#2d6fb5'), G = white ? '#ece9df' : T('#2f8a5a'), EYE = white ? '#dcd7c9' : '#2d6fb5', WING = white ? '#e6e2d6' : T('#8a6b4a');
    if (a.special === 'fan' && a.sleep <= 0) {
      const o = Math.min(1, a.effT * 1.5);
      const tips: [number, number, number][] = [];
      for (let i = 0; i <= 10; i++) { const ang = -Math.PI * (0.08 + (0.84 * i) / 10); tips.push([-3 + Math.cos(ang) * 16 * o, -9 + Math.sin(ang) * 16 * o, ang]); }
      ctx.save(); ctx.strokeStyle = G; ctx.lineWidth = 1.4; for (const [x, y] of tips) line(-3, -9, x, y); ctx.restore();
      for (const [x, y, ang] of tips) { E(x, y, 2.4 * o, 2.8 * o, ang + Math.PI / 2); F(G); E(x, y, 1.2 * o, 1.5 * o); ctx.fillStyle = EYE; ctx.fill(); dot(x, y, 0.5 * o, '#e0a431'); }
    } else {
      P([[-3, -7], [-16, -3.4], [-15.4, -1.4], [-3, -5]]); F(G);
      for (const [x, y] of [[-7, -5], [-10.5, -3.9], [-14, -2.8]] as const) dot(x, y, 0.9, EYE);
    }
    const sw = m ? Math.sin(ph) * 1.4 : 0;
    leg(-0.5, -5, -0.5 + sw, 0, 0.8, '#8f8a80'); leg(1.5, -5, 1.5 - sw, 0, 0.8, '#8f8a80');
    E(0, -8, 4.6, 3.6, -0.2); F(B); E(-1.2, -8, 3, 2.2, -0.2); F(WING);
    const peck = !m && a.special !== 'fan' && a.sleep <= 0 && (a.t + a.seed) % 5 < 0.6 ? 3 : 0;
    P([[2, -10], [4.4 + peck * 0.6, -17 + peck], [6 + peck * 0.6, -16.6 + peck], [4.6, -8.6]]); F(B);
    ctx.save(); ctx.translate(peck * 0.6, peck);
    E(5.4, -17.6, 1.8, 1.6); F(B);
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.45; for (const dx of [-0.8, 0, 0.8]) line(5 + dx * 0.4, -19, 4.4 + dx, -21.5); ctx.restore();
    for (const dx of [-0.8, 0, 0.8]) dot(4.4 + dx, -21.6, 0.55, B);
    P([[6.9, -17.8], [8.4, -17.2], [6.9, -16.8]]); F('#cbbfa5');
    eye(a, 5.8, -18, 0.4);
    ctx.restore();
  },
  squirrel(a) {
    const ctx = pen.ctx, R = T('#c0612e'), L = T('#f0d9b5');
    if (a.climb && a.climb.mode !== 'top') {
      // on the trunk, seen from behind: claws gripping the bark, the tail hanging down
      const g = Math.sin(a.phase * 2) * 0.9;
      ctx.scale(a.dir, 1);
      if (a.climb.mode === 'down') { ctx.translate(0, -6); ctx.rotate(Math.PI); ctx.translate(0, 6); }
      E(0.8, 1.6, 2.2, 4.6, 0.25); F(R); E(2.1, 5.4, 1.8, 1.8); F(R);
      leg(-1.8, -3, -3.8, -1.4 + g, 0.9, R); leg(1.8, -3, 3.8, -1.4 - g, 0.9, R);
      leg(-1.6, -8.5, -3.6, -10.6 - g, 0.9, R); leg(1.6, -8.5, 3.6, -10.6 + g, 0.9, R);
      E(0, -6, 2.8, 4.6); F(R);
      P([[-1.6, -13], [-2, -15.4], [-0.5, -13.6]]); F(R); P([[1.6, -13], [2, -15.4], [0.5, -13.6]]); F(R);
      E(0, -11.8, 2.3, 2.4); F(R);
      return;
    }
    const m = a.state === 'go', ph = a.phase;
    ctx.translate(0, m ? -Math.abs(Math.sin(ph * 1.4)) * 1.2 : 0);
    E(-5, -8, 3.2, 6, -0.35 + (m ? Math.sin(ph) * 0.1 : Math.sin(a.t * 2) * 0.05)); F(R); E(-6.4, -12.6, 2.6, 2.4); F(R);
    E(-1.4, -1.6, 2.6, 1.7); F(R); leg(2.8, -3, 3 + (m ? Math.sin(ph * 1.4) * 0.8 : 0), 0, 0.9, R);
    E(0, -4, 4, 3, -0.3); F(R); E(1.5, -3.6, 1.7, 2.2, -0.3); F(L);
    E(4, -7, 2.5, 2.2); F(R); P([[2.8, -8.6], [3.2, -11], [4.4, -8.8]]); F(R);
    dot(6.3, -7, 0.45); eye(a, 4.4, -7.6, 0.45);
    if (a.special === 'nut' || a.climb?.mode === 'top') { E(5.6, -4.4, 1.2, 1.1); F('#8a5a3b'); }
  },
  lizard(a) {
    const m = a.state === 'go', ph = a.phase, G = T('#7bb04a'), D = T('#5d8c36');
    const sw = m ? Math.sin(ph * 1.6) : 0;
    curve([-4, -1.8, -9, -1 + sw * 0.6, -14, -0.4 + Math.sin(a.t * 2) * 0.3], 1.3, G);
    leg(-3, -1.4, -4.5 + sw, 0, 0.7, G); leg(3, -1.4, 4.5 - sw, 0, 0.7, G);
    const pu = a.special === 'bask' ? Math.max(0, Math.sin(a.t * 2.5)) * 0.8 : 0; // push-ups in the sun
    E(0, -2 - pu * 0.5, 5.5, 1.7); F(G);
    dot(-2, -3 - pu * 0.5, 0.4, D); dot(0, -3.3 - pu * 0.5, 0.4, D); dot(2, -3.1 - pu * 0.5, 0.4, D);
    E(6.2, -2.4 - pu, 2.5, 1.5, 0.1); F(G);
    eye(a, 7, -2.9 - pu, 0.4);
  },
  koala(a) {
    const ctx = pen.ctx, G = T('#9aa1a8'), L = '#e2e5e9';
    E(-1.5, -0.6, 2, 1.2); F(G); E(2, -0.6, 2, 1.2); F(G);
    const br = a.sleep > 0 ? Math.sin(a.t * 1.2) * 0.25 : 0;
    E(0, -6, 5 + br, 6); F(G); E(0.8, -5, 3, 4); F(L);
    E(3.2, -6.5, 1.5, 3, 0.4); F(G);
    ctx.save(); ctx.translate(0, a.sleep > 0 ? 1 : 0); if (a.sleep > 0) ctx.rotate(0.12);
    E(-3.4, -15.6, 2.7, 2.7); F(G); E(-3.4, -15.6, 1.5, 1.5); ctx.fillStyle = L; ctx.fill();
    E(5.4, -15.6, 2.7, 2.7); F(G); E(5.4, -15.6, 1.5, 1.5); ctx.fillStyle = L; ctx.fill();
    E(1, -13, 4.6, 4); F(G);
    E(2, -12.2, 1.4, 1.9); F('#3a3a42');
    eye(a, -0.6, -14, 0.5); eye(a, 4, -14, 0.5);
    ctx.restore();
  },
  sloth(a) {
    // hangs below the branch, which is at (0, 0)
    const ctx = pen.ctx, B = T('#9b8466'), F2 = '#e5d6b8', D = T('#5a4632');
    ctx.rotate(Math.sin(a.t * 0.6 + a.seed) * 0.06);
    leg(-6, 0.4, -5, 9, 1.6, B); leg(6, 0.4, 5, 9, 1.6, B);
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.5; for (const x of [-6, -4, 4, 6]) line(x, 0.6, x + 0.9, -0.9); ctx.restore();
    E(0, 9, 6.4, 4.2); F(B);
    leg(-4, 0.4, -3.5, 7, 1.6, B); leg(4, 0.4, 3.5, 7, 1.6, B);
    E(6.2, 10.6, 3.5, 3.1); F(B); E(6.8, 11, 2.6, 2.1); F(F2);
    E(5.8, 10.6, 1.3, 0.6, 0.35); ctx.fillStyle = D; ctx.fill(); E(8, 10.5, 1.1, 0.55, -0.35); ctx.fillStyle = D; ctx.fill();
    eye(a, 5.9, 10.6, 0.4); eye(a, 7.9, 10.5, 0.4);
    dot(7.2, 11.8, 0.5);
  },
  flamingo(a) {
    const m = a.state === 'go', ph = a.phase, P1 = T('#f29bb5'), D = T('#e0708f');
    const feed = a.special === 'feed', asleep = a.sleep > 0;
    if (m) { leg(-0.5, -14, -0.5 + Math.sin(ph) * 2, 0, 0.7, D); leg(0.8, -14, 0.8 - Math.sin(ph) * 2, 0, 0.7, D); }
    else { leg(0, -14, 0, 0, 0.7, D); if (!feed) { leg(0.6, -14, 3, -10, 0.7, D); leg(3, -10, 0.8, -9, 0.7, D); } else leg(1.2, -14, 1.4, 0, 0.7, D); }
    P([[-6, -16.6], [-8.6, -15.6], [-6, -15]]); F(D);
    E(-1, -16, 5.4, 3.6, -0.1); F(P1); E(-2, -16.4, 3.6, 2.2, -0.1); F(D);
    let hx: number, hy: number;
    if (asleep) { hx = -0.5; hy = -20.4; curve([3, -17.5, 2, -20, hx + 1, hy + 0.5], 1.6, P1); }
    else if (feed) { hx = 6.5; hy = -3.6; curve([3, -17.5, 8, -17, 8, -8, hx, hy], 1.6, P1); }
    else { hx = 4; hy = -28 + Math.sin(a.t * 1.1 + a.seed) * 0.3; curve([3, -17.5, 7, -20, 1, -24, hx, hy], 1.6, P1); }
    E(hx, hy, 1.9, 1.6); F(P1);
    if (feed) { P([[hx + 0.8, hy + 0.6], [hx + 1.8, hy + 3.4], [hx + 0.1, hy + 2.6]]); F('#f6efe4'); }
    else if (!asleep) { P([[hx + 1.4, hy - 0.4], [hx + 3.8, hy + 1], [hx + 3, hy + 2.4], [hx + 1.2, hy + 1]]); F('#f6efe4'); P([[hx + 3.2, hy + 1.4], [hx + 3.8, hy + 1], [hx + 3, hy + 2.4]]); F(INK); }
    eye(a, hx + 0.4, hy - 0.5, 0.4);
  },
  ladybug(a) {
    const ctx = pen.ctx, flying = a.state === 'go' && a.sleep <= 0;
    if (flying) { const f = Math.abs(Math.sin(a.t * 30)); ctx.save(); ctx.globalAlpha = 0.7; E(-1, -4.5, 2.6, 1.2 * f + 0.3, -0.5); F('#eef6fb'); E(1, -4.6, 2.4, 1.1 * f + 0.3, 0.4); F('#eef6fb'); ctx.restore(); }
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.4; line(-1.5, -0.6, -2.2, 0.3); line(0, -0.6, 0, 0.4); line(1.5, -0.6, 2.1, 0.3); ctx.restore();
    ctx.beginPath(); ctx.ellipse(0, -0.6, 3.2, 2.8, 0, Math.PI, 0); ctx.closePath(); F(T('#d93a2e'));
    dot(-1.4, -2, 0.55); dot(0.6, -2.7, 0.5); dot(1.6, -1.4, 0.5); dot(-0.4, -1.2, 0.45);
    E(3.3, -0.9, 1.3, 1.2); F(INK); dot(3.7, -1.2, 0.35, '#ffffff');
  },
  parrot(a) {
    const ctx = pen.ctx, R = T('#e2463f'), B = T('#3a6fd0'), Yw = '#f2cf3a';
    // the wings beat whenever it is in the air, folded only when it sits somewhere
    const flying = a.sleep <= 0 && (a.state === 'go' || !a.perchSpot);
    P([[-3, -2], [-11, 1.5], [-10.4, 2.8], [-2, -0.4]]); F(B);
    if (!flying) { leg(0.5, -1.2, 0.3, 0.4, 0.7, '#8a8a8a'); leg(2, -1.2, 2.2, 0.4, 0.7, '#8a8a8a'); }
    E(0, -3.6, 4.2, 2.8, -0.35); F(R);
    if (flying) { const f = Math.sin(a.t * 16); E(-1, -6 - f * 2.4, 4.6, 1.6, -0.3 - f * 0.5); F(B); E(-0.5, -5.6 - f * 2.4, 2.6, 0.8, -0.3 - f * 0.5); F(Yw); }
    else { E(-1, -3.6, 3.4, 1.9, -0.3); F(B); E(-0.4, -3.2, 2.2, 0.9, -0.3); F(Yw); }
    E(3.4, -6.6, 2.3, 2.2); F(R); E(4.3, -6.8, 1.1, 1); ctx.fillStyle = '#fbf3e6'; ctx.fill();
    P([[5.3, -7.2], [7.4, -6.2], [5.7, -4.9]]); F('#eee6cf');
    eye(a, 4.4, -7, 0.45);
  },
  octopus(a) {
    const ctx = pen.ctx, P1 = T('#e07a9a'), P2 = T('#f0a5bd');
    ctx.save(); ctx.strokeStyle = P1; ctx.lineCap = 'round'; ctx.lineWidth = 1.6;
    for (let i = 0; i < 6; i++) { const bx = -4 + i * 1.6; ctx.beginPath(); ctx.moveTo(bx, -4); ctx.quadraticCurveTo(bx + Math.sin(a.t * 2 + i) * 3, 2, bx + Math.sin(a.t * 1.5 + i * 1.3) * 4, 7); ctx.stroke(); }
    ctx.restore();
    if (a.special === 'wave') { const w = Math.sin(a.t * 3); curve([4, -5, 9, -8 + w, 8 + w * 2, -14], 1.6, P1); }
    E(0, -9.5, 5, 6.2, Math.sin(a.t * 0.8) * 0.08); F(P1);
    dot(-2, -12, 0.8, P2); dot(1.5, -13.4, 0.6, P2); dot(2.6, -10.6, 0.7, P2);
    E(-1.8, -7.6, 1.3, 1.5); F('#ffffff'); E(1.8, -7.6, 1.3, 1.5); F('#ffffff');
    eye(a, -1.6, -7.4, 0.6); eye(a, 2, -7.4, 0.6);
  },
  whale(a) {
    const ctx = pen.ctx, B = T('#5d7894');
    if (a.special === 'fluke') {
      // the back rolls under and the tail rises clear of the water
      const up = Math.min(1, a.effT * 1.2);
      E(-2, -1 + up * 3, 16, 4.5, 0.15 * up); F(B);
      leg(-12, -1, -15, -10 * up, 3.2, B);
      ctx.save(); ctx.translate(-15, -11 * up); ctx.rotate(-0.15);
      P([[0, 0], [-7, -3.5], [-6, -5], [-0.5, -2.4], [5, -5], [6.5, -3.4]]); F(B);
      ctx.restore();
      return;
    }
    E(0, -2, 20, 5.5); F(B);
    P([[-8, -7], [-11, -9.8], [-5, -7.4]]); F(B);
    P([[-19, -2], [-25, -5], [-24, -2], [-25, 1]]); F(B);
    dot(13, -1.8, 0.6);
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.5; line(12, 0.2, 18, -1.2); ctx.restore();
  },
  dolphin(a) {
    const ctx = pen.ctx, G = T('#7b9bb5');
    ctx.beginPath(); ctx.moveTo(-10, -2); ctx.quadraticCurveTo(0, -8.5, 9, -3.6); ctx.lineTo(13.4, -2.6); ctx.lineTo(9, -1.6); ctx.quadraticCurveTo(0, 0.8, -10, -1); ctx.closePath(); F(G);
    E(3, -1.6, 6, 1.1); ctx.fillStyle = '#dfe7ee'; ctx.fill();
    P([[-1, -5.6], [-3.6, -9.4], [2.2, -6]]); F(G);
    P([[-10, -1.5], [-13.6, -4.4], [-12.4, -1.5], [-13.6, 1.4]]); F(G);
    P([[3, -2.6], [1, 0.6], [4.6, -1.6]]); F(G);
    eye(a, 8, -3.6, 0.45);
  },
  seal(a) {
    const ctx = pen.ctx, G = T('#8e99a6'), D = T('#6f7a88');
    const lie = a.special === 'lie' || a.sleep > 0;
    ctx.translate(0, a.state === 'go' && a.sink < 1 ? -Math.abs(Math.sin(a.phase * 1.2)) : 0);
    P([[-8, -2], [-12.6, -4], [-12, -0.6]]); F(D); P([[-8, -1.4], [-12.4, 0.8], [-11, -2.2]]); F(D);
    E(0, -3.6, 9, 3.6); F(G);
    dot(-3, -5, 0.6, D); dot(1, -5.6, 0.5, D); dot(-5, -3.4, 0.5, D);
    E(3.6, -1, 2.4, 1, 0.5 + (lie && a.sleep <= 0 ? Math.sin(a.t * 2) * 0.15 : 0)); F(D);
    ctx.save(); ctx.translate(8.4, a.sleep > 0 ? -3.6 : lie ? -7 : -6);
    E(0, 0, 3.4, 3); F(G); E(2.4, 0.6, 1.6, 1.3); F('#c3cad3'); dot(3.8, 0.2, 0.55);
    eye(a, 0.8, -0.8, 0.7);
    ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 0.3; line(3, 0.9, 5.6, 1.4); line(3, 0.6, 5.6, 0.2); ctx.restore();
    ctx.restore();
  },
  beaver(a) {
    const ctx = pen.ctx, B = T('#7a5132'), D = T('#4a3a30');
    E(-9.6, -1.2, 4.2, 1.4, -0.05); F(D);
    ctx.save(); ctx.strokeStyle = '#6b5a4c'; ctx.lineWidth = 0.4; line(-12, -1.8, -8, -0.6); line(-12, -0.6, -8, -1.8); ctx.restore();
    E(-3, -0.8, 2, 1); F(D); E(3, -0.8, 2, 1); F(D);
    E(0, -5, 7, 4.6); F(B);
    const g = a.special === 'gnaw' ? Math.sin(a.t * 12) * 0.4 : 0;
    ctx.save(); ctx.translate(6.2, -7.4 + g);
    E(-1.6, -2.6, 0.9, 0.9); F(B); E(0, 0, 3.4, 3); F(B); E(2.4, 0.6, 1.5, 1.2); F(T('#9a7152')); dot(3.6, -0.1, 0.7);
    ctx.beginPath(); ctx.rect(2.2, 1.6, 1.2, 1.6); F('#f6f1e4');
    eye(a, 0.6, -0.9, 0.5);
    ctx.restore();
  },
};
