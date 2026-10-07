import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { roadCoord, P, RW, SW, HALF, CURB } from './city.js';

const DEFS = {
  pistol: { color: 0xffcf3d, ammo: 36, label: 'Pistol' },
  smg: { color: 0xffa040, ammo: 90, label: 'SMG' },
  shotgun: { color: 0xff7040, ammo: 18, label: 'Shotgun' },
  rocket: { color: 0x9ccc65, ammo: 4, label: 'Rocket Launcher' },
  health: { color: 0xff4040, label: 'Health' },
  armor: { color: 0x4fa3ff, label: 'Body Armor' },
  cash: { color: 0x5cd65c, label: 'Cash' },
};

function makeMesh(kind) {
  const g = new THREE.Group();
  const def = DEFS[kind];
  const mat = new THREE.MeshStandardMaterial({ color: def.color, emissive: def.color, emissiveIntensity: 0.45, roughness: 0.4 });
  if (kind === 'health') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.22), mat), new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), mat));
  } else if (kind === 'armor') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.2, 6).rotateX(Math.PI / 2), mat));
  } else if (kind === 'cash') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.35), mat));
  } else if (kind === 'rocket') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.1, 10).rotateZ(Math.PI / 2), mat));
  } else {
    const len = kind === 'pistol' ? 0.45 : kind === 'smg' ? 0.7 : 1.0;
    g.add(new THREE.Mesh(new THREE.BoxGeometry(len, 0.14, 0.1), mat));
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.25, 0.1), mat);
    grip.position.set(-len / 2 + 0.12, -0.15, 0);
    g.add(grip);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 24), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.95;
  g.add(ring);
  return g;
}

export class Pickups {
  constructor(game) {
    this.game = game;
    this.items = [];
    const sw = (bi, bj, side = 0) => {
      const x0 = roadCoord(bi) + RW + SW / 2, z0 = roadCoord(bj) + RW + SW / 2;
      const len = P - 2 * RW - SW;
      return side === 0 ? { x: x0 + len / 2, z: z0 } : side === 1 ? { x: x0 + len, z: z0 + len / 2 } : side === 2 ? { x: x0 + len / 2, z: z0 + len } : { x: x0, z: z0 + len / 2 };
    };
    const spots = [
      ['pistol', sw(1, 7, 1)], ['smg', sw(5, 1, 2)], ['smg', sw(8, 8, 0)], ['shotgun', sw(2, 2, 3)], ['shotgun', sw(7, 5, 1)],
      ['rocket', { x: -260, z: -HALF - 50 }], ['pistol', sw(4, 4, 0)], ['health', { x: game.city.locations.hospital.x + 4, z: game.city.locations.hospital.z }],
      ['armor', { x: game.city.locations.police.x, z: game.city.locations.police.z + 5 }], ['armor', sw(9, 0, 2)], ['health', sw(3, 8, 1)],
      ['health', sw(6, 6, 3)], ['armor', { x: 60, z: HALF + 80 }], ['shotgun', { x: -120, z: HALF + 60 }], ['smg', sw(0, 3, 1)],
    ];
    for (const [kind, p] of spots) this.spawn(kind, p.x, p.z, { respawn: 45 });
  }

  spawn(kind, x, z, { respawn = 0, amount = 0, life = 0 } = {}) {
    const mesh = makeMesh(kind);
    const y = this.game.city.groundHeight(x, z) + 1;
    mesh.position.set(x, y, z);
    this.game.scene.add(mesh);
    const it = { kind, x, z, y, mesh, respawn, amount, life, active: true, timer: 0 };
    this.items.push(it);
    return it;
  }

  spawnDrop(kind, pos, amount = 0) {
    this.spawn(kind, pos.x + (Math.random() - 0.5), pos.z + (Math.random() - 0.5), { amount, life: 40 });
  }

  blips() {
    return this.items.filter((i) => i.active && i.respawn && ['rocket', 'health', 'armor'].includes(i.kind)).map((i) => ({ x: i.x, z: i.z, dot: true, r: 3, color: '#' + DEFS[i.kind].color.toString(16).padStart(6, '0') }));
  }

  collect(it) {
    const pl = this.game.player, hud = this.game.hud;
    const def = DEFS[it.kind];
    if (it.kind === 'health') { if (pl.health >= pl.maxHealth) return false; pl.health = pl.maxHealth; }
    else if (it.kind === 'armor') { if (pl.armor >= 100) return false; pl.armor = 100; }
    else if (it.kind === 'cash') { pl.money += it.amount || 100; this.game.audio.cash(); hud.feed(`+$${it.amount || 100}`); return true; }
    else {
      const ammo = it.respawn ? def.ammo : Math.ceil(def.ammo / 2);
      pl.giveWeapon(it.kind, ammo);
      hud.feed(`${WEAPONS[it.kind].name} +${ammo}`);
    }
    if (it.kind === 'health' || it.kind === 'armor') hud.feed(def.label);
    this.game.audio.pickup();
    return true;
  }

  update(dt) {
    const pl = this.game.player;
    const t = this.game.time;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.active) {
        it.timer -= dt;
        if (it.timer <= 0) { it.active = true; it.mesh.visible = true; }
        continue;
      }
      it.mesh.rotation.y = t * 2;
      it.mesh.position.y = it.y + Math.sin(t * 3 + i) * 0.12;
      if (it.life) {
        it.life -= dt;
        if (it.life <= 0) { this.remove(i); continue; }
      }
      const p = pl.worldPos;
      if (!pl.dead && Math.hypot(p.x - it.x, p.z - it.z) < (pl.vehicle ? 2.5 : 1.3) && Math.abs(p.y + 1 - it.y) < 2.5) {
        if (this.collect(it)) {
          if (it.respawn) { it.active = false; it.mesh.visible = false; it.timer = it.respawn; }
          else this.remove(i);
        }
      }
    }
  }

  remove(i) {
    const mesh = this.items[i].mesh;
    this.game.scene.remove(mesh);
    mesh.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    });
    this.items.splice(i, 1);
  }
}
void CURB;
