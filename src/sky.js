import * as THREE from 'three';

const KEYS = [
  // hour, zenith, horizon, sun color, sun intensity, ambient intensity
  [0, 0x050812, 0x121a33, 0x8090c0, 0.0, 0.25],
  [5, 0x0b1430, 0x3a2f55, 0x8090c0, 0.0, 0.3],
  [6.5, 0x3a5a9a, 0xffa070, 0xffb070, 1.0, 0.55],
  [8, 0x3f7fd0, 0xbfdcf5, 0xfff0d8, 2.4, 0.85],
  [12, 0x2f74d6, 0xb8daf7, 0xffffff, 3.0, 1.0],
  [17, 0x3a6fc0, 0xd9c6a8, 0xffe0b0, 2.4, 0.85],
  [19, 0x2a3a78, 0xff7a45, 0xff8040, 1.2, 0.55],
  [20.5, 0x0e1438, 0x4a2a5a, 0x8090c0, 0.0, 0.32],
  [24, 0x050812, 0x121a33, 0x8090c0, 0.0, 0.25],
];

const c1 = new THREE.Color(), c2 = new THREE.Color();

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.hour = 16.5;
    this.minutesPerSecond = 1.5; // one in-game day = 16 real minutes
    this.uniforms = {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color() },
      night: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform float night;
        varying vec3 vDir;
        float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(horizon, zenith, pow(max(h,0.0), 0.55));
          if (h < 0.0) col = mix(horizon, horizon*0.6, -h*4.0);
          float s = max(dot(d, sunDir), 0.0);
          col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35);
          // moon opposite the sun
          float m = max(dot(d, -sunDir), 0.0);
          col += vec3(0.8,0.85,1.0) * pow(m, 1500.0) * 3.0 * night;
          // stars
          vec3 g = floor(d * 220.0);
          float st = step(0.9975, hash(g)) * night * smoothstep(0.0, 0.3, d.y);
          col += vec3(st);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = -90; s.right = 90; s.top = 90; s.bottom = -90; s.near = 1; s.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a4a3a, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xbfd8ff, 150, 700);
    this.night = 0;
    this.sunDir = new THREE.Vector3();
  }

  sample(hour) {
    let a = KEYS[0], b = KEYS[1];
    for (let i = 0; i < KEYS.length - 1; i++) if (hour >= KEYS[i][0] && hour <= KEYS[i + 1][0]) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    const t = (hour - a[0]) / (b[0] - a[0] || 1);
    return { a, b, t };
  }

  update(dt, focus) {
    this.hour = (this.hour + (dt * this.minutesPerSecond) / 60) % 24;
    const { a, b, t } = this.sample(this.hour);
    const zen = c1.setHex(a[1]).lerp(c2.setHex(b[1]), t).clone();
    const hor = c1.setHex(a[2]).lerp(c2.setHex(b[2]), t).clone();
    const sunCol = c1.setHex(a[3]).lerp(c2.setHex(b[3]), t).clone();
    const sunI = a[4] + (b[4] - a[4]) * t;
    const amb = a[5] + (b[5] - a[5]) * t;
    this.uniforms.zenith.value.copy(zen);
    this.uniforms.horizon.value.copy(hor);
    this.uniforms.sunColor.value.copy(sunCol);
    // sun path: rises east (+x), sets west
    const ang = ((this.hour - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), -0.35).normalize();
    this.uniforms.sunDir.value.copy(this.sunDir);
    this.night = THREE.MathUtils.clamp(1 - sunI / 1.0, 0, 1);
    this.uniforms.night.value = this.night;

    // directional light: sun by day, moon at night
    const lightDir = this.sunDir.y > 0.05 ? this.sunDir : new THREE.Vector3(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z);
    this.sun.position.copy(focus).addScaledVector(lightDir, 250);
    this.sun.target.position.copy(focus);
    this.sun.color.copy(this.sunDir.y > 0.05 ? sunCol : new THREE.Color(0x8fa6e0));
    this.sun.intensity = this.sunDir.y > 0.05 ? sunI : 0.35;
    // snap shadow camera to texels to avoid shimmering
    this.hemi.intensity = amb * 1.1;
    this.hemi.color.copy(zen).lerp(new THREE.Color(0xffffff), 0.5);
    this.hemi.groundColor.setHex(0x4a3f35).multiplyScalar(0.5 + amb * 0.5);
    this.scene.fog.color.copy(hor);
    this.dome.position.copy(focus);
  }

  get clock() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
