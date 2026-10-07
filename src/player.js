import * as THREE from 'three';
import { CharacterModel } from './character.js';
import { WEAPONS, WEAPON_ORDER, traceShot, applyHit, Projectile } from './weapons.js';
import { WATER_Y } from './city.js';

const tmpRes = { hit: false, nx: 0, nz: 0, depth: 0, obj: null };
const v3 = new THREE.Vector3();

export class Player {
  constructor(game, x, z, heading = 0) {
    this.game = game;
    this.model = new CharacterModel(game.scene, 'characters/character-q');
    this.pos = new THREE.Vector3(x, game.city.groundHeight(x, z), z);
    this.vel = new THREE.Vector3();
    this.heading = heading;
    this.health = 100;
    this.maxHealth = 100;
    this.armor = 0;
    this.money = 500;
    this.vehicle = null;
    this.entering = null;
    this.dead = false;
    this.grounded = true;
    this.swimming = false;
    this.weapon = 'fists';
    this.owned = new Set(['fists']);
    this.ammo = { pistol: 0, smg: 0, shotgun: 0, rocket: 0 };
    this.clip = { pistol: 0, smg: 0, shotgun: 0, rocket: 0 };
    this.cooldown = 0;
    this.reloading = 0;
    this.aiming = false;
    this.meleeTimer = 0;
    this.meleeSide = 0;
    this.shootAnimTimer = 0;
    this.arrestTimer = 0;
    this.radius = 0.38;
    this.giveWeapon('pistol', 48);
    this.syncModel(0);
  }

  get isDriving() { return !!this.vehicle; }
  get worldPos() { return this.vehicle ? this.vehicle.pos : this.pos; }
  get speed() { return this.vehicle ? this.vehicle.speed : Math.hypot(this.vel.x, this.vel.z); }

  giveWeapon(kind, ammo) {
    const first = !this.owned.has(kind);
    this.owned.add(kind);
    this.ammo[kind] += ammo;
    if (this.clip[kind] === 0) this.reload(kind, true);
    if (first && !this.vehicle) this.weapon = kind;
  }

  reload(kind = this.weapon, instant = false) {
    const w = WEAPONS[kind];
    if (!w.clip) return;
    const need = w.clip - this.clip[kind];
    const take = Math.min(need, this.ammo[kind]);
    if (take <= 0) return;
    this.ammo[kind] -= take;
    this.clip[kind] += take;
    if (!instant) { this.reloading = 1.1; this.game.audio.reload(); }
  }

  switchWeapon(delta) {
    const list = WEAPON_ORDER.filter((w) => this.owned.has(w) && (w === 'fists' || this.ammo[w] + this.clip[w] > 0));
    let i = list.indexOf(this.weapon);
    i = (i + delta + list.length) % list.length;
    this.weapon = list[i];
    this.reloading = 0;
  }

  selectWeapon(kind) {
    if (this.owned.has(kind) && (kind === 'fists' || this.ammo[kind] + this.clip[kind] > 0)) { this.weapon = kind; this.reloading = 0; }
  }

  update(dt) {
    const g = this.game, input = g.input;
    this.cooldown -= dt;
    this.meleeTimer -= dt;
    this.shootAnimTimer -= dt;
    if (this.reloading > 0) this.reloading -= dt;
    if (this.dead) { this.model.update(dt); return; }

    // weapon selection
    for (const [k, w] of [['Digit1', 'fists'], ['Digit2', 'pistol'], ['Digit3', 'smg'], ['Digit4', 'shotgun'], ['Digit5', 'rocket']]) if (input.hit(k)) this.selectWeapon(w);
    if (input.mouse.wheel) this.switchWeapon(input.mouse.wheel > 0 ? 1 : -1);
    if (input.hit('KeyR') && !this.vehicle) this.reload();

    if (input.hit('KeyF')) {
      if (this.vehicle) this.exitVehicle();
      else if (!this.entering) this.tryEnterVehicle();
    }

    if (this.vehicle) this.updateDriving(dt);
    else if (this.entering) this.updateEntering(dt);
    else this.updateOnFoot(dt);
    this.model.update(dt);
  }

  // ---------------- on foot ----------------
  updateOnFoot(dt) {
    const g = this.game, input = g.input, city = g.city;
    const cam = g.cameraRig;
    const fwdX = -Math.sin(cam.yaw), fwdZ = -Math.cos(cam.yaw);
    const rightX = Math.cos(cam.yaw), rightZ = -Math.sin(cam.yaw);
    const mf = input.axis('KeyS', 'KeyW'), ms = input.axis('KeyA', 'KeyD');
    let dx = fwdX * mf + rightX * ms, dz = fwdZ * mf + rightZ * ms;
    const len = Math.hypot(dx, dz);
    if (len > 0) { dx /= len; dz /= len; }
    const w = WEAPONS[this.weapon];
    this.aiming = input.mouse.right && !this.swimming;
    const firing = input.mouse.left && !this.swimming;
    const sprint = input.down('ShiftLeft') && !this.aiming;
    let speed = this.swimming ? 2.6 : this.aiming ? 2.6 : sprint ? 8.5 : 5.2;
    if (this.meleeTimer > 0.15) speed *= 0.2;
    const ax = dx * speed, az = dz * speed;
    const k = Math.min(1, dt * (this.grounded ? 12 : 2));
    this.vel.x += (ax - this.vel.x) * k;
    this.vel.z += (az - this.vel.z) * k;

    // facing
    let targetHeading = this.heading;
    if (this.aiming || (firing && !w.melee)) targetHeading = Math.atan2(fwdX, fwdZ);
    else if (len > 0) targetHeading = Math.atan2(dx, dz);
    let dh = targetHeading - this.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * Math.min(1, dt * (this.aiming ? 20 : 12));

    // jump
    if (input.hit('Space') && this.grounded && !this.swimming) { this.vel.y = 6.2; this.grounded = false; }

    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const ground = city.groundHeight(this.pos.x, this.pos.z);
    const inWater = city.isWater(this.pos.x, this.pos.z);
    if (inWater && this.pos.y <= WATER_Y - 0.9 + 0.05) {
      if (!this.swimming) g.effects.splash(this.pos);
      this.swimming = true;
      this.pos.y = WATER_Y - 0.95;
      this.vel.y = 0;
      this.grounded = true;
    } else {
      if (this.swimming && !inWater) {
        // climb out onto the shore
        if (ground - this.pos.y < 1.4) { this.pos.y = ground; this.swimming = false; }
        else { this.pos.x -= this.vel.x * dt; this.pos.z -= this.vel.z * dt; }
      }
      if (!this.swimming) {
        if (!this.grounded || this.pos.y > ground + 0.05) {
          this.vel.y -= 20 * dt;
          this.pos.y += this.vel.y * dt;
          if (this.pos.y <= ground) {
            if (this.vel.y < -16) this.takeDamage((-this.vel.y - 16) * 6, null);
            this.pos.y = ground; this.vel.y = 0; this.grounded = true;
          } else this.grounded = false;
        } else if (ground - this.pos.y > 0.9) {
          this.pos.x -= this.vel.x * dt; this.pos.z -= this.vel.z * dt;
        } else {
          this.pos.y = ground;
        }
      }
    }

    // collisions
    city.collision.resolveCircle(this.pos, this.radius, this.pos.y + 0.4, tmpRes);
    for (const v of g.vehicles) {
      if (Math.abs(v.pos.x - this.pos.x) > 8 || Math.abs(v.pos.z - this.pos.z) > 8) continue;
      if (this.pos.y > v.pos.y + v.height - 0.2) continue;
      for (const c of v.circles()) {
        const ddx = this.pos.x - c.x, ddz = this.pos.z - c.z;
        const d = Math.hypot(ddx, ddz), min = this.radius + v.radius;
        if (d < min && d > 1e-4) {
          this.pos.x += (ddx / d) * (min - d);
          this.pos.z += (ddz / d) * (min - d);
          const sp = v.speed;
          if (sp > 6 && v.driver && v.driver !== this) this.takeDamage(sp * 2.2, v.driver, true);
        }
      }
      // stand on top of cars
      if (Math.hypot(this.pos.x - v.pos.x, this.pos.z - v.pos.z) < v.halfW && this.pos.y > v.pos.y + v.height - 0.6 && this.vel.y <= 0) {
        this.pos.y = v.pos.y + v.height; this.vel.y = 0; this.grounded = true;
      }
    }

    // combat
    if (this.reloading <= 0 && !this.swimming) {
      if (w.melee) {
        if (input.mouse.leftPressed && this.meleeTimer <= 0) this.melee();
      } else if (firing && this.cooldown <= 0 && (w.auto || input.mouse.leftPressed)) {
        this.shoot();
      }
    }

    // arrest check
    this.checkArrest(dt);

    this.animate(len > 0);
    this.syncModel(dt);
  }

  animate(moving) {
    const m = this.model, w = WEAPONS[this.weapon];
    const twoHand = ['smg', 'shotgun', 'rocket'].includes(this.weapon);
    m.setWeapon(this.weapon === 'fists' ? null : this.weapon);
    if (this.swimming) { m.play('walk', { timeScale: 0.6 }); return; }
    if (this.meleeTimer > 0) return;
    if (!this.grounded) { m.play('idle'); return; }
    if (!w.melee && (this.aiming || this.shootAnimTimer > 0)) {
      m.play(twoHand ? (this.shootAnimTimer > 0 ? 'holding-both-shoot' : 'holding-both') : (this.shootAnimTimer > 0 ? 'holding-right-shoot' : 'holding-right'), { fade: 0.08 });
      return;
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 6.5) m.play('sprint', { timeScale: 1.1 });
    else if (sp > 0.6) m.play('walk', { timeScale: sp / 3.2 });
    else m.play('idle');
  }

  syncModel() {
    this.model.root.position.copy(this.pos);
    this.model.root.rotation.y = this.heading;
    if (this.swimming) this.model.root.position.y = WATER_Y - 1.0;
  }

  melee() {
    const g = this.game;
    this.meleeTimer = WEAPONS.fists.rate;
    this.meleeSide = (this.meleeSide + 1) % 3;
    this.model.play(['attack-melee-right', 'attack-melee-left', 'attack-kick-right'][this.meleeSide], { once: true, fade: 0.05, force: true, timeScale: 1.6 });
    g.audio.swing();
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let best = null, bestD = 2.0;
    for (const p of g.peds.all) {
      if (p.dead) continue;
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < bestD && (dx * fx + dz * fz) / (d || 1) > 0.3) { best = p; bestD = d; }
    }
    if (best) {
      setTimeout(() => {
        if (best.dead) return;
        best.takeDamage(WEAPONS.fists.damage + Math.random() * 8, this, new THREE.Vector3(fx, 0.2, fz), true);
        g.audio.punch();
        g.police.crime('assault', this.pos);
      }, 150);
    }
  }

  shoot() {
    const g = this.game, w = WEAPONS[this.weapon];
    if (this.clip[this.weapon] <= 0) {
      if (this.ammo[this.weapon] > 0) this.reload();
      else { g.audio.click(); this.cooldown = 0.3; this.switchWeapon(-1); }
      return;
    }
    this.clip[this.weapon]--;
    this.cooldown = w.rate;
    this.shootAnimTimer = 0.35;
    const cam = g.camera;
    const camDir = cam.getWorldDirection(new THREE.Vector3());
    // aim point from the camera ray
    const camHit = traceShot(g, cam.position.clone().addScaledVector(camDir, g.cameraRig.currentDist * 0.9), camDir, w.range, this);
    // the muzzle must be in front of the player's body; update the model's matrices first
    this.model.root.updateMatrixWorld(true);
    const muzzle = this.model.muzzleWorld(new THREE.Vector3());
    const chest = new THREE.Vector3(this.pos.x, this.pos.y + 1.35, this.pos.z);
    g.effects.muzzle(muzzle);
    g.audio.shot(w.sound, this.pos, true);
    g.police.crime('shoot', this.pos);
    if (w.projectile) {
      const dir = camHit.point.clone().sub(muzzle).normalize();
      g.projectiles.push(new Projectile(g, muzzle.clone().addScaledVector(dir, 0.5), dir, this));
      return;
    }
    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const dir = camHit.point.clone().sub(chest).normalize();
      dir.x += (Math.random() - 0.5) * w.spread * 2;
      dir.y += (Math.random() - 0.5) * w.spread * 2;
      dir.z += (Math.random() - 0.5) * w.spread * 2;
      dir.normalize();
      const hit = traceShot(g, chest, dir, w.range, this);
      applyHit(g, hit, w.damage, this, dir);
      if (hit.type === 'ped' || hit.type === 'vehicle') g.hud.hitMarker();
      g.effects.tracer(muzzle, hit.point);
    }
  }

  // ---------------- vehicles ----------------
  tryEnterVehicle() {
    const g = this.game;
    let best = null, bestD = Infinity;
    for (const v of g.vehicles) {
      if (v.destroyed || v.sinking) continue;
      const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) - v.halfL;
      if (d < 4 && d < bestD) { best = v; bestD = d; }
    }
    if (!best) return;
    this.entering = { vehicle: best, t: 0 };
    if (best.driver && best.driver !== this) {
      best.driver.ejectFromVehicle?.(this);
      g.police.crime(best.isPolice ? 'stealCop' : 'carjack', this.pos);
    }
  }

  updateEntering(dt) {
    const e = this.entering, v = e.vehicle;
    e.t += dt;
    const door = v.doorPosition(v3);
    const dx = door.x - this.pos.x, dz = door.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (v.destroyed) { this.entering = null; return; }
    if (d > 0.5 && e.t < 1.2) {
      const sp = Math.min(d / dt, 7);
      this.pos.x += (dx / d) * sp * dt;
      this.pos.z += (dz / d) * sp * dt;
      this.heading = Math.atan2(dx, dz);
      this.model.play('sprint');
      this.syncModel(dt);
      return;
    }
    this.entering = null;
    this.enterVehicle(v);
  }

  enterVehicle(v) {
    if (v.driver && v.driver !== this) v.driver.ejectFromVehicle?.(this);
    this.vehicle = v;
    v.driver = this;
    v.persistent = true;
    this.model.visible = false;
    this.aiming = false;
    this.game.hud.showVehicleName(v.name);
    this.game.audio.door();
    this.game.onPlayerEnterVehicle(v);
  }

  exitVehicle(force = false) {
    const v = this.vehicle;
    if (!v) return;
    if (!force && v.speed > 14) {
      // bail out at speed
      this.takeDamage(10, null);
    }
    v.driver = null;
    v.setHeadlightSpot(false);
    v.sirenOn = v.isPolice && v.sirenOn;
    this.vehicle = null;
    const door = v.doorPosition(new THREE.Vector3());
    const p = { x: door.x, z: door.z };
    this.game.city.collision.resolveCircle(p, 0.4, v.pos.y + 0.5, tmpRes);
    if (tmpRes.hit) {
      // try passenger side
      const rx = -Math.cos(v.heading), rz = Math.sin(v.heading);
      p.x = v.pos.x + rx * (v.halfW + 0.9); p.z = v.pos.z + rz * (v.halfW + 0.9);
    }
    this.pos.set(p.x, Math.max(v.pos.y, this.game.city.groundHeight(p.x, p.z)), p.z);
    this.vel.set(v.vel.x * 0.4, 0, v.vel.y * 0.4);
    this.heading = v.heading;
    this.grounded = false;
    this.model.visible = true;
    this.game.audio.door();
    this.game.onPlayerExitVehicle(v);
    this.syncModel(0);
  }

  updateDriving(dt) {
    const g = this.game, input = g.input, v = this.vehicle;
    const throttle = input.axis('KeyS', 'KeyW');
    const steer = input.axis('KeyA', 'KeyD');
    if (input.hit('KeyH')) {
      if (v.isPolice) v.sirenOn = !v.sirenOn;
    }
    v.horn = input.down('KeyH') && !v.isPolice;
    v.setHeadlightSpot(g.sky.night > 0.25 && !v.destroyed);
    v.update(dt, { throttle, steer, handbrake: input.down('Space') });
    this.pos.copy(v.pos);
    this.heading = v.heading;
    this.syncModel(dt);
    if (v.sinking && v.sinking > 0.6) {
      this.exitVehicle(true);
      this.pos.y = WATER_Y - 0.95;
      this.swimming = true;
    }
    // arrest in vehicle: stopped with cops adjacent
    this.checkArrest(dt);
  }

  onVehicleExploded(v) {
    this.takeDamage(200, null);
    if (this.vehicle === v) this.exitVehicle(true);
  }

  checkArrest(dt) {
    const g = this.game;
    if (g.police.wanted === 0) { this.arrestTimer = 0; return; }
    let near = false;
    for (const c of g.peds.all) {
      if (c.role !== 'cop' || c.dead) continue;
      if (Math.hypot(c.pos.x - this.worldPos.x, c.pos.z - this.worldPos.z) < (this.vehicle ? 4 : 1.9)) { near = true; break; }
    }
    const slow = this.speed < (this.vehicle ? 1.0 : 2.0);
    const armed = this.weapon !== 'fists' && !this.vehicle;
    if (near && slow && (g.police.wanted <= 2 || !armed)) {
      this.arrestTimer += dt;
      if (this.arrestTimer > (this.vehicle ? 2.5 : 1.4)) g.arrestPlayer();
    } else {
      this.arrestTimer = Math.max(0, this.arrestTimer - dt);
    }
  }

  // ---------------- health ----------------
  takeDamage(amount, source, knock = false) {
    if (this.dead || this.game.godMode) return;
    if (this.vehicle && source && source !== this && !knock) amount *= 0.5;
    if (this.armor > 0) {
      const a = Math.min(this.armor, amount * 0.7);
      this.armor -= a;
      amount -= a;
    }
    this.health -= amount;
    this.game.hud.damageFlash();
    if (this.health <= 0) {
      this.health = 0;
      this.die();
    }
  }

  die() {
    if (this.vehicle) this.exitVehicle(true);
    this.dead = true;
    this.model.visible = true;
    this.model.setWeapon(null);
    this.model.play('die', { once: true, fade: 0.1 });
    this.game.onPlayerDied();
  }

  respawn(x, z, heading) {
    this.dead = false;
    this.health = this.maxHealth;
    this.armor = 0;
    this.pos.set(x, this.game.city.groundHeight(x, z), z);
    this.vel.set(0, 0, 0);
    this.heading = heading;
    this.swimming = false;
    this.entering = null;
    this.arrestTimer = 0;
    this.model.visible = true;
    this.model.play('idle', { force: true, fade: 0 });
    this.syncModel(0);
  }
}
