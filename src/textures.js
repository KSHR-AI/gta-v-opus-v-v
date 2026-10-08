import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function noise(ctx, w, h, amount, alpha = 0.08) {
  for (let i = 0; i < amount; i++) {
    const v = Math.random() > 0.5 ? 255 : 0;
    ctx.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

function tex(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Road segment: 14m wide (u), 16m long (v). Two lanes each way.
export function roadTexture() {
  const [c, ctx] = canvas(256, 292);
  ctx.fillStyle = '#3a3b3f';
  ctx.fillRect(0, 0, 256, 292);
  noise(ctx, 256, 292, 5000, 0.12);
  const px = 256 / 14;
  ctx.fillStyle = '#e8c33a';
  ctx.fillRect(128 - 0.3 * px, 0, 0.12 * px * 1.2, 292);
  ctx.fillRect(128 + 0.12 * px, 0, 0.12 * px * 1.2, 292);
  ctx.fillStyle = '#e9e9e9';
  for (const off of [-3.5, 3.5]) {
    for (let y = 0; y < 292; y += 73) ctx.fillRect(128 + off * px - 1.5, y, 3, 40);
  }
  ctx.fillRect(128 - 6.6 * px, 0, 3, 292);
  ctx.fillRect(128 + 6.6 * px - 3, 0, 3, 292);
  // tire wear
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  for (const off of [-5.6, -4.4, -2.1, -0.9, 0.9, 2.1, 4.4, 5.6]) ctx.fillRect(128 + off * px - 6, 0, 12, 292);
  return tex(c);
}

export function asphaltTexture() {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#3a3b3f';
  ctx.fillRect(0, 0, 256, 256);
  noise(ctx, 256, 256, 5000, 0.12);
  return tex(c);
}

export function crosswalkTexture() {
  const [c, ctx] = canvas(256, 64);
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(235,235,235,0.92)';
  for (let x = 8; x < 256; x += 26) ctx.fillRect(x, 4, 14, 56);
  return tex(c, false);
}

export function sidewalkTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#b9b4ab';
  ctx.fillRect(0, 0, 128, 128);
  noise(ctx, 128, 128, 1500, 0.1);
  ctx.strokeStyle = 'rgba(80,75,70,0.45)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 128; i += 64) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
  }
  return tex(c);
}

export function grassTexture() {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#5f9a3c';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const g = 110 + Math.random() * 70;
    ctx.fillStyle = `rgba(${60 + Math.random() * 40},${g},${30 + Math.random() * 30},0.5)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 2 + Math.random() * 3);
  }
  return tex(c);
}

export function sandTexture() {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#e3cf98';
  ctx.fillRect(0, 0, 256, 256);
  noise(ctx, 256, 256, 9000, 0.12);
  return tex(c);
}

export function plazaTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#a8a29a';
  ctx.fillRect(0, 0, 128, 128);
  noise(ctx, 128, 128, 1500, 0.1);
  ctx.strokeStyle = 'rgba(70,65,60,0.35)';
  for (let i = 0; i <= 128; i += 32) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
  }
  return tex(c);
}

export function parkingTexture() {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#45464a';
  ctx.fillRect(0, 0, 256, 256);
  noise(ctx, 256, 256, 4000, 0.12);
  ctx.fillStyle = '#ddd';
  for (let x = 0; x <= 256; x += 32) { ctx.fillRect(x, 0, 3, 90); ctx.fillRect(x, 166, 3, 90); }
  return tex(c);
}

export function concreteTexture(color = '#8d8a85') {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  noise(ctx, 128, 128, 2500, 0.15);
  return tex(c);
}

export function corrugatedTexture(color) {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 8) {
    const g = ctx.createLinearGradient(x, 0, x + 8, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, 8, 128);
  }
  noise(ctx, 128, 128, 800, 0.15);
  return tex(c);
}

export function woodTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#8a6440';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    ctx.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.15})`;
    ctx.fillRect(0, y, 128, 2);
  }
  noise(ctx, 128, 128, 1500, 0.15);
  return tex(c);
}

export function glowTexture() {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}

export function smokeTexture() {
  const [c, ctx] = canvas(64, 64);
  for (let i = 0; i < 12; i++) {
    const x = 20 + Math.random() * 24, y = 20 + Math.random() * 24, r = 10 + Math.random() * 14;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}

export function signTexture(text, bg = '#1d6b3a', fg = '#fff') {
  const [c, ctx] = canvas(512, 128);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = fg;
  ctx.font = 'bold 64px Arial Black, Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
