import { WEAPONS } from './weapons.js';
import { LAND, HALF, NB, roadCoord, RW, districtOf, P, SW } from './city.js';

const $ = (id) => document.getElementById(id);
const MAP_SCALE = 1.6; // pixels per meter in the pre-rendered map

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), hp: $('hp-bar'), armor: $('armor-bar'), money: $('money'), wanted: $('wanted'), weapon: $('weapon-name'), ammo: $('ammo'),
      clock: $('clock'), zone: $('zone'), vehicle: $('vehicle-name'), speedo: $('speedo'), radio: $('radio'), mission: $('mission-text'),
      objective: $('objective'), timer: $('timer'), help: $('help'), crosshair: $('crosshair'), hit: $('hitmarker'), feed: $('feed'),
      big: $('big-message'), vignette: $('damage-vignette'), bigmap: $('bigmap'),
    };
    this.minimap = $('minimap').getContext('2d');
    this.bigCanvas = $('bigmap-canvas');
    this.shownMoney = 0;
    this.zoneTimer = 0;
    this.lastZone = '';
    this.timers = {};
    this.renderMap();
  }

  // Pre-render a top-down map of the city.
  renderMap() {
    const w = (LAND.maxX - LAND.minX + 200) * MAP_SCALE, h = (LAND.maxZ - LAND.minZ + 200) * MAP_SCALE;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    this.mapOrigin = { x: LAND.minX - 100, z: LAND.minZ - 100 };
    const X = (x) => (x - this.mapOrigin.x) * MAP_SCALE, Z = (z) => (z - this.mapOrigin.z) * MAP_SCALE;
    ctx.fillStyle = '#3a6f96';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#d8c48a';
    ctx.fillRect(X(LAND.minX), Z(LAND.minZ), (LAND.maxX - LAND.minX) * MAP_SCALE, (LAND.maxZ - LAND.minZ) * MAP_SCALE);
    const city = this.game.city;
    for (const s of city.minimapShapes) {
      if (s.kind === 'harbor') ctx.fillStyle = '#9a9a96';
      else if (s.kind === 'pier') ctx.fillStyle = '#8a6a48';
      else continue;
      ctx.fillRect(X(s.minX), Z(s.minZ), (s.maxX - s.minX) * MAP_SCALE, (s.maxZ - s.minZ) * MAP_SCALE);
    }
    // roads
    ctx.fillStyle = '#4a4d55';
    for (let i = 0; i <= NB; i++) {
      const c0 = roadCoord(i);
      ctx.fillRect(X(-HALF - RW), Z(c0 - RW), (2 * HALF + 2 * RW) * MAP_SCALE, 2 * RW * MAP_SCALE);
      ctx.fillRect(X(c0 - RW), Z(-HALF - RW), 2 * RW * MAP_SCALE, (2 * HALF + 2 * RW) * MAP_SCALE);
    }
    // blocks
    for (const b of city.blocks) {
      ctx.fillStyle = '#b8b2a6';
      ctx.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * MAP_SCALE, (b.z1 - b.z0) * MAP_SCALE);
      const col = { downtown: '#c9c3b8', commercial: '#c9c3b8', suburban: '#86b26a', park: '#5f9a4a', parking: '#6a6c72', industrial: '#a09a90' }[b.type];
      ctx.fillStyle = col;
      ctx.fillRect(X(b.ix0), Z(b.iz0), (b.ix1 - b.ix0) * MAP_SCALE, (b.iz1 - b.iz0) * MAP_SCALE);
    }
    for (const s of city.minimapShapes) {
      if (s.kind === 'building' || s.kind === 'prop') ctx.fillStyle = '#857f76';
      else if (s.kind === 'ramp') ctx.fillStyle = '#e0b040';
      else if (s.kind === 'fountain') ctx.fillStyle = '#5ab0e0';
      else continue;
      ctx.fillRect(X(s.minX), Z(s.minZ), (s.maxX - s.minX) * MAP_SCALE, (s.maxZ - s.minZ) * MAP_SCALE);
    }
    void districtOf; void P; void SW;
    this.mapCanvas = c;
  }

  worldToMap(x, z) { return [(x - this.mapOrigin.x) * MAP_SCALE, (z - this.mapOrigin.z) * MAP_SCALE]; }

  blips() {
    const g = this.game, out = [];
    const L = g.city.locations;
    out.push({ x: L.hospital.x, z: L.hospital.z, icon: 'H', color: '#e53935' });
    out.push({ x: L.police.x, z: L.police.z, icon: 'P', color: '#1e63d6' });
    out.push({ x: L.spray.x, z: L.spray.z, icon: 'S', color: '#00b894' });
    out.push({ x: L.safehouse.x, z: L.safehouse.z, icon: '⌂', color: '#2ecc71' });
    for (const b of g.missions.blips()) out.push(b);
    for (const p of g.pickups.blips()) out.push(p);
    for (const v of g.vehicles) {
      if (v.isPolice && v.driver && v.driver !== g.player && g.police.wanted > 0) out.push({ x: v.pos.x, z: v.pos.z, dot: true, color: Math.floor(g.time * 4) % 2 ? '#ff3030' : '#3060ff', r: 4 });
    }
    for (const p of g.peds.all) {
      if (p.dead) continue;
      if (p.role === 'cop' && g.police.wanted > 0) out.push({ x: p.pos.x, z: p.pos.z, dot: true, color: '#4a7dff', r: 2.5 });
      if (p.role === 'gang') out.push({ x: p.pos.x, z: p.pos.z, dot: true, color: '#ff4040', r: 3 });
    }
    return out;
  }

  drawMinimap() {
    const g = this.game, ctx = this.minimap, W = 440;
    const p = g.player.worldPos;
    const speed = g.player.speed;
    const zoom = 1.7 - Math.min(0.7, speed / 60); // canvas px per map px
    const rot = g.cameraRig.yaw;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#3a6f96'; ctx.fillRect(0, 0, W, W);
    ctx.translate(W / 2, W / 2);
    ctx.rotate(rot);
    ctx.scale(zoom, zoom);
    const [mx, mz] = this.worldToMap(p.x, p.z);
    ctx.drawImage(this.mapCanvas, -mx, -mz);
    // GPS route
    const route = g.missions.gpsRoute?.();
    if (route && route.length > 1) {
      ctx.strokeStyle = '#d65cf0'; ctx.lineWidth = 6 / zoom * 1.6; ctx.lineJoin = 'round';
      ctx.beginPath();
      route.forEach((pt, i) => { const [x, z] = this.worldToMap(pt.x, pt.z); (i ? ctx.lineTo : ctx.moveTo).call(ctx, x - mx, z - mz); });
      ctx.stroke();
    }
    ctx.restore();
    // blips (unrotated icons, positioned with rotation)
    const R = W / 2 - 18;
    for (const b of this.blips()) {
      let dx = (b.x - p.x) * MAP_SCALE * zoom, dz = (b.z - p.z) * MAP_SCALE * zoom;
      const c = Math.cos(rot), s = Math.sin(rot);
      let x = dx * c - dz * s, y = dx * s + dz * c;
      const d = Math.hypot(x, y);
      if (d > R) { if (!b.edge && !b.icon) continue; x *= R / d; y *= R / d; }
      this.drawBlip(ctx, W / 2 + x, W / 2 + y, b, 1);
    }
    // player arrow
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(rot - g.player.heading + Math.PI);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(11, 12); ctx.lineTo(0, 6); ctx.lineTo(-11, 12); ctx.closePath();
    ctx.stroke(); ctx.fill();
    ctx.restore();
    // north marker
    const nx = W / 2 + Math.sin(rot) * (W / 2 - 16), ny = W / 2 - Math.cos(rot) * (W / 2 - 16);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.strokeText('N', nx, ny); ctx.fillText('N', nx, ny);
    // wanted radius tint
    if (g.police.wanted > 0) {
      ctx.fillStyle = Math.floor(g.time * 2) % 2 ? 'rgba(255,0,0,0.12)' : 'rgba(0,60,255,0.12)';
      ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawBlip(ctx, x, y, b, s) {
    if (b.dot) {
      ctx.fillStyle = b.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, (b.r || 4) * 2 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      return;
    }
    const r = 15 * s;
    ctx.fillStyle = b.color || '#ffcf3d'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3 * s;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${18 * s}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(b.icon, x, y + 1);
  }

  drawBigMap() {
    const c = this.bigCanvas;
    const size = Math.min(innerWidth, innerHeight) * 0.9 * devicePixelRatio;
    if (c.width !== Math.round(size)) { c.width = c.height = Math.round(size); }
    const ctx = c.getContext('2d');
    const k = size / Math.max(this.mapCanvas.width, this.mapCanvas.height);
    ctx.fillStyle = '#3a6f96'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(this.mapCanvas, 0, 0, this.mapCanvas.width * k, this.mapCanvas.height * k);
    const route = this.game.missions.gpsRoute?.();
    if (route && route.length > 1) {
      ctx.strokeStyle = '#d65cf0'; ctx.lineWidth = 4;
      ctx.beginPath();
      route.forEach((pt, i) => { const [x, z] = this.worldToMap(pt.x, pt.z); (i ? ctx.lineTo : ctx.moveTo).call(ctx, x * k, z * k); });
      ctx.stroke();
    }
    for (const b of this.blips()) {
      const [x, z] = this.worldToMap(b.x, b.z);
      this.drawBlip(ctx, x * k, z * k, b, 0.8 * devicePixelRatio);
    }
    const p = this.game.player.worldPos;
    const [px, pz] = this.worldToMap(p.x, p.z);
    ctx.save(); ctx.translate(px * k, pz * k); ctx.rotate(-this.game.player.heading + Math.PI);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    const s = 10 * devicePixelRatio;
    ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s * 0.8); ctx.lineTo(0, s * 0.4); ctx.lineTo(-s * 0.7, s * 0.8); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
    // labels
    ctx.font = `bold ${14 * devicePixelRatio}px Arial`; ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.textAlign = 'center';
    const label = (t, x, z) => { const [mx, mz] = this.worldToMap(x, z); ctx.fillText(t, mx * k, mz * k); };
    label('DOWNTOWN SOLANO', 0, 0);
    label('HARBOR ROW', -200, -HALF + 30);
    label('PORT DOCKS', -170, -HALF - 30);
    label('SUNSET BEACH', 0, HALF + 60);
    label('PALMETTO HEIGHTS', -HALF + 60, HALF - 60);
    label('PALMETTO HEIGHTS', HALF - 60, -HALF + 90);
    label('MERCADO', 150, 120);
  }

  update(dt) {
    const g = this.game, pl = g.player;
    this.el.hp.style.width = `${(pl.health / pl.maxHealth) * 100}%`;
    this.el.armor.style.width = `${pl.armor}%`;
    this.shownMoney += (pl.money - this.shownMoney) * Math.min(1, dt * 8);
    if (Math.abs(pl.money - this.shownMoney) < 1) this.shownMoney = pl.money;
    this.el.money.textContent = `$${Math.round(this.shownMoney).toLocaleString()}`;
    const w = g.police.wanted;
    let stars = '';
    for (let i = 0; i < 5; i++) stars += `<span class="star ${i < w ? 'on' : ''}">★</span>`;
    if (this.el.wanted.dataset.w !== `${w}`) { this.el.wanted.innerHTML = stars; this.el.wanted.dataset.w = `${w}`; }
    this.el.wanted.classList.toggle('flash', w > 0 && !g.police.seen);
    this.el.wanted.style.visibility = w > 0 ? 'visible' : 'hidden';
    const wp = WEAPONS[pl.weapon];
    this.el.weapon.textContent = wp.name;
    this.el.ammo.textContent = wp.clip ? `${pl.clip[pl.weapon]} / ${pl.ammo[pl.weapon]}${pl.reloading > 0 ? ' (reloading)' : ''}` : '';
    this.el.clock.textContent = g.sky.clock;
    this.el.crosshair.classList.toggle('on', !pl.vehicle && pl.aiming && !wp.melee);
    // zone name
    const zone = g.city.zoneName(pl.worldPos.x, pl.worldPos.z);
    if (zone !== this.lastZone) { this.lastZone = zone; this.el.zone.textContent = zone; this.el.zone.style.opacity = 1; this.zoneTimer = 4; }
    if ((this.zoneTimer -= dt) <= 0) this.el.zone.style.opacity = 0;
    if ((this.vehTimer -= dt) <= 0) this.el.vehicle.style.opacity = 0;
    if ((this.radioTimer -= dt) <= 0) this.el.radio.style.opacity = 0;
    this.el.speedo.innerHTML = pl.vehicle ? `${Math.round(Math.abs(pl.vehicle.forwardSpeed) * 3.6)} <small>KM/H</small>` : '';
    for (const k of Object.keys(this.timers)) {
      this.timers[k].t -= dt;
      if (this.timers[k].t <= 0) { this.timers[k].fn(); delete this.timers[k]; }
    }
    this.drawMinimap();
    if (!this.el.bigmap.classList.contains('hidden')) this.drawBigMap();
  }

  later(key, t, fn) { this.timers[key] = { t, fn }; }

  showVehicleName(name) { this.el.vehicle.textContent = name; this.el.vehicle.style.opacity = 1; this.vehTimer = 3; }
  showRadio(name) { this.el.radio.textContent = `♫ ${name}`; this.el.radio.style.opacity = 1; this.radioTimer = 3; }

  feed(text) {
    const d = document.createElement('div');
    d.innerHTML = text;
    this.el.feed.appendChild(d);
    setTimeout(() => d.remove(), 4000);
  }

  big(text, cls = 'gold', sub = '', dur = 3.5) {
    const e = this.el.big;
    e.className = cls;
    e.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    e.style.opacity = 1;
    this.later('big', dur, () => { e.style.opacity = 0; });
  }

  missionText(html, dur = 6) {
    this.el.mission.innerHTML = html;
    this.later('mission', dur, () => { this.el.mission.innerHTML = ''; });
  }

  objective(text) { this.el.objective.textContent = text || ''; }
  setTimer(text) { this.el.timer.textContent = text || ''; }

  help(html, dur = 7) {
    this.el.help.innerHTML = html;
    this.later('help', dur, () => { this.el.help.innerHTML = ''; });
  }

  hitMarker() {
    this.el.hit.style.opacity = 1;
    this.later('hit', 0.12, () => { this.el.hit.style.opacity = 0; });
  }

  damageFlash() {
    this.el.vignette.style.opacity = 0.8;
    this.later('vig', 0.25, () => { this.el.vignette.style.opacity = this.game.player.health < 30 ? 0.5 : 0; });
  }

  toggleMap() { this.el.bigmap.classList.toggle('hidden'); }
}
