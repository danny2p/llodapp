// Feature-Local Frame (FLF) — the shared geometric convention used by both
// the Scene overlay renderers and the Python voxel carver.
//
//   origin = first tagged point (in aligned gun world coords, mm)
//   +X     = toward holster entrance (muzzle side per CLAUDE.md)
//   +Y     = up (away from grip)
//   +Z     = gun's left side
//
// For a single-point feature, FLF is a pure translation (R = identity): the
// world axes and FLF axes coincide, and the tagged point is the origin.
//
// For multi-point features (e.g., start/end), FLF origin is still points[0]
// but +X is oriented toward points[1]. Renderers and carvers apply R before
// placing geometry so the feature follows the tagged direction.

export type Vec3 = [number, number, number];
export type Mat3 = [Vec3, Vec3, Vec3];

export const IDENTITY_MAT3: Mat3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
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

// Rotation matrix around local +Z, applied in FLF (same for world if R = identity).
export function rotZMat3(rad: number): Mat3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

// Derive the FLF from a feature's tagged points. Returns null if the first
// point (anchor) is not tagged. For >=2 points, +X orients toward points[1]
// projected onto the XZ plane (preserves +Y as up).
export function flfFromPoints(points: (Vec3 | null)[]): FLF | null {
  const p0 = points[0];
  if (!p0) return null;
  const p1 = points[1];
  if (!p1) return { origin: p0, R: IDENTITY_MAT3 };

  // Project p1-p0 onto XZ plane, use as +X direction in FLF.
  const dx = p1[0] - p0[0];
  const dz = p1[2] - p0[2];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return { origin: p0, R: IDENTITY_MAT3 };
  const xh: Vec3 = [dx / len, 0, dz / len];
  const yh: Vec3 = [0, 1, 0];
  // +Z = +X × +Y
  const zh: Vec3 = [
    xh[1] * yh[2] - xh[2] * yh[1],
    xh[2] * yh[0] - xh[0] * yh[2],
    xh[0] * yh[1] - xh[1] * yh[0],
  ];
  // Columns are basis vectors; R maps FLF -> world.
  const R: Mat3 = [
    [xh[0], yh[0], zh[0]],
    [xh[1], yh[1], zh[1]],
    [xh[2], yh[2], zh[2]],
  ];
  return { origin: p0, R };
}
