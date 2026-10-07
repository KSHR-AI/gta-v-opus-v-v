import * as THREE from 'three';
import { Vehicle } from './vehicle.js';
import { CIVILIAN_CARS } from './assets.js';
import { NB, RW, roadCoord, HALF, P } from './city.js';
import { Ped } from './peds.js';

const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const LANES = [1.9, 5.1];

export function lightState(game, axis) {
  const t = (game.time % 24 + 24) % 24;
  const local = axis === 0 ? t : (t + 12) % 24;
  if (local < 10) return 'green';
  if (local < 12) return 'yellow';
  return 'red';
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const nodePos = (i, j) => ({ x: roadCoord(i), z: roadCoord(j) });
const inGrid = (i, j) => i >= 0 && j >= 0 && i <= NB && j <= NB;

// Civilian traffic driver following lanes on the grid.
export class Driver {
  constructor(game, vehicle, i, j, dir, lane = Math.random() < 0.5 ? 0 : 1) {
    this.game = game;
    this.vehicle = vehicle;
    vehicle.driver = this;
    this.lane = lane;
    this.node = { i, j };
    this.dir = dir;
    this.waypoints = [];
    this.cruise = 11 + Math.random() * 4;
    this.panicTimer = 0;
    this.stuck = 0;
    this.reverseTimer = 0;
    this.hornTimer = 0;
    this.active = true;
    this.pushApproach();
  }

  get off() { return LANES[this.lane]; }

  // waypoint just before the node we're approaching
  pushApproach() {
    const n = nodePos(this.node.i, this.node.j);
    const d = this.dir;
    const rx = -DZ[d], rz = DX[d];
    this.waypoints.push({ x: n.x - DX[d] * (RW + 2) + rx * this.off, z: n.z - DZ[d] * (RW + 2) + rz * this.off, stop: { ...this.node, axis: d % 2 } });
  }

  planTurn() {
    const { i, j } = this.node, d = this.dir;
    const options = [];
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2) % 4) continue;
      if (!inGrid(i + DX[nd], j + DZ[nd])) continue;
      options.push(nd, ...(nd === d ? [nd, nd] : []));
    }
    if (!options.length) options.push((d + 2) % 4);
    const nd = options[Math.floor(Math.random() * options.length)];
    const n = nodePos(i, j);
    const r1x = -DZ[d], r1z = DX[d], r2x = -DZ[nd], r2z = DX[nd];
    const lane = nd === d ? this.lane : (((nd - d + 4) % 4 === 1) ? 1 : 0); // right turns use outer lane
    const o1 = this.off, o2 = LANES[lane];
    const p0 = { x: n.x - DX[d] * (RW + 2) + r1x * o1, z: n.z - DZ[d] * (RW + 2) + r1z * o1 };
    const p2 = { x: n.x + DX[nd] * (RW + 2) + r2x * o2, z: n.z + DZ[nd] * (RW + 2) + r2z * o2 };
    let c;
    if (nd === d) c = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
    else if (nd === (d + 2) % 4) c = { x: n.x, z: n.z };
    else c = { x: n.x + r1x * o1 + r2x * o2, z: n.z + r1z * o1 + r2z * o2 };
    const steps = nd === d ? 1 : 4;
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      this.waypoints.push({ x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t * t * p2.x, z: (1 - t) ** 2 * p0.z + 2 * (1 - t) * t * c.z + t * t * p2.z, turn: nd !== d });
    }
    this.waypoints.push({ x: p2.x, z: p2.z, turn: nd !== d });
    this.lane = lane;
    this.dir = nd;
    this.node = { i: i + DX[nd], j: j + DZ[nd] };
    this.pushApproach();
  }

  // Snap to the lane network from an arbitrary position (after chases etc.)
  relocate() {
    const v = this.vehicle;
    const h = v.heading;
    const fx = Math.sin(h), fz = Math.cos(h);
    this.dir = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 0 : 2) : (fz > 0 ? 1 : 3);
    let i = Math.round((v.pos.x + HALF) / P), j = Math.round((v.pos.z + HALF) / P);
    if (this.dir === 0) i = Math.floor((v.pos.x + HALF) / P) + 1;
    if (this.dir === 2) i = Math.ceil((v.pos.x + HALF) / P) - 1;
    if (this.dir === 1) j = Math.floor((v.pos.z + HALF) / P) + 1;
    if (this.dir === 3) j = Math.ceil((v.pos.z + HALF) / P) - 1;
    i = Math.max(0, Math.min(NB, i)); j = Math.max(0, Math.min(NB, j));
    this.node = { i, j };
    this.waypoints = [];
    this.pushApproach();
  }

  obstacleAhead(range) {
    const v = this.vehicle, g = this.game;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let best = Infinity;
    const check = (x, z, w) => {
      const dx = x - v.pos.x, dz = z - v.pos.z;
      const a = dx * fx + dz * fz;
      if (a <= 0 || a > range) return;
      const l = Math.abs(dx * -fz + dz * fx);
      if (l < w) best = Math.min(best, a);
    };
    for (const o of g.vehicles) if (o !== v) check(o.pos.x, o.pos.z, 2.6);
    for (const p of g.peds.all) if (!p.dead) check(p.pos.x, p.pos.z, 1.6);
    if (!g.player.vehicle && !g.player.dead) check(g.player.pos.x, g.player.pos.z, 1.8);
    return best;
  }

  panic() {
    this.panicTimer = 14;
    this.cruise = 20;
  }

  onVehicleAttacked() { this.panic(); }

  computeControls(dt) {
    const v = this.vehicle, g = this.game;
    if (this.waypoints.length < 4) this.planTurn();
    let wp = this.waypoints[0];
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    let dx = wp.x - v.pos.x, dz = wp.z - v.pos.z;
    let dist = Math.hypot(dx, dz);
    const passed = dx * fx + dz * fz < 0 && dist < 10;
    if (dist < 3.5 || passed) {
      this.waypoints.shift();
      wp = this.waypoints[0];
      dx = wp.x - v.pos.x; dz = wp.z - v.pos.z; dist = Math.hypot(dx, dz);
    }
    if (dist > 60) { this.relocate(); return { throttle: 0, steer: 0 }; }
    // aim at waypoint (with lookahead onto the next if close)
    let ax = wp.x, az = wp.z;
    if (dist < 6 && this.waypoints[1]) { ax = this.waypoints[1].x; az = this.waypoints[1].z; }
    const desired = Math.atan2(ax - v.pos.x, az - v.pos.z);
    const diff = wrap(desired - v.heading);
    let steer = Math.max(-1, Math.min(1, -diff * 2.2));

    let target = this.panicTimer > 0 ? 22 : this.cruise;
    if (wp.turn || this.waypoints[1]?.turn) target = Math.min(target, 7.5);
    if (Math.abs(diff) > 0.6) target = Math.min(target, 6);
    // traffic lights
    if (this.panicTimer <= 0) {
      for (let k = 0; k < Math.min(2, this.waypoints.length); k++) {
        const w = this.waypoints[k];
        if (!w.stop || w.stop.i <= 0 || w.stop.j <= 0 || w.stop.i >= NB || w.stop.j >= NB) continue;
        const d = Math.hypot(w.x - v.pos.x, w.z - v.pos.z);
        const st = lightState(g, w.stop.axis);
        if (st === 'red' || (st === 'yellow' && d > 10)) target = Math.min(target, Math.max(0, (d - 1.5) * 0.7));
        break;
      }
    }
    const vF = v.forwardSpeed;
    const obst = this.obstacleAhead(8 + Math.max(0, vF) * 1.4);
    if (obst < Infinity) target = Math.min(target, Math.max(0, (obst - 7) * 0.8));
    this.blocked = obst < 10;

    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      return { throttle: -1, steer: -steer, handbrake: false };
    }
    if (target > 3 && vF < 0.6) {
      this.stuck += dt;
      if (this.stuck > (this.blocked ? 7 : 2.5)) { this.reverseTimer = 1.4; this.stuck = 0; }
    } else this.stuck = Math.max(0, this.stuck - dt);

    let throttle = Math.max(-1, Math.min(1, (target - vF) * 0.35));
    if (target < 0.5 && vF < 0.5) throttle = 0;
    return { throttle, steer, handbrake: target < 0.5 && vF < 2 };
  }

  update(dt) {
    if (!this.active) return;
    const v = this.vehicle;
    if (v.destroyed) { this.bail(); return; }
    if (this.panicTimer > 0) { this.panicTimer -= dt; if (this.panicTimer <= 0) this.cruise = 11 + Math.random() * 4; }
    const c = this.computeControls(dt);
    // honk at the player when blocked
    if (this.blocked && this.stuck > 2) {
      this.hornTimer -= dt;
      if (this.hornTimer <= 0) { this.hornTimer = 3 + Math.random() * 4; this.game.audio.honk(v.pos); }
    }
    v.update(dt, c);
  }

  bail() {
    // driver gets out of a burning car and runs
    this.active = false;
    const v = this.vehicle;
    if (v.driver === this) v.driver = null;
    const door = v.doorPosition(new THREE.Vector3());
    this.game.peds.spawnEjected(door.x, door.z, v.pos);
  }

  ejectFromVehicle(by) {
    this.active = false;
    const v = this.vehicle;
    v.driver = null;
    const door = v.doorPosition(new THREE.Vector3());
    const ped = this.game.peds.spawnEjected(door.x, door.z, by.pos);
    ped.model.play('die', { once: true, fade: 0 });
  }

  onVehicleDestroyed() { this.active = false; }
}

// Police driver: patrols like traffic, pursues when the player is wanted.
export class CopDriver extends Driver {
  constructor(game, vehicle, i, j, dir) {
    super(game, vehicle, i, j, dir, 0);
    this.mode = 'patrol';
    this.route = [];
    this.routeTimer = 0;
    this.deployed = false;
    this.ramTimer = 0;
  }

  bfs(start, goal) {
    const key = (n) => n.i * 100 + n.j;
    const prev = new Map([[key(start), null]]);
    const q = [start];
    while (q.length) {
      const n = q.shift();
      if (n.i === goal.i && n.j === goal.j) break;
      for (let d = 0; d < 4; d++) {
        const m = { i: n.i + DX[d], j: n.j + DZ[d] };
        if (!inGrid(m.i, m.j) || prev.has(key(m))) continue;
        prev.set(key(m), n);
        q.push(m);
      }
    }
    const path = [];
    let n = goal;
    while (n && prev.has(key(n))) { path.unshift(n); n = prev.get(key(n)); }
    return path;
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game, v = this.vehicle;
    if (v.destroyed) { this.bail(); return; }
    const wanted = g.police.wanted;
    if (wanted > 0 && !g.player.dead) {
      this.mode = 'pursue';
      v.sirenOn = true;
      v.update(dt, this.pursue(dt));
      return;
    }
    if (this.mode === 'pursue') {
      this.mode = 'patrol';
      v.sirenOn = false;
      this.relocate();
    }
    super.update(dt);
  }

  pursue(dt) {
    const g = this.game, v = this.vehicle, player = g.player;
    const tp = player.worldPos;
    const dx = tp.x - v.pos.x, dz = tp.z - v.pos.z;
    const dist = Math.hypot(dx, dz);
    const vF = v.forwardSpeed;
    let ax, az, target;
    const los = dist < 70 && g.city.collision.lineOfSight(v.pos.x, v.pos.y + 1.2, v.pos.z, tp.x, tp.y + 1, tp.z);
    if (los && dist < 55) {
      const pv = player.vehicle ? player.vehicle.vel : { x: player.vel.x, y: player.vel.z };
      const lead = Math.min(1.2, dist / 30);
      ax = tp.x + pv.x * lead; az = tp.z + pv.y * lead;
      if (player.vehicle) target = 38;
      else {
        target = Math.max(0, (dist - 9) * 1.2);
        if (dist < 16 && Math.abs(vF) < 2 && !this.deployed) this.deploy();
      }
    } else {
      this.routeTimer -= dt;
      if (this.routeTimer <= 0 || !this.route.length) {
        this.routeTimer = 1.5;
        const start = g.city.nearestNode(v.pos.x, v.pos.z);
        const goal = g.city.nearestNode(tp.x, tp.z);
        this.route = this.bfs(start, goal).map((n) => nodePos(n.i, n.j));
        this.route.push({ x: tp.x, z: tp.z });
      }
      while (this.route.length > 1 && Math.hypot(this.route[0].x - v.pos.x, this.route[0].z - v.pos.z) < 9) this.route.shift();
      ax = this.route[0].x; az = this.route[0].z;
      target = 30;
    }
    const desired = Math.atan2(ax - v.pos.x, az - v.pos.z);
    const diff = wrap(desired - v.heading);
    let steer = Math.max(-1, Math.min(1, -diff * 2.5));
    if (Math.abs(diff) > 1.2 && vF > 12) target = Math.min(target, 12);

    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      return { throttle: -1, steer: -steer };
    }
    if (target > 3 && Math.abs(vF) < 1.0) {
      this.stuck += dt;
      if (this.stuck > 1.5) { this.reverseTimer = 1.2; this.stuck = 0; }
    } else this.stuck = Math.max(0, this.stuck - dt);
    if (Math.abs(diff) > 2.2 && dist > 12) {
      // target behind: reverse-turn
      return { throttle: vF > 3 ? -1 : 0.6, steer: -Math.sign(diff), handbrake: vF > 8 };
    }
    return { throttle: Math.max(-1, Math.min(1, (target - vF) * 0.3)), steer, handbrake: Math.abs(diff) > 1.0 && vF > 14 };
  }

  deploy() {
    this.deployed = true;
    this.active = false;
    const g = this.game, v = this.vehicle;
    v.driver = null;
    const door = v.doorPosition(new THREE.Vector3());
    const c1 = g.peds.add(new Ped(g, door.x, door.z, { role: 'cop' }));
    c1.persistent = false;
    const rx = -Math.cos(v.heading), rz = Math.sin(v.heading);
    const c2 = g.peds.add(new Ped(g, v.pos.x + rx * (v.halfW + 0.9), v.pos.z + rz * (v.halfW + 0.9), { role: 'cop' }));
    c2.persistent = false;
    g.audio.door(v.pos);
  }

  ejectFromVehicle(by) {
    this.active = false;
    const g = this.game, v = this.vehicle;
    v.driver = null;
    v.sirenOn = false;
    const door = v.doorPosition(new THREE.Vector3());
    g.peds.add(new Ped(g, door.x, door.z, { role: 'cop' }));
    void by;
  }
}

export class TrafficManager {
  constructor(game) {
    this.game = game;
    this.drivers = [];
    this.spawnTimer = 0;
  }

  get target() { return this.game.sky.night > 0.6 ? 18 : 26; }

  randomSegmentSpawn(minD, maxD) {
    const g = this.game, pp = g.player.worldPos;
    for (let tries = 0; tries < 12; tries++) {
      const i = Math.floor(Math.random() * (NB + 1)), j = Math.floor(Math.random() * (NB + 1));
      const dir = Math.floor(Math.random() * 4);
      const pi = i - DX[dir], pj = j - DZ[dir];
      if (!inGrid(pi, pj)) continue;
      const n = nodePos(i, j);
      const along = RW + 6 + Math.random() * (P - 2 * RW - 14);
      const lane = Math.random() < 0.5 ? 0 : 1;
      const rx = -DZ[dir], rz = DX[dir];
      const x = n.x - DX[dir] * along + rx * LANES[lane];
      const z = n.z - DZ[dir] * along + rz * LANES[lane];
      const d = Math.hypot(x - pp.x, z - pp.z);
      if (d < minD || d > maxD) continue;
      if (g.vehicles.some((v) => Math.hypot(v.pos.x - x, v.pos.z - z) < 10)) continue;
      const heading = Math.atan2(DX[dir], DZ[dir]);
      return { x, z, i, j, dir, lane, heading };
    }
    return null;
  }

  spawnCivilian(minD, maxD, police = false) {
    const g = this.game;
    const s = this.randomSegmentSpawn(minD, maxD);
    if (!s) return null;
    const type = police ? 'police' : CIVILIAN_CARS[Math.floor(Math.random() * CIVILIAN_CARS.length)];
    const v = new Vehicle(g, type, s.x, s.z, s.heading);
    v.vel.set(Math.sin(s.heading) * 9, Math.cos(s.heading) * 9);
    g.vehicles.push(v);
    const d = police ? new CopDriver(g, v, s.i, s.j, s.dir) : new Driver(g, v, s.i, s.j, s.dir, s.lane);
    this.drivers.push(d);
    return d;
  }

  update(dt) {
    const g = this.game, pp = g.player.worldPos;
    this.spawnTimer -= dt;
    const civ = this.drivers.filter((d) => d.active && !(d instanceof CopDriver)).length;
    if (this.spawnTimer <= 0 && civ < this.target) {
      this.spawnTimer = 0.2;
      this.spawnCivilian(g.started ? 90 : 20, 190, Math.random() < 0.05);
    }
    for (const d of this.drivers) d.update(dt);
    this.drivers = this.drivers.filter((d) => d.active || (d.vehicle.driver === d));
    // despawn distant vehicles
    for (let k = g.vehicles.length - 1; k >= 0; k--) {
      const v = g.vehicles[k];
      if (v.driver === g.player) continue;
      const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
      const limit = v.persistent ? 450 : v.driver ? 240 : 200;
      const burnt = v.destroyed && v.burnTimer !== undefined && (v.burnTimer -= dt) < -60 && d > 60;
      if (d > limit || burnt || (v.sinking > 6 && d > 30)) {
        if (v.driver && v.driver.active !== undefined) v.driver.active = false;
        v.dispose();
        g.vehicles.splice(k, 1);
      } else if (!v.driver || !v.driver.active) {
        if (v.driver === null || (v.driver && !v.driver.active && v.driver !== g.player)) {
          v.update(dt, null);
        }
      }
    }
    this.drivers = this.drivers.filter((d) => g.vehicles.includes(d.vehicle) && d.active);
  }
}
