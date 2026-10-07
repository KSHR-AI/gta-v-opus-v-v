import * as THREE from 'three';
import { assets } from './assets.js';
import { City, RW } from './city.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { Vehicle, collideVehicles } from './vehicle.js';
import { TrafficManager } from './traffic.js';
import { PedManager } from './peds.js';
import { Police } from './police.js';
import { Effects } from './effects.js';
import { Sky } from './sky.js';
import { AudioSystem, STATIONS } from './audio.js';
import { HUD } from './hud.js';
import { Pickups } from './pickups.js';
import { Missions } from './missions.js';
import { CameraRig } from './camera.js';

const PARKED_TYPES = ['sedan', 'suv', 'hatchback-sports', 'sedan-sports', 'suv-luxury', 'van', 'taxi', 'sedan'];

class Game {
  constructor() {
    this.time = 0;
    this.frame = 0;
    this.paused = true;
    this.started = false;
    this.vehicles = [];
    this.projectiles = [];
    this.stats = { kills: 0 };

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('app').appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 3500);
    this.input = new Input(r.domElement);
    this.audio = new AudioSystem(this);
    addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.effects?.setScale(innerHeight * Math.min(devicePixelRatio, 1.5));
  }

  async load() {
    const bar = document.getElementById('loading-bar'), txt = document.getElementById('loading-text');
    await assets.loadAll((p, f) => { bar.style.width = `${p * 85}%`; txt.textContent = `Loading ${f}…`; });
    txt.textContent = 'Building Port Solano…';
    await new Promise((r) => setTimeout(r, 30));
    this.sky = new Sky(this.scene);
    this.city = new City(this.scene);
    this.city.generate();
    bar.style.width = '95%';
    this.effects = new Effects(this.scene, this.renderer);
    this.resize();
    const L = this.city.locations;
    this.player = new Player(this, L.safehouse.x, L.safehouse.z, L.safehouse.heading);
    this.cameraRig = new CameraRig(this, this.camera);
    this.cameraRig.yaw = L.safehouse.heading + Math.PI + 0.5;
    this.traffic = new TrafficManager(this);
    this.peds = new PedManager(this);
    this.police = new Police(this);
    this.pickups = new Pickups(this);
    this.missions = new Missions(this);
    this.hud = new HUD(this);
    this.parked = this.city.parkingSpots.map((s) => ({ ...s, vehicle: null }));
    for (const s of this.city.policeSpots) this.parked.push({ ...s, type: 'police', vehicle: null });
    // player's starter car in front of the safehouse
    const car = new Vehicle(this, 'sedan-sports', L.safehouse.x + 4, L.safehouse.z - 3.6, Math.PI / 2);
    car.persistent = true;
    this.vehicles.push(car);
    // pre-populate the streets
    for (let i = 0; i < 30; i++) this.peds.spawnCivilian(6, 130);
    for (let i = 0; i < 22; i++) this.traffic.spawnCivilian(25, 180);
    this.updateParked(true);
    // warm up shaders
    this.cameraRig.update(0.016);
    this.sky.update(0, this.player.pos);
    this.renderer.compile(this.scene, this.camera);
    bar.style.width = '100%';
    txt.textContent = 'Ready.';
    this.setupUI();
    this.loop();
  }

  setupUI() {
    const play = document.getElementById('play');
    const overlay = document.getElementById('overlay');
    play.disabled = false;
    play.textContent = 'PLAY';
    play.onclick = () => {
      this.audio.init();
      this.input.lock();
      overlay.classList.add('hidden');
      document.getElementById('hud').classList.remove('hidden');
      this.paused = false;
      if (!this.started) {
        this.started = true;
        this.hud.big('PORT SOLANO', 'gold', 'Welcome to the coast.', 3.5);
        this.hud.help('Your ride is parked outside. Press <b>F</b> to get in.<br>Visit the <b>M</b>, <b>D</b> and <b>V</b> markers on your map for jobs. Press <b>M</b> for the full map.', 10);
      }
    };
    this.input.onLockChange = (locked) => {
      if (!locked && this.started && !this.paused) this.pause();
    };
    // Fallback: allow playing even if pointer lock is unavailable
    this.renderer.domElement.addEventListener('click', () => { if (this.started && !this.input.locked && !this.paused) this.input.lock(); });
  }

  pause() {
    this.paused = true;
    const overlay = document.getElementById('overlay');
    overlay.classList.remove('hidden');
    overlay.classList.add('paused');
    document.getElementById('play').textContent = 'RESUME';
    document.getElementById('loading').style.display = 'none';
    document.getElementById('loading-text').textContent = `Jobs completed: ${this.missions.completed} / ${this.missions.total} · Money: $${this.player.money.toLocaleString()}`;
  }

  // ---------- world events ----------
  explosionAt(pos, radius, damage, sourceVehicle, owner) {
    this.audio.explosion(pos);
    const camD = this.camera.position.distanceTo(pos);
    this.cameraShake(Math.max(0, 1.2 - camD / 60));
    this.peds.panic(pos, 60);
    if (owner === this.player) this.police.crime('explosion', pos);
    for (const v of this.vehicles) {
      if (v === sourceVehicle) continue;
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
      if (d > radius) continue;
      const k = 1 - d / radius;
      v.damage(damage * 4 * k, owner, 'explosion');
      const nx = (v.pos.x - pos.x) / (d || 1), nz = (v.pos.z - pos.z) / (d || 1);
      v.vel.x += nx * 12 * k / v.spec.mass; v.vel.y += nz * 12 * k / v.spec.mass;
      v.vy = 6 * k; v.grounded = false;
      v.yawRate += (Math.random() - 0.5) * 4 * k;
      if (v.driver?.panic) v.driver.panic();
    }
    for (const p of this.peds.all) {
      if (p.dead) continue;
      const d = p.pos.distanceTo(pos);
      if (d > radius) continue;
      const k = 1 - d / radius;
      const dir = p.pos.clone().sub(pos).setY(0).normalize();
      p.vel.set(dir.x * 10 * k, 5 + 6 * k, dir.z * 10 * k);
      p.airborne = true;
      p.takeDamage(damage * k * 1.5, owner, dir, false, true);
    }
    const pl = this.player;
    const pd = pl.worldPos.distanceTo(pos);
    if (pd < radius && !pl.vehicle) {
      const k = 1 - pd / radius;
      pl.takeDamage(damage * 0.6 * k, null);
      const dir = pl.pos.clone().sub(pos).setY(0).normalize();
      pl.vel.set(dir.x * 8 * k, 5 * k, dir.z * 8 * k);
      pl.grounded = false;
    }
  }

  onVehicleCollision(a, b, impact) {
    const pv = this.player.vehicle;
    if (!pv || (a !== pv && b !== pv)) return;
    const other = a === pv ? b : a;
    if (other.isPolice && other.driver && other.driver !== this.player) this.police.crime('hitCop', pv.pos);
    if (other.driver?.panic && impact > 6) other.driver.panic();
  }

  onPlayerEnterVehicle(v) {
    if (STATIONS[this.audio.station].bpm) this.hud.showRadio(STATIONS[this.audio.station].name);
    if (!this.shownDriveHelp) {
      this.shownDriveHelp = true;
      this.hud.help('<b>W/S</b> drive / brake · <b>A/D</b> steer · <b>Space</b> handbrake<br><b>H</b> horn · <b>Q</b> change radio · <b>F</b> exit', 8);
    }
    void v;
  }

  onPlayerExitVehicle() {}

  cameraShake(a) { this.cameraRig.shake = Math.min(1.2, this.cameraRig.shake + a); }

  onPlayerDied() {
    this.missions.fail('You were flatlined');
    this.hud.big('FLATLINED', 'red', '', 4);
    this.audio.jingle(false);
    setTimeout(() => {
      const L = this.city.locations.hospital;
      const fee = Math.min(Math.round(this.player.money * 0.1), 500);
      this.player.money -= fee;
      this.police.clear();
      this.peds.clearHostiles();
      this.player.respawn(L.x, L.z, L.heading);
      this.cameraRig.yaw = L.heading + Math.PI;
      this.hud.feed(`Hospital bill: -$${fee}`);
    }, 4500);
  }

  arrestPlayer() {
    if (this.player.dead || this.arresting) return;
    this.arresting = true;
    if (this.player.vehicle) this.player.exitVehicle(true);
    this.player.dead = true;
    this.player.model.play('idle');
    this.missions.fail('You were arrested');
    this.hud.big('ARRESTED', 'blue', '', 4);
    this.audio.jingle(false);
    setTimeout(() => {
      const L = this.city.locations.police;
      const fee = Math.min(Math.round(this.player.money * 0.2), 1000);
      this.player.money -= fee;
      const pl = this.player;
      pl.owned = new Set(['fists']);
      for (const k in pl.ammo) { pl.ammo[k] = 0; pl.clip[k] = 0; }
      pl.weapon = 'fists';
      this.police.clear();
      this.peds.clearHostiles();
      pl.respawn(L.x, L.z, L.heading);
      this.cameraRig.yaw = L.heading + Math.PI;
      this.hud.feed(`Bail: -$${fee}. Weapons confiscated.`);
      this.arresting = false;
    }, 4000);
  }

  updateParked(initial = false) {
    const pp = this.player.worldPos;
    for (const s of this.parked) {
      if (s.vehicle && !this.vehicles.includes(s.vehicle)) s.vehicle = null;
      if (s.vehicle && s.vehicle.driver) s.vehicle = null; // taken
      const d = Math.hypot(s.x - pp.x, s.z - pp.z);
      if (!s.vehicle && d < 150 && (initial || d > 60)) {
        if (this.vehicles.some((v) => Math.hypot(v.pos.x - s.x, v.pos.z - s.z) < 4)) continue;
        const type = s.type || PARKED_TYPES[Math.floor(Math.random() * PARKED_TYPES.length)];
        const v = new Vehicle(this, type, s.x, s.z, s.rot + (Math.random() - 0.5) * 0.1);
        this.vehicles.push(v);
        s.vehicle = v;
      }
    }
  }

  // Hide small dynamic objects that are far from the camera to save draw calls.
  distanceCull() {
    const c = this.camera.position;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.pos.x - c.x, v.pos.z - c.z);
      v.object.visible = d < 260;
      v.model.traverse((o) => { if (o.isMesh) o.castShadow = d < 90; });
    }
    for (const p of this.peds.all) {
      if (p === this.player) continue;
      const d = Math.hypot(p.pos.x - c.x, p.pos.z - c.z);
      p.model.visible = d < 120;
    }
  }

  checkSprayShop() {
    const v = this.player.vehicle, s = this.city.locations.spray;
    if (!v) { this.inSpray = false; return; }
    const inside = Math.hypot(v.pos.x - s.x, v.pos.z - s.z) < s.r;
    if (inside && !this.inSpray) {
      if (this.police.wanted > 0 || v.health < v.maxHealth) {
        if (this.player.money >= 100) {
          this.player.money -= 100;
          v.health = v.maxHealth;
          v.fireTimer = -1;
          this.police.clear();
          this.hud.big('RESPRAYED', 'gold', '-$100 · wanted level cleared', 2.5);
          this.audio.cash();
        } else this.hud.feed('You need $100 for a respray.');
      }
    }
    this.inSpray = inside;
  }

  // ---------- main loop ----------
  loop() {
    let last = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick);
      let dt = (now - last) / 1000;
      last = now;
      dt = Math.min(dt, 1 / 25);
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(tick);
  }

  update(dt) {
    const input = this.input;
    if (this.paused) {
      this.audio.update(dt);
      input.endFrame();
      return;
    }
    this.time += dt;
    this.frame++;
    if (input.hit('KeyM')) this.hud.toggleMap();
    if (input.hit('KeyC')) this.cameraRig.cyclePreset();
    if (input.hit('KeyQ') && this.player.vehicle) this.hud.showRadio(this.audio.nextStation());

    this.sky.update(dt, this.player.worldPos);
    assets.setNight(this.sky.night);
    this.city.update(dt, this.sky.night, this.time);
    this.player.update(dt);
    this.traffic.update(dt);
    collideVehicles(this.vehicles, this);
    this.peds.update(dt);
    this.police.update(dt);
    this.projectiles = this.projectiles.filter((p) => p.update(dt));
    this.pickups.update(dt);
    this.missions.update(dt);
    if (this.frame % 30 === 0) this.updateParked();
    if (this.frame % 10 === 0) this.distanceCull();
    this.checkSprayShop();
    this.effects.update(dt);
    this.cameraRig.update(dt);
    this.hud.update(dt);
    this.audio.update(dt);
    // water shimmer
    this.city.water.position.y = -0.7 + Math.sin(this.time * 0.8) * 0.05;
    input.endFrame();
  }
}

const game = new Game();
window.game = game;
game.load().catch((e) => {
  console.error(e);
  document.getElementById('loading-text').textContent = 'Failed to load: ' + e.message;
});
void RW;
