import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { Ped } from './peds.js';
import { roadCoord, NB, RW, SW, P, HALF } from './city.js';

const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];

function markerMesh(color = 0xffcf3d, r = 1.4, h = 2.4) {
  const g = new THREE.Group();
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h, 32, 1, true),
    new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color) } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: 'varying float vy; void main(){ vy = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 color; varying float vy; void main(){ gl_FragColor = vec4(color, (1.0 - vy) * 0.75); }',
    }),
  );
  cyl.position.y = h / 2;
  const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.85, r, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(cyl, ring);
  return g;
}

const sidewalk = (bi, bj, side) => {
  const x0 = roadCoord(bi) + RW + SW / 2, z0 = roadCoord(bj) + RW + SW / 2, len = P - 2 * RW - SW;
  return [{ x: x0 + len / 2, z: z0 }, { x: x0 + len, z: z0 + len / 2 }, { x: x0 + len / 2, z: z0 + len }, { x: x0, z: z0 + len / 2 }][side];
};
const roadPoint = (i, j, dir, along = 32, lane = 3.5) => {
  const x = roadCoord(i) + DX[dir] * along - DZ[dir] * lane, z = roadCoord(j) + DZ[dir] * along + DX[dir] * lane;
  return { x, z, heading: Math.atan2(DX[dir], DZ[dir]) };
};

export class Missions {
  constructor(game) {
    this.game = game;
    this.active = null;
    this.markers = [];
    this.contacts = [
      { id: 'marisol', name: 'Marisol', initial: 'M', color: '#ffcf3d', pos: sidewalk(4, 4, 0), queue: ['delivery', 'cleanup'] },
      { id: 'dex', name: 'Dex', initial: 'D', color: '#4fc3f7', pos: sidewalk(6, 6, 3), queue: ['hotProperty', 'race'] },
      { id: 'vinnie', name: 'Vinnie', initial: 'V', color: '#ff8a65', pos: sidewalk(1, 3, 1), queue: ['wreckage'] },
    ];
    for (const c of this.contacts) {
      c.marker = markerMesh(new THREE.Color(c.color).getHex());
      c.marker.position.set(c.pos.x, game.city.groundHeight(c.pos.x, c.pos.z), c.pos.z);
      game.scene.add(c.marker);
    }
    this.completed = 0;
    this.promptShown = 0;
  }

  get total() { return this.contacts.reduce((n, c) => n + c.queue.length, 0) + this.completed; }

  blips() {
    if (this.active) return this.active.blips();
    return this.contacts.filter((c) => c.queue.length).map((c) => ({ x: c.pos.x, z: c.pos.z, icon: c.initial, color: c.color, edge: true }));
  }

  gpsRoute() {
    if (!this.active || !this.active.target) return null;
    const t = this.active.target;
    const p = this.game.player.worldPos;
    const city = this.game.city;
    if (Math.hypot(t.x - p.x, t.z - p.z) < 40) return [{ x: p.x, z: p.z }, t];
    const a = city.nearestNode(p.x, p.z), b = city.nearestNode(t.x, t.z);
    const path = [];
    let i = a.i, j = a.j;
    path.push({ x: p.x, z: p.z }, { x: roadCoord(i), z: roadCoord(j) });
    // L-shaped route along the grid (good enough on a Manhattan layout)
    while (i !== b.i) { i += Math.sign(b.i - i); path.push({ x: roadCoord(i), z: roadCoord(j) }); }
    while (j !== b.j) { j += Math.sign(b.j - j); path.push({ x: roadCoord(i), z: roadCoord(j) }); }
    path.push(t);
    return path;
  }

  addMarker(x, z, color, r, h) {
    const m = markerMesh(color, r, h);
    m.position.set(x, this.game.city.groundHeight(x, z), z);
    this.game.scene.add(m);
    this.markers.push(m);
    return m;
  }

  clearMarkers() {
    for (const m of this.markers) this.game.scene.remove(m);
    this.markers = [];
  }

  update(dt) {
    const g = this.game;
    const t = g.time;
    for (const c of this.contacts) {
      c.marker.visible = !this.active && c.queue.length > 0;
      c.marker.rotation.y = t;
    }
    for (const m of this.markers) m.rotation.y = t;
    if (this.active) {
      this.active.update(dt);
      return;
    }
    const p = g.player.worldPos;
    for (const c of this.contacts) {
      if (!c.queue.length) continue;
      if (Math.hypot(p.x - c.pos.x, p.z - c.pos.z) < 2.2 && !g.player.dead) {
        if (g.police.wanted > 0) {
          if (this.promptShown < t) { g.hud.help('Lose your <b>wanted level</b> before starting a job.', 3); this.promptShown = t + 3; }
          continue;
        }
        if (this.promptShown < t) { g.hud.help(`Press <b>E</b> to talk to <b>${c.name}</b>.`, 2); this.promptShown = t + 2; }
        if (g.input.hit('KeyE')) this.start(c);
      }
    }
  }

  start(contact) {
    const id = contact.queue[0];
    const M = MISSIONS[id];
    this.active = new M(this.game, this, contact);
    this.game.hud.big(this.active.title, 'gold', contact.name, 3);
    this.game.audio.jingle(true);
  }

  pass(reward) {
    const g = this.game, c = this.active.contact;
    c.queue.shift();
    this.completed++;
    this.active.cleanup();
    this.active = null;
    this.clearMarkers();
    g.player.money += reward;
    g.hud.objective('');
    g.hud.setTimer('');
    g.hud.big('MISSION PASSED', 'gold', `+$${reward.toLocaleString()}`, 4);
    g.audio.jingle(true);
    g.audio.cash();
    if (this.contacts.every((k) => !k.queue.length)) {
      g.hud.later('allDone', 5, () => g.hud.big('PORT SOLANO IS YOURS', 'gold', 'All jobs complete — enjoy the city', 6));
    }
  }

  fail(reason) {
    if (!this.active) return;
    const g = this.game;
    this.active.cleanup();
    this.active = null;
    this.clearMarkers();
    g.hud.objective('');
    g.hud.setTimer('');
    g.hud.big('MISSION FAILED', 'red', reason, 4);
    g.audio.jingle(false);
  }

  onPedKilled(ped) { this.active?.onPedKilled?.(ped); }
}

// ---------------- Mission implementations ----------------
class Mission {
  constructor(game, mgr, contact) {
    this.game = game; this.mgr = mgr; this.contact = contact;
    this.target = null;
    this.time = 0;
    this.limit = 0;
  }
  blips() { return this.target ? [{ x: this.target.x, z: this.target.z, icon: '★', color: '#ffcf3d', edge: true }] : []; }
  say(html, dur = 6) { this.game.hud.missionText(html, dur); }
  objective(t) { this.game.hud.objective(t); }
  near(pt, r) { const p = this.game.player.worldPos; return Math.hypot(p.x - pt.x, p.z - pt.z) < r; }
  tickTimer(dt) {
    if (!this.limit) return false;
    this.limit -= dt;
    const s = Math.max(0, this.limit);
    this.game.hud.setTimer(`${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`);
    if (this.limit <= 0) { this.mgr.fail("Time's up"); return true; }
    return false;
  }
  cleanup() {}
}

class HotProperty extends Mission {
  constructor(g, m, c) {
    super(g, m, c);
    this.title = 'HOT PROPERTY';
    const sp = roadPoint(8, 1, 1, 30, 8.6);
    this.car = new Vehicle(g, 'race', sp.x, sp.z, sp.heading);
    this.car.persistent = true;
    g.vehicles.push(this.car);
    this.drop = { x: roadCoord(1) + RW + 10, z: roadCoord(9) - RW - 10 };
    this.target = { x: sp.x, z: sp.z };
    this.stage = 0;
    this.say('<span class="name">Dex:</span> A collector wants that <b>Fulmine R</b> parked uptown. Lift it and bring it to my lot — <b>without a scratch</b>.');
    this.objective('Steal the Fulmine R');
  }
  blips() { return [{ x: this.target.x, z: this.target.z, icon: this.stage === 0 ? '🚗' : '★', color: this.stage === 0 ? '#4fc3f7' : '#ffcf3d', edge: true }]; }
  update(dt) {
    const g = this.game;
    if (this.car.destroyed) return this.mgr.fail('The car was destroyed');
    if (this.stage === 0) {
      this.target = { x: this.car.pos.x, z: this.car.pos.z };
      if (g.player.vehicle === this.car) {
        this.stage = 1;
        this.target = this.drop;
        this.mgr.addMarker(this.drop.x, this.drop.z, 0xffcf3d, 4, 3);
        g.police.setWanted(2);
        this.say("<span class=\"name\">Dex:</span> The alarm tripped! Shake the cops or bring 'em — just get it to the lot.");
        this.objective('Deliver the car to Dex\'s lot');
      }
    } else if (this.stage === 1) {
      if (g.player.vehicle !== this.car) this.objective('Get back in the Fulmine R');
      else this.objective(`Deliver the car to Dex's lot (${Math.round(this.car.health / this.car.maxHealth * 100)}% condition)`);
      if (g.player.vehicle === this.car && this.near(this.drop, 5) && this.car.speed < 4) {
        if (g.police.wanted > 0) { this.objective('Lose the cops before parking!'); return; }
        g.player.exitVehicle(true);
        const bonus = Math.round(1500 * this.car.health / this.car.maxHealth);
        this.car.persistent = false;
        this.mgr.pass(2000 + bonus);
      }
    }
  }
  cleanup() { if (this.car) this.car.persistent = false; }
}

class Delivery extends Mission {
  constructor(g, m, c) {
    super(g, m, c);
    this.title = 'SPECIAL DELIVERY';
    this.pickup = sidewalk(7, 2, 2);
    this.dest = sidewalk(2, 8, 0);
    this.stage = 0;
    this.target = this.pickup;
    this.mgr.addMarker(this.pickup.x, this.pickup.z, 0x4fc3f7, 1.4, 2.4);
    this.say('<span class="name">Marisol:</span> A friend left a <b>package</b> in Mercado. Grab it and get it to Palmetto Heights. Clock\'s ticking, cariño.');
    this.objective('Collect the package');
    this.limit = 150;
  }
  update(dt) {
    if (this.tickTimer(dt)) return;
    if (this.stage === 0 && this.near(this.pickup, 2.5)) {
      this.stage = 1;
      this.mgr.clearMarkers();
      this.mgr.addMarker(this.dest.x, this.dest.z, 0xffcf3d, 1.6, 2.4);
      this.target = this.dest;
      this.game.audio.pickup();
      this.limit += 30;
      this.objective('Deliver the package');
      this.say('Package secured. <b>+30s</b>');
    } else if (this.stage === 1 && this.near(this.dest, 2.8)) {
      this.mgr.pass(1500 + Math.round(this.limit * 10));
    }
  }
}

class StreetRace extends Mission {
  constructor(g, m, c) {
    super(g, m, c);
    this.title = 'MIDNIGHT RUN';
    const pts = [[6, 6], [6, 3], [8, 3], [8, 8], [3, 8], [3, 5], [1, 5], [1, 1], [5, 1], [5, 4], [4, 4]];
    this.cps = pts.map(([i, j]) => ({ x: roadCoord(i), z: roadCoord(j) }));
    this.idx = 0;
    this.stage = 0;
    this.say('<span class="name">Dex:</span> Grab any ride and hit every <b>checkpoint</b>. Beat the clock and the pot is yours.');
    this.objective('Get in a vehicle');
  }
  blips() {
    if (this.stage === 0) return [];
    const out = [{ x: this.cps[this.idx].x, z: this.cps[this.idx].z, icon: `${this.idx + 1}`, color: '#ffcf3d', edge: true }];
    if (this.cps[this.idx + 1]) out.push({ x: this.cps[this.idx + 1].x, z: this.cps[this.idx + 1].z, dot: true, r: 4, color: '#ffe082' });
    return out;
  }
  showCp() {
    this.mgr.clearMarkers();
    const c = this.cps[this.idx];
    this.mgr.addMarker(c.x, c.z, 0xffcf3d, 6, 5);
    this.target = c;
  }
  update(dt) {
    const g = this.game;
    if (this.stage === 0) {
      if (g.player.vehicle) {
        this.stage = 1;
        this.limit = 135;
        this.showCp();
        this.objective(`Checkpoint 1 / ${this.cps.length}`);
        g.hud.big('GO!', 'gold', '', 1.5);
      }
      return;
    }
    if (this.tickTimer(dt)) return;
    if (!g.player.vehicle) this.objective('Get back in a vehicle!');
    if (g.player.vehicle && this.near(this.cps[this.idx], 7)) {
      this.idx++;
      g.audio.checkpoint();
      if (this.idx >= this.cps.length) return this.mgr.pass(2500 + Math.round(this.limit * 20));
      this.showCp();
      this.objective(`Checkpoint ${this.idx + 1} / ${this.cps.length}`);
    }
  }
}

class Cleanup extends Mission {
  constructor(g, m, c) {
    super(g, m, c);
    this.title = 'HARBOR CLEANUP';
    this.area = { x: roadCoord(2) + 32, z: roadCoord(0) + 40 };
    this.target = this.area;
    this.stage = 0;
    this.gang = [];
    if (!g.player.owned.has('smg')) g.player.giveWeapon('smg', 120);
    else g.player.giveWeapon('smg', 60);
    this.say('<span class="name">Marisol:</span> The Riptide Crew is moving product through Harbor Row. Take this <b>SMG</b> and send them a message.');
    this.objective('Go to Harbor Row');
  }
  blips() {
    if (this.stage === 0) return [{ x: this.area.x, z: this.area.z, icon: '☠', color: '#ff5252', edge: true }];
    return [];
  }
  update() {
    const g = this.game;
    if (this.stage === 0 && this.near(this.area, 70)) {
      this.stage = 1;
      this.target = null;
      const spots = [[-12, -8], [8, -12], [14, 6], [-6, 12], [0, 18], [20, -4]];
      for (const [dx, dz] of spots) {
        const p = new Ped(g, this.area.x + dx, this.area.z + dz, { role: 'gang' });
        p.persistent = true;
        g.peds.add(p);
        this.gang.push(p);
      }
      this.objective(`Take out the Riptide Crew (${this.gang.length} left)`);
    }
    if (this.stage === 1) {
      const left = this.gang.filter((p) => !p.dead).length;
      this.objective(`Take out the Riptide Crew (${left} left)`);
      if (left === 0) {
        this.stage = 2;
        if (g.police.wanted < 2) g.police.setWanted(2);
        this.say('Crew is down. Now <b>lose the cops</b>.');
      }
    }
    if (this.stage === 2) {
      this.objective('Lose the cops');
      if (g.police.wanted === 0) this.mgr.pass(4000);
    }
  }
  cleanup() { for (const p of this.gang) p.persistent = false; }
}

class Wreckage extends Mission {
  constructor(g, m, c) {
    super(g, m, c);
    this.title = 'DEMOLITION MAN';
    const spots = [roadPoint(7, 7, 0, 30, 8.6), roadPoint(2, 1, 1, 30, 8.6), roadPoint(9, 4, 1, 30, 8.6)];
    this.cars = spots.map((s) => {
      const v = new Vehicle(g, 'suv-luxury', s.x, s.z, s.heading);
      v.persistent = true;
      g.vehicles.push(v);
      return v;
    });
    if (!g.player.owned.has('rocket')) g.player.giveWeapon('rocket', 3);
    this.limit = 240;
    this.say('<span class="name">Vinnie:</span> Three Monarchs belong to a guy who owes me. I want them <b>scrap</b>. Here — a little <b>launcher</b> to help.');
    this.objective('Destroy the 3 marked cars');
  }
  blips() { return this.cars.filter((c) => !c.destroyed && c.health > 0).map((c) => ({ x: c.pos.x, z: c.pos.z, icon: '✖', color: '#ff5252', edge: true })); }
  update(dt) {
    if (this.tickTimer(dt)) return;
    const left = this.cars.filter((c) => !c.destroyed && c.health > 0).length;
    const next = this.cars.find((c) => !c.destroyed && c.health > 0);
    this.target = next ? { x: next.pos.x, z: next.pos.z } : null;
    this.objective(`Destroy the marked cars (${left} left)`);
    if (left === 0) this.mgr.pass(3000);
  }
  cleanup() { for (const c of this.cars) c.persistent = false; }
}

const MISSIONS = { hotProperty: HotProperty, delivery: Delivery, race: StreetRace, cleanup: Cleanup, wreckage: Wreckage };
void NB; void HALF;
