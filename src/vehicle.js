import * as THREE from 'three';
import { assets, CAR_TYPES } from './assets.js';
import { WATER_Y } from './city.js';

const SCALE = 1.75;
const tmpRes = { hit: false, nx: 0, nz: 0, depth: 0, obj: null };
const burntCache = new Map();

export class Vehicle {
  constructor(game, type, x, z, heading = 0) {
    this.game = game;
    this.type = type;
    this.spec = CAR_TYPES[type];
    this.object = new THREE.Group();
    const model = assets.clone(this.spec.file);
    model.scale.setScalar(SCALE);
    this.model = model;
    this.object.add(model);
    this.wheels = [];
    model.traverse((o) => {
      if (o.name.startsWith('wheel')) this.wheels.push({ node: o, front: o.name.includes('front'), baseRot: o.rotation.clone() });
    });
    const box = assets.box(this.spec.file);
    this.halfW = ((box.max.x - box.min.x) / 2) * SCALE * 0.92;
    this.halfL = ((box.max.z - box.min.z) / 2) * SCALE * 0.95;
    this.height = (box.max.y - box.min.y) * SCALE;
    this.radius = this.halfW;
    this.circleOffset = this.halfL - this.halfW;

    this.pos = new THREE.Vector3(x, game.city.groundHeight(x, z), z);
    this.heading = heading;
    this.vel = new THREE.Vector2();
    this.vy = 0;
    this.steer = 0;
    this.yawRate = 0;
    this.grounded = true;
    this.health = 1000 * this.spec.mass;
    this.maxHealth = this.health;
    this.destroyed = false;
    this.fireTimer = -1;
    this.sinking = 0;
    this.driver = null;
    this.braking = false;
    this.horn = false;
    this.sirenOn = false;
    this.wheelSpin = 0;
    this.pitch = 0;
    this.roll = 0;
    this.lastCrash = 0;
    this.persistent = false;
    this.addLights();
    this.syncObject();
    game.scene.add(this.object);
  }

  get speed() { return this.vel.length(); }
  get forwardSpeed() { return this.vel.x * Math.sin(this.heading) + this.vel.y * Math.cos(this.heading); }
  get isPolice() { return !!this.spec.police; }
  get name() { return this.spec.name; }

  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  addLights() {
    const box = assets.box(this.spec.file);
    const front = box.max.z * SCALE + 0.02, back = box.min.z * SCALE - 0.02;
    const hw = this.halfW * 0.7;
    const y = 0.55 * SCALE * 0.75 + 0.2;
    this.headMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
    const hg = new THREE.PlaneGeometry(0.45, 0.22);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(hg, this.headMat);
      h.position.set(s * hw, y, front);
      const t = new THREE.Mesh(hg, this.tailMat);
      t.position.set(s * hw, y, back);
      t.rotation.y = Math.PI;
      this.object.add(h, t);
    }
    if (this.isPolice) {
      this.sirenMats = [new THREE.MeshBasicMaterial({ color: 0x330000 }), new THREE.MeshBasicMaterial({ color: 0x000033 })];
      const g = new THREE.BoxGeometry(0.5, 0.18, 0.3);
      const top = box.max.y * SCALE + 0.05;
      const r = new THREE.Mesh(g, this.sirenMats[0]); r.position.set(-0.35, top, -0.2);
      const b = new THREE.Mesh(g, this.sirenMats[1]); b.position.set(0.35, top, -0.2);
      this.object.add(r, b);
    }
  }

  // Attach a real spotlight while the player drives at night.
  setHeadlightSpot(on) {
    if (on && !this.spot) {
      this.spot = new THREE.SpotLight(0xfff1d0, 60, 60, 0.55, 0.5, 1.2);
      this.spot.position.set(0, 1.0, this.halfL);
      this.spot.target.position.set(0, -1.5, this.halfL + 18);
      this.object.add(this.spot, this.spot.target);
    } else if (!on && this.spot) {
      this.object.remove(this.spot, this.spot.target);
      this.spot.dispose();
      this.spot = null;
    }
  }

  circles() {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    return [
      { x: this.pos.x + fx * this.circleOffset, z: this.pos.z + fz * this.circleOffset },
      { x: this.pos.x - fx * this.circleOffset, z: this.pos.z - fz * this.circleOffset },
      { x: this.pos.x, z: this.pos.z },
    ];
  }

  // controls: {throttle -1..1, steer -1..1 (positive = right), handbrake bool}
  update(dt, controls) {
    const city = this.game.city;
    if (this.destroyed) controls = null;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx; // right vector
    let vF = this.vel.x * fx + this.vel.y * fz;
    let vS = this.vel.x * rx + this.vel.y * rz;
    const spec = this.spec;
    const throttle = controls?.throttle ?? 0;
    const handbrake = controls?.handbrake ?? false;
    const steerIn = controls?.steer ?? 0;
    this.braking = false;

    if (this.grounded && !this.sinking) {
      const top = spec.speed * (this.health < this.maxHealth * 0.25 ? 0.6 : 1);
      if (throttle > 0) {
        if (vF < -0.5) { vF += 30 * throttle * dt; this.braking = true; }
        else vF += spec.accel * throttle * Math.max(0.1, 1 - (vF / top) ** 2) * dt;
      } else if (throttle < 0) {
        if (vF > 0.5) { vF -= 32 * -throttle * dt; this.braking = true; }
        else vF -= spec.accel * 0.6 * -throttle * Math.max(0, 1 + vF / (top * 0.35)) * dt;
      } else {
        vF -= Math.sign(vF) * Math.min(Math.abs(vF), (2.5 + Math.abs(vF) * 0.05) * dt);
      }
      if (handbrake) { vF -= Math.sign(vF) * Math.min(Math.abs(vF), 14 * dt); this.braking = true; }
      vF -= vF * 0.02 * dt;
      const grip = handbrake ? 1.4 : 7.5 * spec.handling;
      vS *= Math.exp(-grip * dt);

      const speedFactor = 1 / (1 + Math.abs(vF) * 0.045);
      const maxSteer = 0.62 * speedFactor * spec.handling;
      this.steer += (steerIn * maxSteer - this.steer) * Math.min(1, dt * 8);
      const wheelbase = this.halfL * 1.3;
      let yaw = (vF * Math.tan(this.steer)) / wheelbase;
      if (handbrake) yaw *= 1.45;
      this.yawRate = -yaw; // positive steer (right) turns clockwise seen from above => heading decreases
      this.heading += this.yawRate * dt;
    } else {
      this.yawRate *= 0.99;
      this.heading += this.yawRate * dt * 0.5;
    }

    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    const nrx = -nfz, nrz = nfx;
    this.vel.set(nfx * vF + nrx * vS, nfz * vF + nrz * vS);

    // Integrate
    const px = this.pos.x, pz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;

    // Vertical
    const g = city.groundHeight(this.pos.x, this.pos.z);
    const prevG = city.groundHeight(px, pz);
    if (this.grounded) {
      if (g >= this.pos.y - 0.6 || this.pos.y - g < 0.25) {
        const rise = g - this.pos.y;
        this.vy = rise > 0 ? Math.min(rise / dt, 20) : (g - prevG) / dt;
        if (rise < -0.25) { this.grounded = false; }
        else this.pos.y = g;
      } else {
        this.grounded = false;
      }
    }
    if (!this.grounded) {
      this.vy -= 22 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= g) {
        if (this.vy < -14) this.damage(-this.vy * 6, null, 'land');
        if (this.vy < -6) this.game.audio?.thud(this.pos, Math.min(1, -this.vy / 20));
        this.pos.y = g;
        this.vy = 0;
        this.grounded = true;
      }
    }

    // Water
    if (city.isWater(this.pos.x, this.pos.z) && this.pos.y < WATER_Y + 0.3) {
      if (!this.sinking) { this.sinking = 0.01; this.game.effects?.splash(this.pos); }
    }
    if (this.sinking) {
      this.sinking += dt;
      this.vel.multiplyScalar(Math.exp(-2 * dt));
      this.vy = -0.8;
      this.grounded = false;
      this.pos.y = Math.max(-4.2, this.pos.y);
      if (this.sinking > 4 && !this.destroyed) { this.destroyed = true; this.health = 0; }
    }

    // Static collisions
    if (!this.sinking) this.collideStatic(dt);

    // Visual
    this.wheelSpin += vF * dt / 0.5;
    for (const w of this.wheels) {
      w.node.rotation.x = w.baseRot.x + this.wheelSpin;
      if (w.front) w.node.rotation.y = w.baseRot.y - this.steer;
    }
    const targetRoll = this.grounded ? Math.max(-0.08, Math.min(0.08, -this.yawRate * vF * 0.004)) : this.roll;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 6);
    let targetPitch = 0;
    if (this.grounded) {
      const gf = city.groundHeight(this.pos.x + nfx * this.halfL, this.pos.z + nfz * this.halfL);
      const gb = city.groundHeight(this.pos.x - nfx * this.halfL, this.pos.z - nfz * this.halfL);
      targetPitch = -Math.atan2(gf - gb, this.halfL * 2);
      if (this.braking) targetPitch += 0.025;
    } else {
      targetPitch = Math.max(-0.4, Math.min(0.4, -this.vy * 0.02));
    }
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 8);

    this.tailMat.color.setHex(this.braking ? 0xff2020 : this.game.sky.night > 0.3 ? 0xaa1010 : 0x550000);
    this.headMat.color.setHex(this.game.sky.night > 0.3 && this.driver ? 0xffffff : 0xb8b4a8);
    if (this.sirenMats) {
      const on = this.sirenOn && !this.destroyed;
      const ph = Math.floor(this.game.time * 6) % 2;
      this.sirenMats[0].color.setHex(on && ph ? 0xff2020 : 0x330000);
      this.sirenMats[1].color.setHex(on && !ph ? 0x2040ff : 0x000033);
    }

    // Damage states
    if (!this.destroyed && this.health < this.maxHealth * 0.3 && Math.random() < dt * 8) {
      this.game.effects?.smoke(this.engineFront(), this.health <= 0 ? 0x222222 : 0x777777);
    }
    if (this.health <= 0 && !this.destroyed && !this.sinking) {
      if (this.fireTimer < 0) this.fireTimer = 4;
      this.fireTimer -= dt;
      if (Math.random() < dt * 30) this.game.effects?.fire(this.engineFront());
      if (this.fireTimer <= 0) this.explode();
    }
    this.syncObject();
  }

  engineFront() {
    return new THREE.Vector3(this.pos.x + Math.sin(this.heading) * this.halfL * 0.6, this.pos.y + this.height * 0.7, this.pos.z + Math.cos(this.heading) * this.halfL * 0.6);
  }

  collideStatic() {
    const cw = this.game.city.collision;
    const circles = this.circles();
    for (const c of circles) {
      const p = { x: c.x, z: c.z };
      cw.resolveCircle(p, this.radius, this.pos.y + 0.3, tmpRes);
      if (!tmpRes.hit) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      this.pos.x += dx; this.pos.z += dz;
      const nx = tmpRes.nx, nz = tmpRes.nz;
      const vn = this.vel.x * nx + this.vel.y * nz;
      if (vn < 0) {
        const impact = -vn;
        this.vel.x -= nx * vn * 1.3;
        this.vel.y -= nz * vn * 1.3;
        this.vel.multiplyScalar(0.85);
        if (impact > 4) this.crash(impact, c);
      }
      // keep other circles consistent
      for (const o of circles) { o.x += dx; o.z += dz; }
    }
  }

  crash(impact, at) {
    const now = this.game.time;
    if (now - this.lastCrash < 0.15) return;
    this.lastCrash = now;
    this.damage(impact * impact * 0.9, null, 'crash');
    this.game.audio?.crash(this.pos, Math.min(1, impact / 25));
    if (impact > 8) this.game.effects?.sparks(new THREE.Vector3(at.x, this.pos.y + 0.6, at.z), Math.min(20, impact));
    if (this.driver === this.game.player && impact > 10) this.game.cameraShake(Math.min(0.6, impact / 40));
  }

  damage(amount, source, kind) {
    if (this.destroyed) return;
    this.health -= amount;
    if (source && this.driver?.onVehicleAttacked) this.driver.onVehicleAttacked(source);
    if (source === this.game.player && this.isPolice && kind === 'bullet') this.game.police.crime('attackCop', this.pos);
    if (kind === 'explosion' && this.health <= 0 && !this.destroyed) this.fireTimer = Math.min(this.fireTimer < 0 ? 0.3 : this.fireTimer, 0.3);
  }

  explode() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.health = 0;
    this.game.effects.explosion(this.pos.clone().setY(this.pos.y + 1));
    this.game.explosionAt(this.pos, 9, 220, this);
    this.vy = 7;
    this.grounded = false;
    this.yawRate = (Math.random() - 0.5) * 3;
    this.model.traverse((o) => {
      if (o.isMesh) {
        let m = burntCache.get(o.material);
        if (!m) {
          m = o.material.clone();
          m.color = new THREE.Color(0x2a2522);
          m.map = null;
          burntCache.set(o.material, m);
        }
        o.material = m;
      }
    });
    this.sirenOn = false;
    this.burnTimer = 12;
    if (this.driver && this.driver !== this.game.player) this.driver.onVehicleDestroyed?.(this);
    if (this.driver === this.game.player) this.game.player.onVehicleExploded(this);
  }

  syncObject() {
    this.object.position.copy(this.pos);
    this.object.rotation.set(0, 0, 0);
    this.object.rotateY(this.heading);
    this.object.rotateX(this.pitch);
    this.object.rotateZ(this.roll);
  }

  // Door position (left side) for entering / exiting
  doorPosition(out = new THREE.Vector3()) {
    const rx = Math.cos(this.heading), rz = -Math.sin(this.heading); // left side (driver side)
    return out.set(this.pos.x + rx * (this.halfW + 0.9), this.pos.y, this.pos.z + rz * (this.halfW + 0.9));
  }

  dispose() {
    this.setHeadlightSpot(false);
    this.game.scene.remove(this.object);
  }
}

// Resolve vehicle-vs-vehicle collisions with simple impulses between circle pairs.
export function collideVehicles(vehicles, game) {
  const n = vehicles.length;
  for (let a = 0; a < n; a++) {
    const A = vehicles[a];
    for (let b = a + 1; b < n; b++) {
      const B = vehicles[b];
      const dx0 = B.pos.x - A.pos.x, dz0 = B.pos.z - A.pos.z;
      const reach = A.halfL + B.halfL;
      if (dx0 * dx0 + dz0 * dz0 > reach * reach) continue;
      if (Math.abs(A.pos.y - B.pos.y) > 2) continue;
      const ca = A.circles(), cb = B.circles();
      for (const p of ca) {
        for (const q of cb) {
          const dx = q.x - p.x, dz = q.z - p.z;
          const d = Math.hypot(dx, dz);
          const min = A.radius + B.radius;
          if (d >= min || d < 1e-4) continue;
          const nx = dx / d, nz = dz / d;
          const pen = min - d;
          const ma = A.spec.mass * (A.destroyed ? 1.5 : 1), mb = B.spec.mass * (B.destroyed ? 1.5 : 1);
          const ta = mb / (ma + mb), tb = ma / (ma + mb);
          A.pos.x -= nx * pen * ta; A.pos.z -= nz * pen * ta;
          B.pos.x += nx * pen * tb; B.pos.z += nz * pen * tb;
          const rvx = B.vel.x - A.vel.x, rvz = B.vel.y - A.vel.y;
          const vn = rvx * nx + rvz * nz;
          if (vn < 0) {
            const j = (-(1.3) * vn) / (1 / ma + 1 / mb);
            A.vel.x -= (j / ma) * nx; A.vel.y -= (j / ma) * nz;
            B.vel.x += (j / mb) * nx; B.vel.y += (j / mb) * nz;
            const impact = -vn;
            if (impact > 4) {
              A.crash(impact * ta * 1.2, q); B.crash(impact * tb * 1.2, p);
              A.yawRate += (Math.random() - 0.5) * impact * 0.04;
              B.yawRate += (Math.random() - 0.5) * impact * 0.04;
              game.onVehicleCollision(A, B, impact);
            }
          }
        }
      }
    }
  }
}
