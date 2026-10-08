import { CopDriver } from './traffic.js';
import { Ped } from './peds.js';

const CRIMES = {
  shoot: { level: 1, needWitness: true },
  assault: { level: 1, needWitness: true, chance: 0.35 },
  carjack: { level: 1, needWitness: true, chance: 0.4 },
  hitPed: { level: 1, needWitness: true, chance: 0.5 },
  killPed: { level: 2, bump: true },
  attackCop: { level: 2 },
  killCop: { level: 3, bump: true },
  stealCop: { level: 2 },
  hitCop: { level: 1 },
  explosion: { level: 2, bump: true },
};

export class Police {
  constructor(game) {
    this.game = game;
    this.wanted = 0;
    this.heat = 0;
    this.unseenTimer = 0;
    this.spawnTimer = 0;
    this.lastCrime = {};
    this.seen = false;
  }

  copsNear(pos, radius) {
    const g = this.game;
    for (const p of g.peds.all) if (p.role === 'cop' && !p.dead && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < radius) return true;
    for (const v of g.vehicles) if (v.isPolice && v.driver && v.driver !== g.player && !v.destroyed && Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z) < radius) return true;
    return false;
  }

  crime(type, pos) {
    const c = CRIMES[type];
    if (!c || this.game.player.dead) return;
    const now = this.game.time;
    if (c.needWitness) {
      const copWitness = this.copsNear(pos, 70);
      if (!copWitness) {
        if (this.game.peds.witnesses(pos, 35) === 0) return;
        if (c.chance && Math.random() > c.chance) return;
      }
    }
    let level = c.level;
    if (c.bump && this.wanted >= level) {
      if (now - (this.lastCrime[type] || -99) < 1) return;
      this.heat += type === 'killCop' ? 1 : 0.5;
      if (this.heat >= 1) { this.heat = 0; level = this.wanted + 1; }
    }
    this.lastCrime[type] = now;
    this.setWanted(Math.max(this.wanted, Math.min(5, level)));
    this.unseenTimer = 0;
  }

  setWanted(n) {
    const prev = this.wanted;
    this.wanted = n;
    if (n > prev) {
      this.game.audio.wantedUp();
      this.spawnTimer = Math.min(this.spawnTimer, 1);
    }
    if (n === 0 && prev > 0) {
      this.game.hud.feed('You lost the cops.');
      this.heat = 0;
    }
  }

  clear() {
    this.setWanted(0);
    this.unseenTimer = 0;
  }

  get searchTime() { return 8 + this.wanted * 4; }

  update(dt) {
    const g = this.game;
    if (this.wanted === 0) { this.seen = false; return; }
    const pp = g.player.worldPos;
    // Is the player seen by any cop?
    let seen = false;
    for (const p of g.peds.all) {
      if (p.role !== 'cop' || p.dead) continue;
      const d = Math.hypot(p.pos.x - pp.x, p.pos.z - pp.z);
      if (d < 25 || (d < 80 && g.city.collision.lineOfSight(p.pos.x, p.pos.y + 1.6, p.pos.z, pp.x, pp.y + 1, pp.z))) { seen = true; break; }
    }
    if (!seen) {
      for (const v of g.vehicles) {
        if (!v.isPolice || v.destroyed || !v.driver || v.driver === g.player) continue;
        const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
        if (d < 30 || (d < 100 && g.city.collision.lineOfSight(v.pos.x, v.pos.y + 1.4, v.pos.z, pp.x, pp.y + 1, pp.z))) { seen = true; break; }
      }
    }
    this.seen = seen;
    if (seen) this.unseenTimer = 0;
    else {
      this.unseenTimer += dt;
      if (this.unseenTimer > this.searchTime) this.clear();
    }

    // Spawn pursuit units
    const want = [0, 1, 2, 3, 5, 7][this.wanted];
    const active = g.traffic.drivers.filter((d) => d instanceof CopDriver && d.active && Math.hypot(d.vehicle.pos.x - pp.x, d.vehicle.pos.z - pp.z) < 220).length;
    this.spawnTimer -= dt;
    if (active < want && this.spawnTimer <= 0) {
      this.spawnTimer = Math.max(1.5, 6 - this.wanted);
      g.traffic.spawnCivilian(70, 150, true);
    }
    // Foot cops when on foot and high wanted
    const footCops = g.peds.all.filter((p) => p.role === 'cop' && !p.dead).length;
    if (!g.player.vehicle && footCops < this.wanted * 2 && Math.random() < dt * 0.3) {
      const p = g.peds.spawnCivilian(40, 90);
      if (p) { p.dispose(); g.peds.all.splice(g.peds.all.indexOf(p), 1); this.spawnFootCop(p.pos.x, p.pos.z); }
    }
  }

  spawnFootCop(x, z) {
    this.game.peds.add(new Ped(this.game, x, z, { role: 'cop' }));
  }
}
