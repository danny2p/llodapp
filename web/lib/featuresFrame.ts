// Feature-Local Frame (FLF) — the shared geometric convention used by both
// the Scene overlay renderers and the Python voxel carver.
//
// HAS (Holster-Aligned System) rules:
//   World +X = muzzle, World -X = entrance, World +Y = up.
//   Features are conceptually designed to extend "backward" (toward the
//   entrance) from their tagged anchor — so the local frame's +X axis
//   points toward the entrance (world -X).
//
//   origin = first tagged point (in HAS world coords, mm)
//   +X (local) = toward holster entrance  (world -X)
//   +Y (local) = up                        (world +Y)
//   +Z (local) = determined by right-hand rule (world -Z for a single point)
//
// For a single-point feature, FLF is the identity rotated 180° around Y:
// local +X -> world -X, local +Y -> world +Y, local +Z -> world -Z.
//
// For multi-point features (e.g., start/end), origin = points[0] and the
// local +X axis points from points[0] toward points[1] in 3D. World +Y is
// projected orthogonal to keep the frame "upright".

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export const IDENTITY_MAT3: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

// HAS default: rotation of 180° around world +Y axis (columns are basis
// vectors expressed in world coords).
export const HAS_DEFAULT_R: Mat3 = [
  [-1, 0, 0],
  [0, 1, 0],
  [0, 0, -1],
];

export type FLF = {
  origin: Vec3;
  R: Mat3;
};

export function flfToWorld(flf: FLF, local: Vec3): Vec3 {
  const [lx, ly, lz] = local;
  const [r0, r1, r2] = flf.R;
  return [
    flf.origin[0] + r0[0] * lx + r0[1] * ly + r0[2] * lz,
    flf.origin[1] + r1[0] * lx + r1[1] * ly + r1[2] * lz,
    flf.origin[2] + r2[0] * lx + r2[1] * ly + r2[2] * lz,
  ];
}

// Rotation matrix around local +Z, applied inside the FLF.
export function rotZMat3(rad: number): Mat3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-6) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// Derive the FLF from a feature's tagged points. Returns null if the first
// point (anchor) is missing.
export function flfFromPoints(points: (Vec3 | null)[]): FLF | null {
  const p0 = points[0];
  if (!p0) return null;
  const p1 = points[1];
  if (!p1) return { origin: p0, R: HAS_DEFAULT_R };

  // Multi-point: local +X points from p0 to p1 in 3D.
  const xh = normalize([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
  if (xh[0] === 0 && xh[1] === 0 && xh[2] === 0) {
    return { origin: p0, R: HAS_DEFAULT_R };
  }

  // Project world up (+Y) orthogonal to xh to get +Y local.
  const up: Vec3 = [0, 1, 0];
  const xDotUp = xh[0] * up[0] + xh[1] * up[1] + xh[2] * up[2];
  let yh: Vec3 = [
    up[0] - xh[0] * xDotUp,
    up[1] - xh[1] * xDotUp,
    up[2] - xh[2] * xDotUp,
  ];
  const yLen = Math.hypot(yh[0], yh[1], yh[2]);
  if (yLen < 1e-6) {
    // xh is parallel to world up (degenerate); pick world +Z as fallback up.
    yh = [0, 0, 1];
  } else {
    yh = [yh[0] / yLen, yh[1] / yLen, yh[2] / yLen];
  }
  const zh = cross(xh, yh);
  // R columns are basis vectors expressed in world coords: R @ local = world.
  const R: Mat3 = [
    [xh[0], yh[0], zh[0]],
    [xh[1], yh[1], zh[1]],
    [xh[2], yh[2], zh[2]],
  ];
  return { origin: p0, R };
}
