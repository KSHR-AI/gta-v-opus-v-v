import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const BASE = import.meta.env.BASE_URL + 'assets/';

export const CAR_TYPES = {
  sedan: { file: 'cars/sedan', name: 'Solano Sedan', speed: 42, accel: 15, handling: 1.0, mass: 1.0 },
  'sedan-sports': { file: 'cars/sedan-sports', name: 'Vireo GT', speed: 54, accel: 21, handling: 1.15, mass: 0.95 },
  'hatchback-sports': { file: 'cars/hatchback-sports', name: 'Pico RS', speed: 50, accel: 20, handling: 1.25, mass: 0.85 },
  suv: { file: 'cars/suv', name: 'Ranger XL', speed: 40, accel: 14, handling: 0.9, mass: 1.3 },
  'suv-luxury': { file: 'cars/suv-luxury', name: 'Monarch LX', speed: 46, accel: 16, handling: 0.95, mass: 1.3 },
  taxi: { file: 'cars/taxi', name: 'Cab', speed: 42, accel: 15, handling: 1.0, mass: 1.0 },
  police: { file: 'cars/police', name: 'Police Cruiser', speed: 52, accel: 20, handling: 1.15, mass: 1.15, police: true },
  van: { file: 'cars/van', name: 'Porter Van', speed: 34, accel: 11, handling: 0.8, mass: 1.5 },
  truck: { file: 'cars/truck', name: 'Hauler', speed: 32, accel: 10, handling: 0.7, mass: 2.0 },
  delivery: { file: 'cars/delivery', name: 'Courier', speed: 34, accel: 11, handling: 0.8, mass: 1.6 },
  ambulance: { file: 'cars/ambulance', name: 'Ambulance', speed: 44, accel: 15, handling: 0.9, mass: 1.6 },
  firetruck: { file: 'cars/firetruck', name: 'Fire Engine', speed: 36, accel: 11, handling: 0.7, mass: 2.4 },
  'garbage-truck': { file: 'cars/garbage-truck', name: 'Trashmaster', speed: 28, accel: 9, handling: 0.6, mass: 2.5 },
  race: { file: 'cars/race', name: 'Fulmine R', speed: 66, accel: 27, handling: 1.4, mass: 0.8 },
  'race-future': { file: 'cars/race-future', name: 'Zephyr X', speed: 72, accel: 30, handling: 1.45, mass: 0.8 },
};

export const CIVILIAN_CARS = ['sedan', 'sedan', 'sedan', 'taxi', 'taxi', 'suv', 'suv-luxury', 'hatchback-sports', 'van', 'delivery', 'truck', 'sedan-sports', 'garbage-truck'];

const COMMERCIAL = 'abcdefghijklmn'.split('').map((c) => `commercial/building-${c}`);
const SKYSCRAPERS = 'abcde'.split('').map((c) => `commercial/building-skyscraper-${c}`);
const LOWDETAIL = ['low-detail-building-wide-a', 'low-detail-building-wide-b', ...'abcdefghijklmn'.split('').map((c) => `low-detail-building-${c}`)].map((n) => `commercial/${n}`);
const SUBURBAN = 'abcdefghijklmnopqrstu'.split('').map((c) => `suburban/building-type-${c}`);
const CHARACTERS = 'abcdefghijklmnopqr'.split('').map((c) => `characters/character-${c}`);
const PROPS = [
  'roads/light-square', 'roads/light-square-double', 'roads/light-curved', 'roads/traffic-light', 'roads/dumpster', 'roads/construction-cone',
  'roads/construction-barrier', 'roads/electricity-pole', 'suburban/tree-large', 'suburban/tree-small', 'suburban/planter', 'suburban/fence-1x3',
  'suburban/fence-low', 'commercial/detail-awning-wide', 'commercial/detail-parasol-a', 'commercial/detail-parasol-b',
  'nature/tree_palmTall', 'nature/tree_palmDetailedTall', 'nature/tree_palmShort', 'nature/tree_palmBend', 'nature/tree_default', 'nature/tree_oak',
  'nature/tree_detailed', 'nature/plant_bushLarge', 'nature/plant_bush', 'nature/rock_largeA', 'nature/rock_largeC', 'nature/flower_redA',
  'nature/flower_yellowA', 'cars/cone', 'cars/box',
];

export const LISTS = { COMMERCIAL, SKYSCRAPERS, LOWDETAIL, SUBURBAN, CHARACTERS };

class Assets {
  constructor() {
    this.models = new Map();
    this.loader = new GLTFLoader();
    this.windowGlow = new Map();
  }

  async loadAll(onProgress) {
    const files = [...Object.values(CAR_TYPES).map((c) => c.file), ...COMMERCIAL, ...SKYSCRAPERS, ...LOWDETAIL, ...SUBURBAN, ...CHARACTERS, ...PROPS];
    const unique = [...new Set(files)];
    let done = 0;
    const queue = [...unique];
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        try {
          const gltf = await this.loader.loadAsync(`${BASE}${f}.glb`);
          this.prepare(f, gltf);
          this.models.set(f, gltf);
        } catch (e) {
          console.warn('Failed to load', f, e);
        }
        done++;
        onProgress?.(done / unique.length, f);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  }

  prepare(name, gltf) {
    const isCharacter = name.startsWith('characters/');
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = !isCharacter;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m.map) {
            m.map.colorSpace = THREE.SRGBColorSpace;
            m.map.anisotropy = 4;
          }
          m.metalness = 0;
          m.roughness = 0.85;
          if (!isCharacter && (name.startsWith('commercial/') || name.startsWith('suburban/'))) this.addWindowGlow(m);
        }
      }
    });
  }

  // Generates an emissive mask from the palette texture: bright bluish swatches (glass) glow at night.
  addWindowGlow(mat) {
    if (!mat.map || !mat.map.image) return;
    const img = mat.map.image;
    let glow = this.windowGlow.get(img);
    if (!glow) {
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const r = p[i], g = p[i + 1], b = p[i + 2];
        const glass = b > 170 && b > r + 25 && g > 120 && r > 70;
        if (glass) { p[i] = 255; p[i + 1] = 196; p[i + 2] = 110; } else { p[i] = p[i + 1] = p[i + 2] = 0; }
        p[i + 3] = 255;
      }
      ctx.putImageData(d, 0, 0);
      glow = new THREE.CanvasTexture(c);
      glow.colorSpace = THREE.SRGBColorSpace;
      glow.flipY = mat.map.flipY;
      this.windowGlow.set(img, glow);
    }
    mat.emissiveMap = glow;
    mat.emissive = new THREE.Color(1, 1, 1);
    mat.emissiveIntensity = 0;
    if (!this.glowMaterials) this.glowMaterials = new Set();
    this.glowMaterials.add(mat);
  }

  setNight(amount) {
    if (!this.glowMaterials) return;
    for (const m of this.glowMaterials) m.emissiveIntensity = amount * 0.9;
  }

  get(name) {
    const g = this.models.get(name);
    if (!g) throw new Error('Missing model ' + name);
    return g;
  }

  has(name) { return this.models.has(name); }

  clone(name) {
    return this.get(name).scene.clone(true);
  }

  cloneCharacter(name) {
    const gltf = this.get(name);
    const obj = SkeletonUtils.clone(gltf.scene);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    return { object: obj, animations: gltf.animations };
  }

  // Returns parts [{geometry, material}] baked relative to model root — used for instancing.
  parts(name) {
    const gltf = this.get(name);
    if (gltf._parts) return gltf._parts;
    const parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        const geo = o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld);
        parts.push({ geometry: geo, material: o.material });
      }
    });
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    gltf._parts = parts;
    gltf._box = box;
    return parts;
  }

  box(name) {
    this.parts(name);
    return this.get(name)._box;
  }
}

export const assets = new Assets();

// Collects static placements and turns them into InstancedMeshes (one draw call per model part).
export class InstanceBatcher {
  constructor() {
    this.placements = new Map();
  }

  add(name, matrix) {
    if (!assets.has(name)) return;
    let list = this.placements.get(name);
    if (!list) this.placements.set(name, (list = []));
    list.push(matrix.clone());
  }

  build(parent, { castShadow = true } = {}) {
    for (const [name, matrices] of this.placements) {
      for (const part of assets.parts(name)) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, matrices.length);
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        parent.add(mesh);
      }
    }
  }
}
