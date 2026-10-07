import * as THREE from 'three';

const DIST_PRESETS = [{ foot: 4.6, car: 8.5 }, { foot: 6.5, car: 12 }, { foot: 3.2, car: 6 }];

export class CameraRig {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.yaw = Math.PI;
    this.pitch = 0.25;
    this.currentDist = 4.6;
    this.preset = 0;
    this.idle = 0;
    this.shake = 0;
    this.target = new THREE.Vector3();
    this.shoulder = 0;
    this.fov = 65;
  }

  cyclePreset() { this.preset = (this.preset + 1) % DIST_PRESETS.length; }

  update(dt) {
    const g = this.game, input = g.input, pl = g.player, v = pl.vehicle;
    const sens = 0.0022;
    const mdx = input.mouse.dx, mdy = input.mouse.dy;
    this.yaw -= mdx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch + mdy * sens, -0.5, 1.25);
    if (Math.abs(mdx) + Math.abs(mdy) > 0) this.idle = 0; else this.idle += dt;

    const preset = DIST_PRESETS[this.preset];
    let dist, height;
    const t = new THREE.Vector3();
    if (v) {
      const size = v.halfL / 2.3;
      dist = preset.car * size;
      height = v.height * 0.9 + 0.6;
      t.set(v.pos.x, v.pos.y + height, v.pos.z);
      if (this.idle > 1.0 && v.speed > 2) {
        // auto-follow behind the car
        const back = v.forwardSpeed < -1 ? v.heading : v.heading + Math.PI;
        let d = back - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 2.5);
        this.pitch += (0.22 - this.pitch) * Math.min(1, dt * 1.5);
      }
    } else {
      const aiming = pl.aiming;
      dist = aiming ? 2.3 : preset.foot;
      height = pl.swimming ? 0.2 : 1.55;
      t.set(pl.pos.x, (pl.swimming ? pl.pos.y + 1 : pl.pos.y) + height, pl.pos.z);
      this.shoulder += ((aiming ? 0.75 : 0.0) - this.shoulder) * Math.min(1, dt * 10);
    }
    // smooth target to avoid jitter
    if (this.target.lengthSq() === 0 || this.target.distanceTo(t) > 20) this.target.copy(t);
    else this.target.lerp(t, Math.min(1, dt * (v ? 18 : 25)));
    this.currentDist += (dist - this.currentDist) * Math.min(1, dt * 6);

    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const look = this.target.clone().addScaledVector(right, this.shoulder);
    // camera collision with buildings
    const cw = g.city.collision;
    let d = this.currentDist;
    const hit = cw.raycast(look.x, look.y, look.z, dir.x, dir.y, dir.z, d + 0.3);
    if (hit < d + 0.3) d = Math.max(0.6, hit - 0.3);
    const pos = look.clone().addScaledVector(dir, d);
    const gh = g.city.groundHeight(pos.x, pos.z);
    if (pos.y < gh + 0.3) pos.y = gh + 0.3;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.5);
      pos.x += (Math.random() - 0.5) * this.shake;
      pos.y += (Math.random() - 0.5) * this.shake;
      pos.z += (Math.random() - 0.5) * this.shake;
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(look);
    const targetFov = v ? 62 + Math.min(16, v.speed * 0.3) : pl.aiming ? 55 : 65;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.05) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }
}
