// Geometry helpers for the data scripts. Coordinates are [lat, lon] unless a function says otherwise.
import { proj } from '../../src/projection.js';

const R = Math.PI / 180;
const KX = 111.32 * Math.cos(-21.5 * R), KY = 110.57; // km per degree of lon / lat around Queensland's middle

export function km(a, b) { // great-circle distance between two {lat, lon}
  const dLat = (b.lat - a.lat) * R, dLon = (b.lon - a.lon) * R;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}
export const kmLL = (lat1, lon1, lat2, lon2) => km({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });

// Douglas-Peucker on [lat, lon] points with a tolerance in km (iterative, so huge lines are fine).
export function simplify(pts, tolKm) {
  const n = pts.length; if (n < 3) return pts.slice();
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop(); if (i1 <= i0 + 1) continue;
    const ax = pts[i0][1] * KX, ay = pts[i0][0] * KY, bx = pts[i1][1] * KX, by = pts[i1][0] * KY;
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    let md = -1, mi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const px = pts[i][1] * KX, py = pts[i][0] * KY;
      let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d > md) { md = d; mi = i; }
    }
    if (md > tolKm) { keep[mi] = 1; stack.push([i0, mi], [mi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export const round4 = p => [+p[0].toFixed(4), +p[1].toFixed(4)];

// Area of a closed [lat, lon] ring in km^2 (shoelace on an equirectangular projection).
export function ringAreaKm2(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][1] * KX) * (ring[i][0] * KY) - (ring[i][1] * KX) * (ring[j][0] * KY);
  }
  return Math.abs(a) / 2;
}

// ---- polygons in map units ({x, y} points) ----
export function toWorld(ring) { return ring.map(([lat, lon]) => proj(lat, lon)); }
export function pointInRing(p, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
export function distToRing(p, ring) {
  let m = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const A = ring[i], B = ring[j], dx = B.x - A.x, dy = B.y - A.y, l = dx * dx + dy * dy;
    let t = l ? ((p.x - A.x) * dx + (p.y - A.y) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
    m = Math.min(m, Math.hypot(p.x - A.x - t * dx, p.y - A.y - t * dy));
  }
  return m;
}
