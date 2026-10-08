import * as THREE from 'three';
import { glowTexture, smokeTexture } from './textures.js';

const VERT = `
attribute float size;
attribute float alpha;
attribute vec3 pcolor;
varying float vAlpha;
varying vec3 vColor;
uniform float scale;
void main() {
  vAlpha = alpha;
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

class ParticlePool {
  constructor(scene, max, texture, additive) {
    this.max = max;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: 400 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.parts = [];
    this.next = 0;
  }

  emit(p) {
    if (this.parts.length < this.max) this.parts.push(p);
    else { this.parts[this.next] = p; this.next = (this.next + 1) % this.max; }
  }

  update(dt) {
    const out = [];
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vel.y += (p.gravity ?? 0) * dt;
      p.vel.multiplyScalar(Math.exp(-(p.drag ?? 0) * dt));
      p.p.addScaledVector(p.vel, dt);
      if (p.floor !== undefined && p.p.y < p.floor) { p.p.y = p.floor; p.vel.set(0, 0, 0); }
      p.s += (p.grow ?? 0) * dt;
      out.push(p);
    }
    this.parts = out;
    this.next = 0;
    const n = out.length;
    for (let i = 0; i < n; i++) {
      const p = out[i];
      this.pos[i * 3] = p.p.x; this.pos[i * 3 + 1] = p.p.y; this.pos[i * 3 + 2] = p.p.z;
      this.col[i * 3] = p.c.r; this.col[i * 3 + 1] = p.c.g; this.col[i * 3 + 2] = p.c.b;
      this.size[i] = p.s;
      const t = p.life / p.maxLife;
      this.alpha[i] = p.a * (p.fadeIn ? Math.min(1, (1 - t) * 6) * t : t);
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'pcolor', 'size', 'alpha']) this.geo.attributes[k].needsUpdate = true;
  }
}

const rnd = (a) => (Math.random() - 0.5) * a;

export class Effects {
  constructor(scene, renderer) {
    this.scene = scene;
    this.add = new ParticlePool(scene, 1500, glowTexture(), true);
    this.norm = new ParticlePool(scene, 1500, smokeTexture(), false);
    this.tracers = [];
    this.lights = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9 });
    // pooled point lights for flashes
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 25, 1.5);
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, peak: 0 });
    }
    this.renderer = renderer;
  }

  setScale(h) {
    this.add.mat.uniforms.scale.value = h * 0.9;
    this.norm.mat.uniforms.scale.value = h * 0.9;
  }

  flash(pos, intensity, life, color = 0xffaa55) {
    let l = this.lights.find((x) => x.life <= 0) || this.lights.reduce((a, b) => (a.life < b.life ? a : b));
    l.light.position.copy(pos);
    l.light.color.setHex(color);
    l.life = l.max = life;
    l.peak = intensity;
  }

  muzzle(pos) {
    this.add.emit({ p: pos.clone(), vel: new THREE.Vector3(), life: 0.06, maxLife: 0.06, s: 1.2, a: 1, c: new THREE.Color(1, 0.8, 0.4) });
    this.flash(pos, 6, 0.06);
  }

  tracer(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const line = new THREE.Line(geo, this.tracerMat.clone());
    this.scene.add(line);
    this.tracers.push({ line, life: 0.07 });
  }

  impact(pos) {
    for (let i = 0; i < 4; i++) this.add.emit({ p: pos.clone(), vel: new THREE.Vector3(rnd(6), Math.random() * 4, rnd(6)), gravity: -15, life: 0.25, maxLife: 0.25, s: 0.25, a: 1, c: new THREE.Color(1, 0.85, 0.5) });
    this.norm.emit({ p: pos.clone(), vel: new THREE.Vector3(0, 0.5, 0), life: 0.6, maxLife: 0.6, s: 0.6, grow: 1.5, a: 0.5, c: new THREE.Color(0.7, 0.68, 0.65) });
  }

  sparks(pos, n = 10) {
    for (let i = 0; i < n; i++) this.add.emit({ p: pos.clone(), vel: new THREE.Vector3(rnd(10), Math.random() * 6, rnd(10)), gravity: -18, life: 0.35 + Math.random() * 0.3, maxLife: 0.6, s: 0.22, a: 1, c: new THREE.Color(1, 0.75, 0.3) });
  }

  blood(pos) {
    for (let i = 0; i < 6; i++) this.norm.emit({ p: pos.clone(), vel: new THREE.Vector3(rnd(3), Math.random() * 2, rnd(3)), gravity: -9, life: 0.5, maxLife: 0.5, s: 0.35, grow: 0.4, a: 0.9, c: new THREE.Color(0.55, 0.02, 0.02), floor: 0.05 });
  }

  smoke(pos, color = 0x777777, size = 1.2) {
    const c = new THREE.Color(color);
    this.norm.emit({ p: pos.clone().add(new THREE.Vector3(rnd(0.4), 0, rnd(0.4))), vel: new THREE.Vector3(rnd(0.6), 1.6 + Math.random(), rnd(0.6)), drag: 0.3, life: 2.2, maxLife: 2.2, s: size, grow: 2.2, a: 0.55, c, fadeIn: true });
  }

  fire(pos) {
    this.add.emit({ p: pos.clone().add(new THREE.Vector3(rnd(0.8), 0, rnd(0.8))), vel: new THREE.Vector3(rnd(0.5), 2.5 + Math.random() * 1.5, rnd(0.5)), life: 0.6, maxLife: 0.6, s: 1.4, grow: -1.2, a: 0.9, c: new THREE.Color(1, 0.45 + Math.random() * 0.25, 0.1) });
    if (Math.random() < 0.3) this.smoke(pos.clone().setY(pos.y + 1.2), 0x222222, 1.5);
  }

  explosion(pos) {
    for (let i = 0; i < 50; i++) {
      const dir = new THREE.Vector3(rnd(2), Math.random(), rnd(2)).normalize();
      this.add.emit({ p: pos.clone(), vel: dir.multiplyScalar(5 + Math.random() * 12), drag: 3, life: 0.5 + Math.random() * 0.5, maxLife: 1, s: 3 + Math.random() * 3, grow: -2, a: 1, c: new THREE.Color(1, 0.5 + Math.random() * 0.3, 0.15) });
    }
    for (let i = 0; i < 30; i++) {
      const dir = new THREE.Vector3(rnd(2), Math.random() * 1.5, rnd(2)).normalize();
      this.norm.emit({ p: pos.clone(), vel: dir.multiplyScalar(3 + Math.random() * 6), drag: 1.2, life: 2 + Math.random() * 2, maxLife: 4, s: 3, grow: 3, a: 0.75, c: new THREE.Color(0.15, 0.14, 0.13), fadeIn: true });
    }
    this.sparks(pos, 30);
    this.flash(pos, 80, 0.5, 0xff8833);
  }

  splash(pos) {
    for (let i = 0; i < 25; i++) this.norm.emit({ p: pos.clone().setY(-0.6), vel: new THREE.Vector3(rnd(5), 3 + Math.random() * 5, rnd(5)), gravity: -15, life: 0.8, maxLife: 0.8, s: 0.8, grow: 1, a: 0.8, c: new THREE.Color(0.85, 0.92, 1) });
  }

  update(dt) {
    this.add.update(dt);
    this.norm.update(dt);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07);
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        t.line.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (const l of this.lights) {
      l.life -= dt;
      l.light.intensity = l.life > 0 ? l.peak * (l.life / l.max) : 0;
    }
  }
}
