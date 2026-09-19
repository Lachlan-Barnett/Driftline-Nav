// Map projection shared by the app and the data scripts: latitude/longitude -> map units.
// WORLD_W/WORLD_H keep the true aspect ratio at Queensland's latitudes (1 degree of longitude is
// ~0.93 the length of 1 degree of latitude here), and KM_PER_UNIT follows from that scale.
export const LON_W = 137, LON_E = 154, LAT_N = -10, LAT_S = -29.5;
export const WORLD_W = 970, WORLD_H = 1200, KM_PER_UNIT = 1.8;

export function proj(lat, lon) {
  return { x: (lon - LON_W) / (LON_E - LON_W) * WORLD_W, y: (lat - LAT_N) / (LAT_S - LAT_N) * WORLD_H };
}
export function unproj(x, y) {
  return { lat: LAT_N + y / WORLD_H * (LAT_S - LAT_N), lon: LON_W + x / WORLD_W * (LON_E - LON_W) };
}
