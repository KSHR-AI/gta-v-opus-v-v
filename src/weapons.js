import * as THREE from 'three';
import { raySphere } from './physics.js';

export const WEAPONS = {
  fists: { name: 'Fists', melee: true, damage: 18, rate: 0.45, range: 1.8 },
  pistol: { name: 'Pistol', damage: 34, rate: 0.22, clip: 12, spread: 0.012, range: 120, auto: false, sound: 'pistol' },
  smg: { name: 'SMG', damage: 17, rate: 0.075, clip: 30, spread: 0.035, range: 100, auto: true, sound: 'smg' },
  shotgun: { name: 'Shotgun', damage: 14, pellets: 9, rate: 0.85, clip: 6, spread: 0.07, range: 45, auto: false, sound: 'shotgun' },
  rocket: { name: 'Rocket Launcher', damage: 0, rate: 1.2, clip: 1, spread: 0, range: 200, auto: false, projectile: true, sound: 'rocket' },
};
export const WEAPON_ORDER = ['fists', 'pistol', 'smg', 'shotgun', 'rocket'];

const tmpC = new THREE.Vector3();

// Hit-scan against peds, vehicles and static geometry. Returns closest hit.
export function traceShot(game, origin, dir, range, ignore) {
  let best = { t: range, type: 'none', target: null };
  const staticT = game.city.collision.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, range);
  if (staticT < best.t) best = { t: staticT, type: 'static', target: null };
  if (dir.y < -1e-3) {
    const tg = (game.city.groundHeight(origin.x, origin.z) - origin.y) / dir.y;
    if (tg > 0 && tg < best.t) best = { t: tg, type: 'ground', target: null };
  }
  for (const ped of game.peds.all) {
    if (ped === ignore || ped.dead) continue;
    const dx = ped.pos.x - origin.x, dz = ped.pos.z - origin.z;
    if (dx * dx + dz * dz > (best.t + 2) ** 2) continue;
    for (const [h, r, head] of [[1.0, 0.45, false], [1.62, 0.28, true]]) {
      tmpC.set(ped.pos.x, ped.pos.y + h, ped.pos.z);
      const t = raySphere(origin, dir, tmpC, r);
      if (t < best.t) best = { t, type: 'ped', target: ped, head };
    }
  }
  const player = game.player;
  if (player !== ignore && !player.vehicle && !player.dead) {
    tmpC.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
    const t = raySphere(origin, dir, tmpC, 0.5);
    if (t < best.t) best = { t, type: 'player', target: player };
  }
  for (const v of game.vehicles) {
    if (ignore && ignore.vehicle === v) continue;
    const dx = v.pos.x - origin.x, dz = v.pos.z - origin.z;
    if (dx * dx + dz * dz > (best.t + 6) ** 2) continue;
    for (const c of v.circles()) {
      tmpC.set(c.x, v.pos.y + v.height * 0.45, c.z);
      const t = raySphere(origin, dir, tmpC, v.radius * 1.05);
      if (t < best.t) best = { t, type: 'vehicle', target: v };
    }
  }
  best.point = origin.clone().addScaledVector(dir, best.t);
  return best;
}

export function applyHit(game, hit, damage, shooter, dir) {
  if (hit.type === 'ped') {
    hit.target.takeDamage(hit.head ? damage * 2.5 : damage, shooter, dir);
    game.effects.blood(hit.point);
  } else if (hit.type === 'player') {
    hit.target.takeDamage(damage, shooter);
    game.effects.blood(hit.point);
  } else if (hit.type === 'vehicle') {
    hit.target.damage(damage * 1.4, shooter, 'bullet');
    game.effects.sparks(hit.point, 4);
    if (hit.target.driver && hit.target.driver !== game.player && shooter === game.player) hit.target.driver.panic?.(shooter);
  } else if (hit.type === 'static' || hit.type === 'ground') {
    game.effects.impact(hit.point);
  }
}

// Rockets
export class Projectile {
  constructor(game, pos, dir, owner) {
    this.game = game;
    this.pos = pos.clone();
    this.vel = dir.clone().multiplyScalar(55);
    this.owner = owner;
    this.life = 4;
    this.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.7, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x555555 }));
    this.mesh.position.copy(pos);
    this.mesh.lookAt(pos.clone().add(dir));
    game.scene.add(this.mesh);
  }

  update(dt) {
    this.life -= dt;
    const step = this.vel.length() * dt;
    const dir = this.vel.clone().normalize();
    const hit = traceShot(this.game, this.pos, dir, step, this.owner);
    this.game.effects.smoke(this.pos.clone(), 0xcccccc, 0.5);
    if (hit.type !== 'none' || this.life <= 0) {
      this.game.effects.explosion(hit.point);
      this.game.explosionAt(hit.point, 8, 250, null, this.owner);
      this.dispose();
      return false;
    }
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
    return true;
  }

  dispose() { this.game.scene.remove(this.mesh); }
}
