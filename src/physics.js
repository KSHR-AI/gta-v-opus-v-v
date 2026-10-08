// Static collision world: axis-aligned boxes and circles in a spatial hash (XZ plane).
const CELL = 16;

export class CollisionWorld {
  constructor() {
    this.cells = new Map();
    this.boxes = [];
    this.stamp = 0;
  }

  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  addBox(minX, minZ, maxX, maxZ, height = 50, kind = 'building') {
    const b = { minX, minZ, maxX, maxZ, height, kind, circle: false, _s: 0 };
    this.insert(b, minX, minZ, maxX, maxZ);
    return b;
  }

  addCircle(x, z, r, height = 6, kind = 'pole') {
    const b = { x, z, r, height, kind, circle: true, _s: 0, minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r };
    this.insert(b, x - r, z - r, x + r, z + r);
    return b;
  }

  insert(b, minX, minZ, maxX, maxZ) {
    this.boxes.push(b);
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = this.key(cx, cz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(b);
      }
    }
  }

  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const s = ++this.stamp;
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const list = this.cells.get(this.key(cx, cz));
        if (!list) continue;
        for (const b of list) {
          if (b._s === s) continue;
          b._s = s;
          out.push(b);
        }
      }
    }
    return out;
  }

  // Pushes a circle out of static geometry. Returns {hit, nx, nz, depth} for the deepest contact.
  resolveCircle(pos, r, y = 0, result = { hit: false, nx: 0, nz: 0, depth: 0, obj: null }) {
    result.hit = false;
    result.depth = 0;
    const list = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, this._tmp || (this._tmp = []));
    for (const b of list) {
      if (y > b.height) continue;
      let nx, nz, depth;
      if (b.circle) {
        const dx = pos.x - b.x, dz = pos.z - b.z;
        const d = Math.hypot(dx, dz);
        const min = r + b.r;
        if (d >= min) continue;
        nx = d > 1e-4 ? dx / d : 1; nz = d > 1e-4 ? dz / d : 0;
        depth = min - d;
      } else {
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        const dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; depth = r - d;
        } else {
          // Center inside box: push out along the shallowest axis.
          const l = pos.x - b.minX, rr = b.maxX - pos.x, t = pos.z - b.minZ, bt = b.maxZ - pos.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) { nx = -1; nz = 0; depth = l + r; }
          else if (m === rr) { nx = 1; nz = 0; depth = rr + r; }
          else if (m === t) { nx = 0; nz = -1; depth = t + r; }
          else { nx = 0; nz = 1; depth = bt + r; }
        }
      }
      pos.x += nx * depth;
      pos.z += nz * depth;
      if (depth > result.depth) {
        result.hit = true; result.nx = nx; result.nz = nz; result.depth = depth; result.obj = b;
      }
    }
    return result;
  }

  // Ray march against boxes (2.5D: checks height). Returns distance or Infinity.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    const ex = ox + dx * maxDist, ez = oz + dz * maxDist;
    const list = this.query(Math.min(ox, ex), Math.min(oz, ez), Math.max(ox, ex), Math.max(oz, ez), this._rtmp || (this._rtmp = []));
    for (const b of list) {
      let t;
      if (b.circle) {
        const fx = ox - b.x, fz = oz - b.z;
        const a = dx * dx + dz * dz;
        if (a < 1e-8) continue;
        const bb = 2 * (fx * dx + fz * dz);
        const c = fx * fx + fz * fz - b.r * b.r;
        const disc = bb * bb - 4 * a * c;
        if (disc < 0) continue;
        t = (-bb - Math.sqrt(disc)) / (2 * a);
        if (t < 0) continue;
        // entered the side above the top: check the top cap
        if (oy + dy * t > b.height && dy < 0) {
          const tt = (b.height - oy) / dy;
          const px = ox + dx * tt - b.x, pz = oz + dz * tt - b.z;
          if (tt < 0 || px * px + pz * pz > b.r * b.r) continue;
          t = tt;
        }
      } else {
        let tmin = 0, tmax = best;
        for (const [o, d, mn, mx] of [[ox, dx, b.minX, b.maxX], [oy, dy, 0, b.height], [oz, dz, b.minZ, b.maxZ]]) {
          if (Math.abs(d) < 1e-8) { if (o < mn || o > mx) { tmin = Infinity; break; } continue; }
          let t1 = (mn - o) / d, t2 = (mx - o) / d;
          if (t1 > t2) [t1, t2] = [t2, t1];
          tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
          if (tmin > tmax) { tmin = Infinity; break; }
        }
        t = tmin;
      }
      if (t < best && oy + dy * t <= b.height + 1e-4 && oy + dy * t >= -1e-4) best = t;
    }
    return best;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d) >= d - 0.01;
  }
}

export function rayCircle(ox, oz, dx, dz, cx, cz, r) {
  const fx = ox - cx, fz = oz - cz;
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (c < 0 ? 0 : Infinity);
}

// Ray vs sphere (3D) for hit-scan weapons. Direction must be normalized.
export function raySphere(o, d, c, r) {
  const fx = o.x - c.x, fy = o.y - c.y, fz = o.z - c.z;
  const b = fx * d.x + fy * d.y + fz * d.z;
  const cc = fx * fx + fy * fy + fz * fz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc < 0 ? 0 : Infinity);
}
