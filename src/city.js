import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assets, InstanceBatcher, LISTS } from './assets.js';
import { CollisionWorld } from './physics.js';
import * as T from './textures.js';

export const NB = 10;          // blocks per axis
export const P = 64;           // block pitch (m)
export const RW = 7;           // road half-width
export const SW = 4;           // sidewalk width
export const HALF = (NB * P) / 2;
export const CURB = 0.15;
export const LAND = { minX: -HALF - 60, maxX: HALF + 60, minZ: -HALF - 50, maxZ: HALF + 120 };
export const WATER_Y = -0.7;
export const roadCoord = (i) => -HALF + i * P;

// Deterministic RNG so the city is identical every load.
let seed = 1337;
export function rand() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

export function districtOf(bi, bj) {
  if (bj === 0 && bi <= 4) return 'industrial';
  if ((bi === 2 && bj === 6) || (bi === 7 && bj === 3)) return 'park';
  if ((bi === 5 && bj === 7) || (bi === 3 && bj === 2)) return 'parking';
  const c = (NB - 1) / 2;
  const d = Math.max(Math.abs(bi - c), Math.abs(bj - c));
  if (d <= 1) return 'downtown';
  if (d <= 2.5) return 'commercial';
  return 'suburban';
}

const ZONE_NAMES = {
  downtown: 'Downtown Solano', commercial: 'Mercado District', suburban: 'Palmetto Heights',
  industrial: 'Harbor Row', park: 'Vista Park', parking: 'Mercado District',
};

const CHUNK = 160;

export class City {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.collision = new CollisionWorld();
    this.blocks = [];
    this.ramps = [];
    this.parkingSpots = [];
    this.lampHeads = [];
    this.locations = {};
    this.batchers = new Map();
    this.minimapShapes = [];
  }

  batcher(x, z) {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let b = this.batchers.get(k);
    if (!b) this.batchers.set(k, (b = new InstanceBatcher()));
    return b;
  }

  // Place an instanced static model. Returns its world AABB (XZ) and height.
  place(name, x, z, rotY = 0, scale = 1, { y = CURB, sy = 1, collide = true, kind = 'building', shrink = 0.4 } = {}) {
    if (!assets.has(name)) return null;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY),
      new THREE.Vector3(scale, scale * sy, scale),
    );
    this.batcher(x, z).add(name, m);
    const box = assets.box(name).clone().applyMatrix4(m);
    if (collide) {
      this.collision.addBox(box.min.x + shrink, box.min.z + shrink, box.max.x - shrink, box.max.z - shrink, box.max.y, kind);
      this.minimapShapes.push({ kind, minX: box.min.x, minZ: box.min.z, maxX: box.max.x, maxZ: box.max.z });
    }
    return box;
  }

  generate() {
    this.materials = {
      road: new THREE.MeshStandardMaterial({ map: T.roadTexture(), roughness: 0.92 }),
      asphalt: new THREE.MeshStandardMaterial({ map: T.asphaltTexture(), roughness: 0.92 }),
      crosswalk: new THREE.MeshStandardMaterial({ map: T.crosswalkTexture(), transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
      sidewalk: new THREE.MeshStandardMaterial({ map: T.sidewalkTexture(), roughness: 0.95 }),
      grass: new THREE.MeshStandardMaterial({ map: T.grassTexture(), roughness: 1 }),
      sand: new THREE.MeshStandardMaterial({ map: T.sandTexture(), roughness: 1 }),
      plaza: new THREE.MeshStandardMaterial({ map: T.plazaTexture(), roughness: 0.95 }),
      parking: new THREE.MeshStandardMaterial({ map: T.parkingTexture(), roughness: 0.95 }),
      concrete: new THREE.MeshStandardMaterial({ map: T.concreteTexture(), roughness: 0.95 }),
      wood: new THREE.MeshStandardMaterial({ map: T.woodTexture(), roughness: 0.9 }),
    };
    this.buildGround();
    this.buildRoads();
    this.buildBlocks();
    this.buildCoast();
    this.buildStreetFurniture();
    this.buildRamps();
    this.buildLandmarks();
    for (const b of this.batchers.values()) b.build(this.group);
    this.buildLampGlows();
  }

  // ---------- geometry helpers ----------
  rectGeo(x0, z0, x1, z1, y, uvScale = 8, uvFn = null) {
    const g = new THREE.BufferGeometry();
    const pos = [x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0];
    const uv = uvFn ? [...uvFn(x0, z0), ...uvFn(x0, z1), ...uvFn(x1, z1), ...uvFn(x1, z0)]
      : [x0 / uvScale, z0 / uvScale, x0 / uvScale, z1 / uvScale, x1 / uvScale, z1 / uvScale, x1 / uvScale, z0 / uvScale];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }

  addMerged(geos, material, { shadow = false } = {}) {
    if (!geos.length) return null;
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    mesh.receiveShadow = true;
    mesh.castShadow = shadow;
    this.group.add(mesh);
    return mesh;
  }

  boxGeo(x0, y0, z0, x1, y1, z1, uvScale = 4) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    const uv = g.attributes.uv;
    const pos = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const px = pos.getX(i) + (x0 + x1) / 2, py = pos.getY(i) + (y0 + y1) / 2, pz = pos.getZ(i) + (z0 + z1) / 2;
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      if (ay > 0.5) uv.setXY(i, px / uvScale, pz / uvScale);
      else if (ax > 0.5) uv.setXY(i, pz / uvScale, py / uvScale);
      else uv.setXY(i, px / uvScale, py / uvScale);
    }
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    return g;
  }

  // ---------- ground & roads ----------
  buildGround() {
    const { minX, maxX, minZ, maxZ } = LAND;
    // Land slab (top is sand; city sits on top)
    const land = new THREE.Mesh(this.boxGeo(minX, -6, minZ, maxX, -0.02, maxZ, 6), this.materials.sand);
    land.receiveShadow = true;
    this.group.add(land);
    // Harbor concrete apron on north side
    this.addMerged([this.rectGeo(minX, minZ, maxX, -HALF - RW, 0.0, 8)], this.materials.concrete);
    this.minimapShapes.push({ kind: 'harbor', minX, minZ, maxX, maxZ: -HALF - RW });

    // Water
    const waterGeo = new THREE.PlaneGeometry(6000, 6000, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x1f6f9a, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.92 });
    const water = new THREE.Mesh(waterGeo, this.waterMat);
    water.position.y = WATER_Y;
    water.receiveShadow = true;
    this.water = water;
    this.group.add(water);
  }

  buildRoads() {
    const roadGeos = [], interGeos = [], crossGeos = [];
    for (let j = 0; j <= NB; j++) {
      const zc = roadCoord(j);
      for (let i = 0; i < NB; i++) {
        const x0 = roadCoord(i) + RW, x1 = roadCoord(i + 1) - RW;
        roadGeos.push(this.rectGeo(x0, zc - RW, x1, zc + RW, 0.0, 0, (x, z) => [(z - (zc - RW)) / (2 * RW), x / 16]));
        crossGeos.push(this.rectGeo(x0, zc - RW, x0 + 4, zc + RW, 0.01, 0, (x, z) => [(z - (zc - RW)) / (2 * RW), (x - x0) / 4]));
        crossGeos.push(this.rectGeo(x1 - 4, zc - RW, x1, zc + RW, 0.01, 0, (x, z) => [(z - (zc - RW)) / (2 * RW), (x - x1 + 4) / 4]));
      }
    }
    for (let i = 0; i <= NB; i++) {
      const xc = roadCoord(i);
      for (let j = 0; j < NB; j++) {
        const z0 = roadCoord(j) + RW, z1 = roadCoord(j + 1) - RW;
        roadGeos.push(this.rectGeo(xc - RW, z0, xc + RW, z1, 0.0, 0, (x, z) => [(x - (xc - RW)) / (2 * RW), z / 16]));
        crossGeos.push(this.rectGeo(xc - RW, z0, xc + RW, z0 + 4, 0.01, 0, (x, z) => [(x - (xc - RW)) / (2 * RW), (z - z0) / 4]));
        crossGeos.push(this.rectGeo(xc - RW, z1 - 4, xc + RW, z1, 0.01, 0, (x, z) => [(x - (xc - RW)) / (2 * RW), (z - z1 + 4) / 4]));
      }
      for (let j = 0; j <= NB; j++) {
        const zc = roadCoord(j);
        interGeos.push(this.rectGeo(xc - RW, zc - RW, xc + RW, zc + RW, 0.0, 8));
      }
    }
    this.addMerged(roadGeos, this.materials.road);
    this.addMerged(interGeos, this.materials.asphalt);
    this.addMerged(crossGeos, this.materials.crosswalk);
  }

  // ---------- city blocks ----------
  buildBlocks() {
    const curbGeos = [];
    const interior = { grass: [], plaza: [], parking: [], concrete: [] };
    for (let bi = 0; bi < NB; bi++) {
      for (let bj = 0; bj < NB; bj++) {
        const x0 = roadCoord(bi) + RW, x1 = roadCoord(bi + 1) - RW;
        const z0 = roadCoord(bj) + RW, z1 = roadCoord(bj + 1) - RW;
        const type = districtOf(bi, bj);
        const block = { bi, bj, type, x0, x1, z0, z1, ix0: x0 + SW, ix1: x1 - SW, iz0: z0 + SW, iz1: z1 - SW };
        this.blocks.push(block);
        curbGeos.push(this.boxGeo(x0, -0.1, z0, x1, CURB, z1, 4));
        const groundType = { downtown: 'plaza', commercial: 'plaza', suburban: 'grass', park: 'grass', parking: 'parking', industrial: 'concrete' }[type];
        interior[groundType].push(this.rectGeo(block.ix0, block.iz0, block.ix1, block.iz1, CURB + 0.005, groundType === 'parking' ? 42 / 5.25 : 8));
        this[`fill_${type}`](block);
      }
    }
    this.addMerged(curbGeos, this.materials.sidewalk);
    for (const k in interior) this.addMerged(interior[k], this.materials[k]);
  }

  facing(side) {
    // rotation that turns model front (+Z) toward the given side
    return { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 }[side];
  }

  fill_downtown(b) {
    const lot = (b.ix1 - b.ix0) / 2;
    for (let a = 0; a < 2; a++) {
      for (let c = 0; c < 2; c++) {
        const x = b.ix0 + lot * (a + 0.5), z = b.iz0 + lot * (c + 0.5);
        const side = rand() < 0.5 ? (c === 0 ? 'n' : 's') : (a === 0 ? 'w' : 'e');
        const box = this.place(pick(LISTS.SKYSCRAPERS), x, z, this.facing(side), 14, { sy: 1 + rand() * 0.9 });
        if (box && rand() < 0.35) this.billboard(x, box.max.y, z, this.facing(side));
      }
    }
  }

  fill_commercial(b) {
    const lot = (b.ix1 - b.ix0) / 3;
    for (let a = 0; a < 3; a++) {
      for (let c = 0; c < 3; c++) {
        const x = b.ix0 + lot * (a + 0.5), z = b.iz0 + lot * (c + 0.5);
        if (a === 1 && c === 1) {
          this.place(pick(LISTS.LOWDETAIL), x, z, 0, 12, { sy: 1.2 });
          continue;
        }
        let side;
        if (c === 0 && a !== 1 && rand() < 0.5) side = a === 0 ? 'w' : 'e';
        else if (c === 2 && a !== 1 && rand() < 0.5) side = a === 0 ? 'w' : 'e';
        else if (c === 0) side = 'n';
        else if (c === 2) side = 's';
        else side = a === 0 ? 'w' : 'e';
        const box = this.place(pick(LISTS.COMMERCIAL), x, z, this.facing(side), 14.5, { sy: 0.9 + rand() * 0.6 });
        if (box && rand() < 0.08) this.billboard(x, box.max.y, z, this.facing(side));
      }
    }
  }

  fill_suburban(b) {
    const w = (b.ix1 - b.ix0) / 3;
    const d = (b.iz1 - b.iz0) / 2;
    for (let a = 0; a < 3; a++) {
      for (let c = 0; c < 2; c++) {
        const x = b.ix0 + w * (a + 0.5);
        const zFront = c === 0 ? b.iz0 : b.iz1;
        const dir = c === 0 ? 1 : -1;
        const z = zFront + dir * (d * 0.55);
        this.place(pick(LISTS.SUBURBAN), x, z, this.facing(c === 0 ? 'n' : 's'), 9.5);
        // backyard tree
        if (rand() < 0.8) {
          const tz = zFront + dir * (d * 0.92);
          this.place(pick(['suburban/tree-large', 'suburban/tree-small', 'nature/tree_oak', 'nature/tree_default']), x + (rand() - 0.5) * 6, tz, rand() * 6, 8 + rand() * 3, { collide: false });
          this.collision.addCircle(x, tz, 0.6, 8, 'tree');
        }
        // front parking spot (driveway)
        if (rand() < 0.22) this.parkingSpots.push({ x: x + w * 0.32, z: zFront + dir * 3.2, rot: c === 0 ? 0 : Math.PI });
      }
    }
    // Fences between yards
    for (let a = 1; a < 3; a++) {
      const x = b.ix0 + w * a;
      for (let c = 0; c < 2; c++) {
        const zc = c === 0 ? b.iz0 + d * 0.75 : b.iz1 - d * 0.75;
        this.place('suburban/fence-1x3', x, zc, Math.PI / 2, 5, { collide: false });
      }
    }
  }

  fill_park(b) {
    const cx = (b.ix0 + b.ix1) / 2, cz = (b.iz0 + b.iz1) / 2;
    // fountain
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.8, 32), this.materials.concrete);
    basin.position.set(cx, CURB + 0.4, cz);
    basin.castShadow = basin.receiveShadow = true;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 0.1, 32), new THREE.MeshStandardMaterial({ color: 0x3aa0d8, roughness: 0.1, metalness: 0.3 }));
    water.position.set(cx, CURB + 0.75, cz);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 3, 12), this.materials.concrete);
    spout.position.set(cx, CURB + 1.5, cz);
    this.group.add(basin, water, spout);
    this.collision.addCircle(cx, cz, 5.4, 1.0, 'fountain');
    this.minimapShapes.push({ kind: 'fountain', minX: cx - 5, minZ: cz - 5, maxX: cx + 5, maxZ: cz + 5 });
    const trees = ['nature/tree_default', 'nature/tree_oak', 'nature/tree_detailed', 'suburban/tree-large'];
    for (let i = 0; i < 18; i++) {
      const x = b.ix0 + 3 + rand() * (b.ix1 - b.ix0 - 6), z = b.iz0 + 3 + rand() * (b.iz1 - b.iz0 - 6);
      if (Math.hypot(x - cx, z - cz) < 10) continue;
      if (Math.abs(x - cx) < 3 || Math.abs(z - cz) < 3) continue;
      this.place(pick(trees), x, z, rand() * 6, 6 + rand() * 3, { collide: false });
      this.collision.addCircle(x, z, 0.5, 8, 'tree');
    }
    for (let i = 0; i < 14; i++) {
      const x = b.ix0 + 2 + rand() * (b.ix1 - b.ix0 - 4), z = b.iz0 + 2 + rand() * (b.iz1 - b.iz0 - 4);
      this.place(pick(['nature/plant_bushLarge', 'nature/flower_redA', 'nature/flower_yellowA', 'nature/plant_bush']), x, z, rand() * 6, 5, { collide: false });
    }
  }

  fill_parking(b) {
    const rows = [b.iz0 + 4, b.iz1 - 4];
    for (const [ri, z] of rows.entries()) {
      for (let x = b.ix0 + 2.6; x < b.ix1 - 2; x += 5.25) {
        if (rand() < 0.35) this.parkingSpots.push({ x, z, rot: ri === 0 ? 0 : Math.PI });
      }
    }
    this.place('roads/light-square-double', (b.ix0 + b.ix1) / 2, (b.iz0 + b.iz1) / 2, 0, 12, { collide: false });
    this.collision.addCircle((b.ix0 + b.ix1) / 2, (b.iz0 + b.iz1) / 2, 0.35, 8, 'pole');
  }

  fill_industrial(b) {
    // Warehouse
    const colors = ['#8a9aa8', '#a7765a', '#6f8a6a', '#9a9a9a'];
    const wx0 = b.ix0 + 1, wx1 = b.ix0 + 26, wz0 = b.iz0 + 2, wz1 = b.iz1 - 2;
    const mat = new THREE.MeshStandardMaterial({ map: T.corrugatedTexture(pick(colors)), roughness: 0.8 });
    const wh = new THREE.Mesh(this.boxGeo(wx0, CURB, wz0, wx1, 11, wz1, 4), mat);
    wh.castShadow = wh.receiveShadow = true;
    const roof = new THREE.Mesh(this.boxGeo(wx0 - 0.5, 11, wz0 - 0.5, wx1 + 0.5, 11.6, wz1 + 0.5, 4), this.materials.concrete);
    roof.castShadow = true;
    const door = new THREE.Mesh(new THREE.PlaneGeometry(8, 7), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    door.position.set(wx1 + 0.02, CURB + 3.5, (wz0 + wz1) / 2);
    door.rotation.y = Math.PI / 2;
    this.group.add(wh, roof, door);
    this.collision.addBox(wx0, wz0, wx1, wz1, 11.6, 'building');
    this.minimapShapes.push({ kind: 'building', minX: wx0, minZ: wz0, maxX: wx1, maxZ: wz1 });
    // Containers
    const ccol = [0xb33a2e, 0x2e6bb3, 0x2f8a4a, 0xd98a1c, 0x6d6d6d];
    for (let k = 0; k < 3; k++) {
      const cx0 = b.ix0 + 29 + k * 4.2;
      for (let s = 0; s < 1 + Math.floor(rand() * 3); s++) {
        const cm = new THREE.MeshStandardMaterial({ map: T.corrugatedTexture('#' + ccol[Math.floor(rand() * ccol.length)].toString(16).padStart(6, '0')), roughness: 0.7 });
        const c = new THREE.Mesh(this.boxGeo(cx0, CURB + s * 2.6, b.iz0 + 6, cx0 + 2.5, CURB + (s + 1) * 2.6, b.iz0 + 18, 2), cm);
        c.castShadow = c.receiveShadow = true;
        this.group.add(c);
      }
      this.collision.addBox(cx0, b.iz0 + 6, cx0 + 2.5, b.iz0 + 18, 8, 'building');
      this.minimapShapes.push({ kind: 'building', minX: cx0, minZ: b.iz0 + 6, maxX: cx0 + 2.5, maxZ: b.iz0 + 18 });
    }
    for (let i = 0; i < 4; i++) this.place('roads/dumpster', b.ix0 + 30 + rand() * 10, b.iz1 - 4 - rand() * 8, rand() * 6, 5, { kind: 'prop', shrink: 0.1 });
    this.parkingSpots.push({ x: b.ix0 + 35, z: b.iz1 - 10, rot: Math.PI / 2, type: 'truck' });
  }

  billboard(x, y, z, rot) {
    const brands = [['SOLANO COLA', '#c62828'], ['PIXEL PIZZA', '#f9a825'], ['VELVET FM 97.3', '#6a1b9a'], ['BYTE BURGER', '#ef6c00'], ['SUNWAVE AIR', '#0277bd'], ['NOVA PHONES', '#212121'], ['KITE ENERGY', '#2e7d32']];
    const [text, bg] = pick(brands);
    const tex = T.signTexture(text, bg);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(14, 3.5), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
    board.position.set(x, y + 3, z);
    board.rotation.y = rot;
    const back = new THREE.Mesh(board.geometry, this.materials.concrete);
    back.position.copy(board.position);
    back.rotation.y = rot + Math.PI;
    this.group.add(back);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2, 0.4), this.materials.concrete);
    post.position.set(x, y + 0.6, z);
    this.group.add(board, post);
    (this.billboards ||= []).push(board.material);
  }

  // ---------- coast ----------
  buildCoast() {
    // Beach palms & parasols on the south shore
    for (let i = 0; i < 70; i++) {
      const x = LAND.minX + 10 + rand() * (LAND.maxX - LAND.minX - 20);
      const z = HALF + RW + 8 + rand() * (LAND.maxZ - HALF - RW - 20);
      if (rand() < 0.6) {
        this.place(pick(['nature/tree_palmTall', 'nature/tree_palmDetailedTall', 'nature/tree_palmShort', 'nature/tree_palmBend']), x, z, rand() * 6, 8 + rand() * 4, { y: 0, collide: false });
        this.collision.addCircle(x, z, 0.5, 10, 'tree');
      } else if (z > HALF + 50) {
        this.place(pick(['commercial/detail-parasol-a', 'commercial/detail-parasol-b']), x, z, rand() * 6, 8, { y: 0, collide: false });
      }
    }
    // Palms on east/west strips
    for (let z = -HALF; z < HALF; z += 22) {
      for (const x of [-HALF - RW - 12, HALF + RW + 12]) {
        this.place('nature/tree_palmTall', x + (rand() - 0.5) * 6, z, rand() * 6, 9, { y: 0, collide: false });
        this.collision.addCircle(x, z, 0.5, 10, 'tree');
      }
    }
    // Harbor piers
    const pierGeos = [];
    for (const px of [-260, -170, -80]) {
      pierGeos.push(this.boxGeo(px - 5, -2, LAND.minZ - 70, px + 5, 0.0, LAND.minZ + 1, 4));
      this.minimapShapes.push({ kind: 'pier', minX: px - 5, minZ: LAND.minZ - 70, maxX: px + 5, maxZ: LAND.minZ });
      this.ramps.push({ minX: px - 5, maxX: px + 5, minZ: LAND.minZ - 70, maxZ: LAND.minZ + 1, flat: 0 });
    }
    this.addMerged(pierGeos, this.materials.wood, { shadow: true });
    // Boardwalk on the beach
    const bw = this.boxGeo(-200, -0.2, HALF + 70, 200, 0.25, HALF + 76, 4);
    this.addMerged([bw], this.materials.wood);
    this.minimapShapes.push({ kind: 'pier', minX: -200, minZ: HALF + 70, maxX: 200, maxZ: HALF + 76 });
  }

  // ---------- street furniture ----------
  buildStreetFurniture() {
    for (const b of this.blocks) {
      const sides = [
        { n: [0, -1], a: [b.x0, b.z0], c: [b.x1, b.z0], len: b.x1 - b.x0 },
        { n: [0, 1], a: [b.x0, b.z1], c: [b.x1, b.z1], len: b.x1 - b.x0 },
        { n: [-1, 0], a: [b.x0, b.z0], c: [b.x0, b.z1], len: b.z1 - b.z0 },
        { n: [1, 0], a: [b.x1, b.z0], c: [b.x1, b.z1], len: b.z1 - b.z0 },
      ];
      for (const s of sides) {
        const rot = s.n[1] === -1 ? 0 : s.n[1] === 1 ? Math.PI : s.n[0] === 1 ? -Math.PI / 2 : Math.PI / 2;
        for (const t of [0.25, 0.75]) {
          const x = s.a[0] + (s.c[0] - s.a[0]) * t - s.n[0] * 0.7;
          const z = s.a[1] + (s.c[1] - s.a[1]) * t - s.n[1] * 0.7;
          if (b.type === 'suburban' || b.type === 'park') {
            if (t === 0.25) {
              this.place('roads/light-curved', x, z, rot, 12, { collide: false });
              this.collision.addCircle(x, z, 0.3, 8, 'pole');
              this.lampHeads.push(new THREE.Vector3(x + s.n[0] * 2.6, 7.6, z + s.n[1] * 2.6));
            } else {
              const tx = x - s.n[0] * 1.2, tz = z - s.n[1] * 1.2;
              this.place(pick(['suburban/tree-large', 'nature/tree_default']), tx, tz, rand() * 6, 7, { collide: false });
              this.collision.addCircle(tx, tz, 0.5, 8, 'tree');
            }
          } else {
            this.place('roads/light-square', x, z, rot, 12, { collide: false });
            this.collision.addCircle(x, z, 0.3, 8, 'pole');
            this.lampHeads.push(new THREE.Vector3(x + s.n[0] * 2.4, 7.3, z + s.n[1] * 2.4));
          }
        }
      }
    }
    // Traffic lights at every intersection corner (interior intersections)
    this.trafficLights = [];
    for (let i = 1; i < NB; i++) {
      for (let j = 1; j < NB; j++) {
        const xc = roadCoord(i), zc = roadCoord(j);
        const corners = [[1, 1, 0], [-1, -1, Math.PI], [1, -1, Math.PI / 2], [-1, 1, -Math.PI / 2]];
        for (const [sx, sz, r] of corners) {
          const x = xc + sx * (RW + 0.8), z = zc + sz * (RW + 0.8);
          this.place('roads/traffic-light', x, z, r, 10, { collide: false });
          this.collision.addCircle(x, z, 0.3, 6, 'pole');
        }
      }
    }
  }

  buildLampGlows() {
    const positions = new Float32Array(this.lampHeads.length * 3);
    this.lampHeads.forEach((p, i) => positions.set([p.x, p.y, p.z], i * 3));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.lampMat = new THREE.PointsMaterial({ size: 4, map: T.glowTexture(), color: 0xffd9a0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.lampPoints = new THREE.Points(geo, this.lampMat);
    this.group.add(this.lampPoints);
    // Light pools on the ground under lamps
    const poolGeo = new THREE.CircleGeometry(5, 16);
    poolGeo.rotateX(-Math.PI / 2);
    this.poolMat = new THREE.MeshBasicMaterial({ map: T.glowTexture(), color: 0xffc070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const pools = new THREE.InstancedMesh(poolGeo, this.poolMat, this.lampHeads.length);
    const m = new THREE.Matrix4();
    this.lampHeads.forEach((p, i) => { m.makeTranslation(p.x, 0.05 + (this.groundHeight(p.x, p.z)), p.z); pools.setMatrixAt(i, m); });
    pools.renderOrder = 1;
    this.group.add(pools);
  }

  // ---------- ramps / stunt jumps ----------
  buildRamps() {
    const defs = [
      { x: 0, z: HALF + 40, along: 'x', dir: 1, len: 14, w: 6, h: 3.2 },
      { x: 120, z: HALF + 40, along: 'x', dir: -1, len: 14, w: 6, h: 3.2 },
      { x: -150, z: HALF + 45, along: 'z', dir: -1, len: 12, w: 6, h: 2.6 },
      { x: roadCoord(7) + P / 2, z: roadCoord(3) + 20, along: 'x', dir: 1, len: 10, w: 5, h: 2.2, y0: CURB },
    ];
    const mat = new THREE.MeshStandardMaterial({ color: 0xd4a537, roughness: 0.6, map: T.concreteTexture('#d4a537') });
    for (const r of defs) {
      const y0 = r.y0 ?? 0;
      const g = new THREE.BufferGeometry();
      // wedge in local space: length along +X from 0..len, rises 0..h, width along Z
      const L = r.len, W = r.w / 2, H = r.h;
      const v = [
        0, 0, -W, L, 0, -W, L, H, -W, // side
        0, 0, W, L, H, W, L, 0, W, // side
        0, 0, -W, 0, 0, W, L, H, W, 0, 0, -W, L, H, W, L, H, -W, // slope
        L, 0, -W, L, 0, W, L, H, W, L, 0, -W, L, H, W, L, H, -W, // back
      ];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xd4a537, roughness: 0.6, side: THREE.DoubleSide }));
      mesh.castShadow = mesh.receiveShadow = true;
      let rot = 0;
      if (r.along === 'x') rot = r.dir > 0 ? 0 : Math.PI;
      else rot = r.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      mesh.rotation.y = rot;
      const sx = r.along === 'x' ? r.x - (r.dir * L) / 2 : r.x;
      const sz = r.along === 'z' ? r.z - (r.dir * L) / 2 : r.z;
      mesh.position.set(sx, y0, sz);
      this.group.add(mesh);
      const ramp = { ...r, y0, sx, sz };
      if (r.along === 'x') Object.assign(ramp, { minX: Math.min(sx, sx + r.dir * L), maxX: Math.max(sx, sx + r.dir * L), minZ: r.z - W, maxZ: r.z + W });
      else Object.assign(ramp, { minZ: Math.min(sz, sz + r.dir * L), maxZ: Math.max(sz, sz + r.dir * L), minX: r.x - W, maxX: r.x + W });
      this.ramps.push(ramp);
      this.minimapShapes.push({ kind: 'ramp', minX: ramp.minX, minZ: ramp.minZ, maxX: ramp.maxX, maxZ: ramp.maxZ });
    }
    void mat;
  }

  // ---------- landmarks ----------
  buildLandmarks() {
    const blockAt = (bi, bj) => this.blocks.find((b) => b.bi === bi && b.bj === bj);
    const sign = (text, bg, x, y, z, rot, w = 12) => {
      const tex = T.signTexture(text, bg);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.4, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.rotation.y = rot;
      this.group.add(m);
    };
    // Hospital (block 6,2): north side
    const h = blockAt(6, 2);
    this.locations.hospital = { x: (h.x0 + h.x1) / 2, z: h.z0 + 1.5, heading: Math.PI, name: 'Solano General' };
    sign('+ HOSPITAL', '#c62828', (h.x0 + h.x1) / 2, 8, h.z0 - 0.5, Math.PI, 14);
    // Police station (block 2,4)
    const ps = blockAt(2, 4);
    this.locations.police = { x: ps.x1 - 1.5, z: (ps.z0 + ps.z1) / 2, heading: Math.PI / 2, name: 'SPD Precinct' };
    sign('POLICE', '#1a3d8f', ps.x1 + 0.5, 8, (ps.z0 + ps.z1) / 2, Math.PI / 2, 12);
    this.policeSpots = [{ x: ps.x1 + RW - 2.5, z: ps.z0 + 8, rot: Math.PI }, { x: ps.x1 + RW - 2.5, z: ps.z1 - 8, rot: 0 }];
    // Safehouse (block 1,7) - suburban
    const sh = blockAt(1, 7);
    this.locations.safehouse = { x: sh.x0 + 9, z: sh.z0 + 1.5, heading: Math.PI, name: 'Safehouse' };
    // Spray shop on parking block (5,7)
    const sp = blockAt(5, 7);
    this.locations.spray = { x: (sp.ix0 + sp.ix1) / 2, z: (sp.iz0 + sp.iz1) / 2, r: 6, name: 'Spray Shop' };
    sign('RESPRAY $100', '#00897b', (sp.ix0 + sp.ix1) / 2, 6, sp.z0 + 0.5, 0, 12);
    const pad = new THREE.Mesh(new THREE.CircleGeometry(6, 32), new THREE.MeshBasicMaterial({ color: 0x00e5b0, transparent: true, opacity: 0.35, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(this.locations.spray.x, CURB + 0.03, this.locations.spray.z);
    this.group.add(pad);
    // remove parking spots that overlap the spray pad
    this.parkingSpots = this.parkingSpots.filter((s) => Math.hypot(s.x - this.locations.spray.x, s.z - this.locations.spray.z) > 9);
  }

  // ---------- queries ----------
  blockIndexAt(x, z) {
    const bi = Math.floor((x + HALF) / P), bj = Math.floor((z + HALF) / P);
    if (bi < 0 || bj < 0 || bi >= NB || bj >= NB) return null;
    const fx = x - roadCoord(bi), fz = z - roadCoord(bj);
    if (fx > RW && fx < P - RW && fz > RW && fz < P - RW) return { bi, bj };
    return null;
  }

  groundHeight(x, z) {
    for (const r of this.ramps) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      if (r.flat !== undefined) return r.flat;
      const t = r.along === 'x' ? (x - r.sx) * r.dir / r.len : (z - r.sz) * r.dir / r.len;
      return r.y0 + Math.max(0, Math.min(1, t)) * r.h;
    }
    if (x < LAND.minX || x > LAND.maxX || z < LAND.minZ || z > LAND.maxZ) return -5;
    if (this.blockIndexAt(x, z)) return CURB;
    if (z > HALF + 70 && z < HALF + 76 && x > -200 && x < 200) return 0.25;
    return 0;
  }

  isWater(x, z) {
    if (x >= LAND.minX && x <= LAND.maxX && z >= LAND.minZ && z <= LAND.maxZ) return false;
    for (const r of this.ramps) if (r.flat !== undefined && x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return false;
    return true;
  }

  zoneName(x, z) {
    if (z > HALF + RW) return 'Sunset Beach';
    if (z < -HALF - RW) return 'Port Docks';
    if (x < -HALF - RW || x > HALF + RW) return 'Coastal Drive';
    const bi = Math.max(0, Math.min(NB - 1, Math.floor((x + HALF) / P)));
    const bj = Math.max(0, Math.min(NB - 1, Math.floor((z + HALF) / P)));
    return ZONE_NAMES[districtOf(bi, bj)];
  }

  // Nearest road node (intersection index) to a point.
  nearestNode(x, z) {
    const i = Math.max(0, Math.min(NB, Math.round((x + HALF) / P)));
    const j = Math.max(0, Math.min(NB, Math.round((z + HALF) / P)));
    return { i, j };
  }

  randomSidewalkPoint() {
    const b = this.blocks[Math.floor(Math.random() * this.blocks.length)];
    return { block: b, ...this.sidewalkLoopPoint(b, Math.random()) };
  }

  // Point along the sidewalk loop of a block (t in 0..1, clockwise from NW corner)
  sidewalkLoopPoint(b, t) {
    const x0 = b.x0 + SW / 2, x1 = b.x1 - SW / 2, z0 = b.z0 + SW / 2, z1 = b.z1 - SW / 2;
    const w = x1 - x0, h = z1 - z0, per = 2 * (w + h);
    let d = ((t % 1) + 1) % 1 * per;
    if (d < w) return { x: x0 + d, z: z0 };
    d -= w;
    if (d < h) return { x: x1, z: z0 + d };
    d -= h;
    if (d < w) return { x: x1 - d, z: z1 };
    d -= w;
    return { x: x0, z: z1 - d };
  }

  update(dt, night, time) {
    this.lampMat.opacity = night;
    this.poolMat.opacity = night * 0.45;
    if (this.billboards) for (const m of this.billboards) m.emissiveIntensity = 0.25 + night * 0.9;
    void dt; void time;
  }
}
