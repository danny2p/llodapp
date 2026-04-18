"""The clay-imprint approach: swept-volume cavity from the scan.

Concept: press the firearm muzzle-first into a block of clay to a chosen
depth. The cavity it carves out = the holster cavity. Kydex thermoformed
over this shape becomes the holster.

Key property: as the gun slides in, a small surface bump at local X=50mm
sweeps through clay depths [0, insertion_depth - 50] while other parts of
the gun also pass through those same depths. The cavity cross-section at
any depth is the UNION of all gun cross-sections that pass through it. A
small bump at one X position only affects the cavity if, at its YZ
location, no larger cross-section from another X exists. Fine surface
noise therefore vanishes; only features that are the widest thing at their
YZ location survive.

Pipeline (no RANSAC, no plane snap, no smoothing):
  1. Load scan, auto-detect long axis and muzzle end.
  2. Voxelize at chosen pitch.
  3. Orient so muzzle is at local X=0, gun extends in +X.
  4. Compute cumulative YZ projection along X (cum[i] = OR of gun slices [0..i]).
  5. Cavity at clay depth x (x in [0, insertion_depth-1]) = cum[insertion_depth-1-x].
  6. Marching-cubes the cavity voxel grid -> STL.

Output: the solid positive plug (the "clay imprint" made solid), which is
what kydex is thermoformed over.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh
from rich.console import Console

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
INPUT_STL = PROJECT_DIR / "sig.stl"

VOXEL_PITCH_MM = 0.5
# If None, insertion_depth_mm defaults to the full gun length along its long axis.
INSERTION_DEPTH_MM: float | None = 130.0


def voxelize_filled(mesh: trimesh.Trimesh, pitch: float) -> tuple[np.ndarray, np.ndarray]:
    vox = mesh.voxelized(pitch=pitch).fill()
    occupancy = vox.matrix.copy()
    origin = np.asarray(vox.transform)[:3, 3].astype(float)
    return occupancy, origin


def detect_long_axis(shape_xyz: tuple[int, int, int]) -> int:
    """Return the axis (0, 1, or 2) with the largest voxel extent."""
    return int(np.argmax(shape_xyz))


def detect_muzzle_direction(occupancy: np.ndarray, long_axis: int) -> int:
    """Return +1 if the muzzle (narrower end) is at the low index along
    long_axis, else -1.

    Heuristic: compare the mean cross-section area in the first 10% vs. the
    last 10% along the long axis. The smaller end is assumed to be the muzzle.
    """
    moved = np.moveaxis(occupancy, long_axis, 0)
    n = moved.shape[0]
    head = moved[: max(1, n // 10)].sum(axis=(1, 2)).mean()
    tail = moved[-max(1, n // 10):].sum(axis=(1, 2)).mean()
    return 1 if head <= tail else -1


def sweep_cavity(gun_vox: np.ndarray, insertion_depth_vox: int) -> np.ndarray:
    """Return a 3D boolean array (insertion_depth_vox, Y, Z) representing the
    swept cavity with clay surface at index 0 and clay bottom at index
    insertion_depth_vox-1.

    Assumption: gun_vox[i] is the YZ slice at gun local X = i, with muzzle
    at i=0.
    """
    gun_len = gun_vox.shape[0]
    yz = gun_vox.shape[1:]

    # Cumulative OR of gun slices along local X, up to min(gun_len, insertion_depth_vox).
    limit = min(gun_len, insertion_depth_vox)
    cum = np.zeros((limit,) + yz, dtype=bool)
    running = np.zeros(yz, dtype=bool)
    for i in range(limit):
        running = running | gun_vox[i]
        cum[i] = running

    # cavity[x] = cum[insertion_depth_vox - 1 - x], clamped to [0, limit-1].
    cavity = np.zeros((insertion_depth_vox,) + yz, dtype=bool)
    for x in range(insertion_depth_vox):
        idx = insertion_depth_vox - 1 - x
        if idx >= limit:
            # Insertion depth exceeds gun length. For these shallow clay depths,
            # the cavity is still the full cumulative union up to the gun's end.
            cavity[x] = cum[limit - 1]
        else:
            cavity[x] = cum[idx]
    return cavity


def cavity_to_mesh(cavity: np.ndarray, origin: np.ndarray, pitch: float, long_axis: int, muzzle_sign: int) -> trimesh.Trimesh:
    """Marching-cubes the cavity occupancy and return a mesh in world coords.

    cavity axis 0 is the clay-depth direction; axes 1, 2 are the perpendicular
    YZ. We need to rotate these back so they align with the world axes the
    original scan used (long_axis, with muzzle_sign determining direction).
    """
    padded = np.pad(cavity, 1, mode="constant", constant_values=False)
    from skimage import measure
    verts, faces, _, _ = measure.marching_cubes(padded.astype(np.float32), level=0.5)
    verts = (verts - 1) * pitch
    # verts are now in the cavity's local coord system:
    #   axis 0 = depth into clay (0=surface, N=deep)
    #   axes 1,2 = the two transverse axes (in the original scan's order)
    # Map back to the original world frame.
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)

    # Build the inverse of the axis rearrangement: our cavity was constructed
    # by moving long_axis to axis 0 then (if muzzle_sign == -1) reversing it.
    # We need to undo both.
    if muzzle_sign == -1:
        mesh.vertices[:, 0] = -mesh.vertices[:, 0]  # reverse the depth axis
    # Move axis 0 back to long_axis.
    perm = [0, 1, 2]
    # After moveaxis(occupancy, long_axis, 0), the axes are (long_axis, other0, other1).
    # To undo, we do moveaxis(_, 0, long_axis). For vertices that means relabeling columns.
    v = mesh.vertices.copy()
    others = [a for a in (0, 1, 2) if a != long_axis]
    new_v = np.zeros_like(v)
    new_v[:, long_axis] = v[:, 0]
    new_v[:, others[0]] = v[:, 1]
    new_v[:, others[1]] = v[:, 2]
    mesh.vertices = new_v

    # Translate to world origin.
    mesh.vertices += origin
    mesh.merge_vertices()
    return mesh


def main() -> None:
    console = Console()
    raw: trimesh.Trimesh = trimesh.load_mesh(INPUT_STL, process=True)
    raw.merge_vertices()
    console.rule("Load and voxelize")
    console.print(f"scan: {len(raw.faces):,} faces, bbox {raw.bounds[1] - raw.bounds[0]}")

    occupancy, origin = voxelize_filled(raw, VOXEL_PITCH_MM)
    console.print(f"voxel grid: {occupancy.shape}, {int(occupancy.sum()):,} filled")

    long_axis = detect_long_axis(occupancy.shape)
    console.print(f"detected long axis: {long_axis}  (shape along it: {occupancy.shape[long_axis]} voxels = {occupancy.shape[long_axis]*VOXEL_PITCH_MM:.1f}mm)")

    muzzle_sign = detect_muzzle_direction(occupancy, long_axis)
    console.print(f"detected muzzle at the {'LOW' if muzzle_sign == 1 else 'HIGH'} end of axis {long_axis}")

    # Orient so muzzle is at axis-0 index 0.
    gun_vox = np.moveaxis(occupancy, long_axis, 0)
    if muzzle_sign == -1:
        gun_vox = gun_vox[::-1]
    gun_vox = np.ascontiguousarray(gun_vox)

    gun_length_mm = gun_vox.shape[0] * VOXEL_PITCH_MM
    insertion_mm = INSERTION_DEPTH_MM if INSERTION_DEPTH_MM is not None else gun_length_mm
    insertion_vox = int(round(insertion_mm / VOXEL_PITCH_MM))
    console.print(f"gun length along insertion axis: {gun_length_mm:.1f}mm, insertion depth: {insertion_mm:.1f}mm ({insertion_vox} voxels)")

    console.rule("Compute swept cavity")
    cavity = sweep_cavity(gun_vox, insertion_vox)
    console.print(f"cavity grid: {cavity.shape}, {int(cavity.sum()):,} filled voxels")

    # Remove padding/truly-empty slices for cleaner output.
    any_xy = cavity.any(axis=(1, 2))
    console.print(f"non-empty depth slices: {int(any_xy.sum())} / {cavity.shape[0]}")

    console.rule("Mesh extraction")
    mesh = cavity_to_mesh(cavity, origin, VOXEL_PITCH_MM, long_axis, muzzle_sign)
    console.print(f"mesh: {len(mesh.faces):,} faces, watertight={mesh.is_watertight}")

    # Also produce a decimated version at a few target face counts.
    import open3d as o3d
    for target in (8_000, 15_000, 30_000):
        o3d_mesh = o3d.geometry.TriangleMesh(
            vertices=o3d.utility.Vector3dVector(mesh.vertices),
            triangles=o3d.utility.Vector3iVector(mesh.faces),
        )
        o3d_mesh = o3d_mesh.simplify_quadric_decimation(target_number_of_triangles=target)
        dec = trimesh.Trimesh(
            vertices=np.asarray(o3d_mesh.vertices),
            faces=np.asarray(o3d_mesh.triangles),
            process=True,
        )
        out = OUT_DIR / f"swept_{int(insertion_mm)}mm_decim{target}.stl"
        dec.export(out)
        console.print(f"wrote {out.relative_to(PROJECT_DIR)}  faces={len(dec.faces):,}  watertight={dec.is_watertight}")

    # Also write the full-resolution version.
    full = OUT_DIR / f"swept_{int(insertion_mm)}mm_full.stl"
    mesh.export(full)
    console.print(f"wrote {full.relative_to(PROJECT_DIR)}  faces={len(mesh.faces):,}  watertight={mesh.is_watertight}")


if __name__ == "__main__":
    main()
