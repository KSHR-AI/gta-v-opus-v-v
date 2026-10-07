import * as THREE from 'three';
import { CharacterModel } from './character.js';
import { traceShot, applyHit } from './weapons.js';
import { WATER_Y } from './city.js';

const CIV_MODELS = 'abcefikmnp'.split('').map((c) => `characters/character-${c}`);
export const COP_MODEL = 'characters/character-j';
const GANG_MODELS = ['characters/character-r', 'characters/character-l'];
const tmpRes = { hit: false, nx: 0, nz: 0, depth: 0, obj: null };

export class Ped {
  constructor(game, x, z, { role = 'civilian', model, block = null, t = 0 } = {}) {
    this.game = game;
    this.role = role;
    const name = model || (role === 'cop' ? COP_MODEL : role === 'gang' ? GANG_MODELS[Math.floor(Math.random() * GANG_MODELS.length)] : CIV_MODELS[Math.floor(Math.random() * CIV_MODELS.length)]);
    this.model = new CharacterModel(game.scene, name);
    this.pos = new THREE.Vector3(x, game.city.groundHeight(x, z), z);
    this.vel = new THREE.Vector3();
    this.heading = Math.random() * Math.PI * 2;
    this.health = role === 'cop' ? 110 : role === 'gang' ? 90 : 60;
    this.dead = false;
    this.deadTime = 0;
    this.state = role === 'civilian' ? 'walk' : 'attack';
    this.block = block;
    this.t = t;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.walkSpeed = 1.2 + Math.random() * 0.6;
    this.timer = 0;
    this.threat = new THREE.Vector3();
    this.cooldown = 1 + Math.random();
    this.persistent = false;
    this.airborne = false;
    this.radius = 0.35;
    this.weapon = role === 'cop' ? 'pistol' : role === 'gang' ? 'smg' : null;
    this.model.setWeapon(this.weapon);
    this.stuckTimer = 0;
    this.sync();
  }

  update(dt) {
    const g = this.game;
    this.model.update(dt);
    if (this.dead) {
      this.deadTime += dt;
      if (this.airborne) this.physics(dt);
      this.sync();
      return;
    }
    this.cooldown -= dt;
    this.timer -= dt;

    let desiredX = 0, desiredZ = 0, speed = 0;
    const player = g.player;
    const pp = player.worldPos;

    if (this.airborne) {
      this.physics(dt);
      this.sync();
      return;
    }

    if (this.state === 'walk' && this.block) {
      this.t += (this.dir * this.walkSpeed * dt) / this.blockPerimeter();
      const target = g.city.sidewalkLoopPoint(this.block, this.t + this.dir * 0.01);
      desiredX = target.x - this.pos.x; desiredZ = target.z - this.pos.z;
      speed = this.walkSpeed;
      if (Math.random() < dt * 0.01) this.dir *= -1;
      if (Math.hypot(desiredX, desiredZ) > 6) speed = 3;
      this.dodgeCars();
    } else if (this.state === 'flee') {
      desiredX = this.pos.x - this.threat.x; desiredZ = this.pos.z - this.threat.z;
      speed = 6.5;
      if (this.timer <= 0) this.resumeWalking();
    } else if (this.state === 'idle') {
      speed = 0;
    } else if (this.state === 'attack') {
      const res = this.combat(dt, pp);
      desiredX = res.x; desiredZ = res.z; speed = res.speed;
    }

    const len = Math.hypot(desiredX, desiredZ);
    if (len > 0.01 && speed > 0) {
      desiredX /= len; desiredZ /= len;
      const th = Math.atan2(desiredX, desiredZ);
      let dh = Math.atan2(Math.sin(th - this.heading), Math.cos(th - this.heading));
      this.heading += dh * Math.min(1, dt * 8);
      if (!this.facingLock) {
        this.vel.x = desiredX * speed; this.vel.z = desiredZ * speed;
      }
    } else {
      this.vel.x *= 0.8; this.vel.z *= 0.8;
    }
    if (this.facingLock) {
      const th = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
      this.heading += Math.atan2(Math.sin(th - this.heading), Math.cos(th - this.heading)) * Math.min(1, dt * 10);
    }
    this.physics(dt);
    this.animate();
    this.sync();
  }

  blockPerimeter() {
    const b = this.block;
    return 2 * ((b.x1 - b.x0 - 4) + (b.z1 - b.z0 - 4));
  }

  physics(dt) {
    const g = this.game;
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const ground = g.city.groundHeight(this.pos.x, this.pos.z);
    if (this.airborne) {
      this.vel.y -= 20 * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        this.vel.set(this.vel.x * 0.3, 0, this.vel.z * 0.3);
        this.airborne = false;
        if (!this.dead) { this.state = this.role === 'civilian' ? 'flee' : 'attack'; this.timer = 6; }
      }
    } else {
      if (ground - this.pos.y > 0.9) { this.pos.x = ox; this.pos.z = oz; }
      else this.pos.y = ground;
    }
    if (g.city.isWater(this.pos.x, this.pos.z) && this.pos.y < WATER_Y) { this.pos.y = WATER_Y - 0.9; if (!this.dead) this.die(null); }
    g.city.collision.resolveCircle(this.pos, this.radius, this.pos.y + 0.4, tmpRes);
    if (tmpRes.hit && this.state === 'walk') { this.stuckTimer += dt; if (this.stuckTimer > 2) { this.dir *= -1; this.stuckTimer = 0; } }
    if (!this.dead) this.vehicleContacts();
  }

  vehicleContacts() {
    const g = this.game;
    for (const v of g.vehicles) {
      const dx0 = this.pos.x - v.pos.x, dz0 = this.pos.z - v.pos.z;
      if (dx0 * dx0 + dz0 * dz0 > 40) continue;
      if (this.pos.y > v.pos.y + v.height) continue;
      for (const c of v.circles()) {
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz), min = this.radius + v.radius;
        if (d >= min || d < 1e-4) continue;
        const sp = v.speed;
        if (sp > 5) {
          // knocked down
          const dmg = sp * 6;
          this.vel.set(v.vel.x * 0.9 + (dx / d) * 3, 3 + sp * 0.25, v.vel.y * 0.9 + (dz / d) * 3);
          this.airborne = true;
          g.audio.thud(this.pos, Math.min(1, sp / 20));
          g.effects.blood(this.pos.clone().setY(this.pos.y + 1));
          const src = v.driver;
          if (src === g.player) g.police.crime('hitPed', this.pos);
          this.takeDamage(dmg, src, null, false, true);
          v.vel.multiplyScalar(0.92);
          return;
        }
        this.pos.x += (dx / d) * (min - d);
        this.pos.z += (dz / d) * (min - d);
      }
    }
  }

  dodgeCars() {
    const g = this.game;
    for (const v of g.vehicles) {
      const sp = v.speed;
      if (sp < 8) continue;
      const dx = this.pos.x - v.pos.x, dz = this.pos.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 14) continue;
      const vx = v.vel.x / sp, vz = v.vel.y / sp;
      const along = dx * vx + dz * vz;
      const lateral = Math.abs(dx * -vz + dz * vx);
      if (along > 0 && lateral < 3) {
        this.flee(v.pos, 2.5);
        g.audio.scream?.(this.pos);
        return;
      }
    }
  }

  combat(dt, pp) {
    const g = this.game;
    const player = g.player;
    const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    this.facingLock = false;
    if (player.dead) return { x: 0, z: 0, speed: 0 };
    if (this.role === 'cop' && g.police.wanted === 0) {
      this.state = 'walk';
      this.block = null;
      this.state = 'idle';
      return { x: 0, z: 0, speed: 0 };
    }
    const los = dist < 60 && g.city.collision.lineOfSight(this.pos.x, this.pos.y + 1.5, this.pos.z, pp.x, pp.y + 1.2, pp.z);
    const shouldShoot = this.role === 'gang' || g.police.wanted >= 2 || (player.weapon !== 'fists' && player.aiming);
    if (this.role === 'cop' && !shouldShoot) {
      // try to arrest: run straight at the player
      this.model.setWeapon(null);
      if (dist > 1.4) return { x: dx, z: dz, speed: player.vehicle ? 6 : 6.8 };
      this.facingLock = true;
      return { x: 0, z: 0, speed: 0 };
    }
    this.model.setWeapon(this.weapon);
    if (!los || dist > (this.role === 'gang' ? 35 : 28)) return { x: dx, z: dz, speed: 6.2 };
    this.facingLock = true;
    if (dist < 4) return { x: -dx, z: -dz, speed: 2 };
    if (this.cooldown <= 0) this.shootAt(pp, dist);
    // strafe a little
    const s = Math.sin(g.time * 0.8 + this.pos.x) > 0 ? 1 : -1;
    return { x: -dz * s, z: dx * s, speed: 1.2 };
  }

  shootAt(pp, dist) {
    const g = this.game;
    const gang = this.role === 'gang';
    this.cooldown = gang ? 0.18 + Math.random() * 0.25 : 0.7 + Math.random() * 0.6;
    if (gang && Math.random() < 0.15) this.cooldown = 1.5;
    this.model.play(gang ? 'holding-both-shoot' : 'holding-right-shoot', { force: true, fade: 0.05 });
    this.shotAnim = 0.3;
    this.model.root.updateMatrixWorld(true);
    const muzzle = this.model.muzzleWorld(new THREE.Vector3());
    const chest = new THREE.Vector3(this.pos.x, this.pos.y + 1.35, this.pos.z);
    const target = new THREE.Vector3(pp.x, pp.y + 1.0, pp.z);
    const accuracy = Math.max(0.12, 0.6 - dist * 0.012 - g.player.speed * 0.025);
    const miss = Math.random() > accuracy;
    if (miss) target.add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3));
    const dir = target.sub(chest).normalize();
    const hit = traceShot(g, chest, dir, 80, this);
    applyHit(g, hit, gang ? 5 : 8, this, dir);
    g.effects.muzzle(muzzle);
    g.effects.tracer(muzzle, hit.point);
    g.audio.shot(gang ? 'smg' : 'pistol', this.pos);
    g.peds.panic(this.pos, 30);
  }

  animate() {
    const m = this.model;
    if (this.shotAnim > 0) { this.shotAnim -= 1 / 60; return; }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.facingLock && this.weapon && (this.role === 'gang' || this.game.police.wanted >= 2 || this.role !== 'cop')) {
      m.play(this.role === 'gang' ? 'holding-both' : 'holding-right');
      return;
    }
    if (this.facingLock) { m.play('interact-right'); return; }
    if (sp > 4.5) m.play('sprint');
    else if (sp > 0.3) m.play('walk', { timeScale: sp / 1.6 });
    else m.play('idle');
  }

  sync() {
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.heading;
  }

  flee(from, time = 6) {
    if (this.dead || this.role !== 'civilian') return;
    this.state = 'flee';
    this.threat.copy(from);
    this.timer = time + Math.random() * 3;
  }

  resumeWalking() {
    const city = this.game.city;
    let best = null, bestD = Infinity, bestT = 0;
    for (const b of city.blocks) {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      if (Math.abs(cx - this.pos.x) > 80 || Math.abs(cz - this.pos.z) > 80) continue;
      for (let i = 0; i < 24; i++) {
        const t = i / 24;
        const p = city.sidewalkLoopPoint(b, t);
        const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
        if (d < bestD) { bestD = d; best = b; bestT = t; }
      }
    }
    if (best) { this.block = best; this.t = bestT; this.state = 'walk'; }
    else this.state = 'idle';
  }

  takeDamage(amount, source, dir, melee = false, vehicleHit = false) {
    if (this.dead) return;
    const g = this.game;
    this.health -= amount;
    if (dir && !vehicleHit) {
      this.vel.x += dir.x * (melee ? 4 : 1.5);
      this.vel.z += dir.z * (melee ? 4 : 1.5);
    }
    if (source === g.player) {
      if (this.role === 'cop') g.police.crime('attackCop', this.pos);
      if (this.role === 'civilian') g.police.crime('assault', this.pos);
    }
    if (this.health <= 0) { this.die(source); return; }
    if (this.role === 'civilian') {
      this.flee(source ? (source.worldPos || source.pos) : this.pos, 8);
      g.audio.scream?.(this.pos);
    } else {
      this.state = 'attack';
    }
  }

  die(source) {
    const g = this.game;
    this.dead = true;
    this.health = 0;
    this.model.setWeapon(null);
    this.model.play('die', { once: true, fade: 0.1 });
    this.vel.x *= 0.3; this.vel.z *= 0.3;
    if (source === g.player) {
      g.police.crime(this.role === 'cop' ? 'killCop' : 'killPed', this.pos);
      g.missions.onPedKilled(this);
      g.stats.kills++;
    }
    g.peds.panic(this.pos, 35);
    // drops
    if (this.role === 'cop' && Math.random() < 0.7) g.pickups.spawnDrop('pistol', this.pos);
    else if (this.role === 'gang') g.pickups.spawnDrop('smg', this.pos);
    else if (Math.random() < 0.5) g.pickups.spawnDrop('cash', this.pos, 10 + Math.floor(Math.random() * 60));
  }

  // When a ped is used as an ejected driver
  ejectFromVehicle() {}

  dispose() { this.model.dispose(); }
}

export class PedManager {
  constructor(game) {
    this.game = game;
    this.all = [];
    this.spawnTimer = 0;
  }

  get target() { return this.game.sky.night > 0.6 ? 26 : 40; }

  add(ped) { this.all.push(ped); return ped; }

  spawnCivilian(minD = 45, maxD = 140) {
    const g = this.game, pp = g.player.worldPos;
    for (let tries = 0; tries < 10; tries++) {
      const p = g.city.randomSidewalkPoint();
      const d = Math.hypot(p.x - pp.x, p.z - pp.z);
      if (d < minD || d > maxD) continue;
      const ped = new Ped(g, p.x, p.z, { block: p.block, t: Math.random() });
      ped.t = this.projectT(p.block, p.x, p.z);
      return this.add(ped);
    }
    return null;
  }

  projectT(b, x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < 40; i++) {
      const p = this.game.city.sidewalkLoopPoint(b, i / 40);
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = i / 40; }
    }
    return best;
  }

  // Civilian dragged out of a car by the player.
  spawnEjected(x, z, threat) {
    const ped = this.add(new Ped(this.game, x, z));
    ped.resumeWalking();
    ped.flee(threat, 8);
    return ped;
  }

  panic(pos, radius) {
    for (const p of this.all) {
      if (p.role !== 'civilian' || p.dead || p.state === 'flee') continue;
      if (Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < radius) p.flee(pos, 6);
    }
  }

  witnesses(pos, radius) {
    let n = 0;
    for (const p of this.all) if (!p.dead && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < radius) n++;
    return n;
  }

  update(dt) {
    const g = this.game, pp = g.player.worldPos;
    this.spawnTimer -= dt;
    const civs = this.all.filter((p) => p.role === 'civilian' && !p.dead).length;
    if (this.spawnTimer <= 0 && civs < this.target) {
      this.spawnTimer = 0.15;
      this.spawnCivilian(g.started ? 60 : 8, 140);
    }
    for (let i = this.all.length - 1; i >= 0; i--) {
      const p = this.all[i];
      const d = Math.hypot(p.pos.x - pp.x, p.pos.z - pp.z);
      const far = d > 170 && !p.persistent;
      const oldBody = p.dead && (p.deadTime > 30 || (p.deadTime > 8 && d > 60));
      const idleCop = p.role === 'cop' && g.police.wanted === 0 && d > 90;
      if (far || oldBody || idleCop) {
        p.dispose();
        this.all.splice(i, 1);
        continue;
      }
      // LOD: skip animation for far peds every other frame
      if (d > 90 && (g.frame + i) % 2) continue;
      p.update(d > 90 ? dt * 2 : dt);
    }
  }

  clearHostiles() {
    for (let i = this.all.length - 1; i >= 0; i--) {
      const p = this.all[i];
      if (p.role === 'cop') { p.dispose(); this.all.splice(i, 1); }
    }
  }
}
