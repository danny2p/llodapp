"""v10: align the gun by detecting its slide sides, then sweep.

PCA on the full mesh failed because the grip extends down-and-back, which
biases the principal axis off the true slide direction. This version
finds the two slide sides (the two largest flat regions with antiparallel
normals) and uses their average normal as the thickness axis. Length and
height are then determined by 2D PCA in the plane perpendicular to that
axis.

Alongside the aligned scan we write a small STL with XYZ axis gizmos so
the orientation can be visually verified.

Pipeline:
  1. Load + decimate to ~12k faces for fast RANSAC.
  2. Iterative RANSAC to find flat regions.
  3. Pick the two biggest with roughly antiparallel normals -> slide sides.
  4. Z axis = average of the two normals (sign-aligned).
  5. 2D PCA in the Z-perpendicular plane -> length axis X.
  6. Y = Z x X.
  7. Rotate scan.
  8. Flip along X if the muzzle (narrower end) is at high X.
  9. Sweep (same as v8/v9).
 10. Write aligned scan + axis gizmos + sweep outputs.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
from rich.console import Console

from prototype_v3_snap import iterative_ransac

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
INPUT_STL = PROJECT_DIR / "sig.stl"

VOXEL_PITCH_MM = 0.5
INSERTION_DEPTH_MM = 130.0
DECIMATE_FOR_RANSAC = 12_000


def decimate(mesh: trimesh.Trimesh, target: int) -> trimesh.Trimesh:
    tm = o3d.geometry.TriangleMesh(
        vertices=o3d.utility.Vector3dVector(mesh.vertices),
        triangles=o3d.utility.Vector3iVector(mesh.faces),
    )
    tm = tm.simplify_quadric_decimation(target_number_of_triangles=target)
    out = trimesh.Trimesh(
        vertices=np.asarray(tm.vertices),
        faces=np.asarray(tm.triangles),
        process=True,
    )
    out.merge_vertices()
    return out


def find_slide_normal(mesh: trimesh.Trimesh, console: Console) -> np.ndarray:
    """Return a unit vector aligned with the slide's thickness axis.

    Strategy: run RANSAC. The two largest planes on a handgun are the left
    and right slide sides, with antiparallel normals. Average them (after
    flipping one to align) to get a robust thickness axis.
    """
    rng = np.random.default_rng(42)
    planes = iterative_ransac(mesh, rng)
    planes = sorted(planes, key=lambda p: -p["area"])
    if not planes:
        raise RuntimeError("no planes found")

    p1 = planes[0]
    n1 = p1["plane"][:3]
    console.print(f"biggest plane: area={p1['area']:.1f}mm^2, normal={n1.round(3)}")

    # Find second plane with roughly antiparallel (or parallel) normal.
    partner = None
    for p in planes[1:]:
        n = p["plane"][:3]
        if abs(np.dot(n1, n)) > 0.9:
            partner = p
            break

    if partner is None:
        console.print("[yellow]no partner slide side found; using single plane normal[/yellow]")
        return n1 / np.linalg.norm(n1)

    n2 = partner["plane"][:3]
    console.print(f"partner plane: area={partner['area']:.1f}mm^2, normal={n2.round(3)}")
    if np.dot(n1, n2) < 0:
        n2 = -n2
    avg = n1 + n2
    return avg / np.linalg.norm(avg)


def build_rotation(mesh: trimesh.Trimesh, z_axis: np.ndarray) -> np.ndarray:
    """Given the thickness axis, use 2D PCA in the perpendicular plane to
    find the length axis. Returns a 3x3 matrix whose rows are [X, Y, Z].
    Apply as: aligned = (R @ (v - centroid).T).T.
    """
    centroid = mesh.centroid
    v = mesh.vertices - centroid
    # Orthonormal basis (e1, e2) spanning the plane perpendicular to z_axis.
    helper = np.array([1.0, 0.0, 0.0]) if abs(z_axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    e1 = helper - np.dot(helper, z_axis) * z_axis
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(z_axis, e1)

    # Project vertices to 2D.
    v_proj = v - (v @ z_axis)[:, None] * z_axis  # 3D vectors in the Z-plane
    v_2d = np.column_stack([v_proj @ e1, v_proj @ e2])

    # 2D PCA via covariance.
    cov = v_2d.T @ v_2d / len(v_2d)
    eigvals, eigvecs = np.linalg.eigh(cov)
    order = np.argsort(-eigvals)
    pc1_2d = eigvecs[:, order[0]]  # length dir in 2D

    x_axis = pc1_2d[0] * e1 + pc1_2d[1] * e2
    x_axis /= np.linalg.norm(x_axis)
    y_axis = np.cross(z_axis, x_axis)
    # Make sure the frame is right-handed (it is, by construction via cross).
    R = np.stack([x_axis, y_axis, z_axis])
    return R, centroid


def orient_muzzle_low(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    xs = mesh.vertices[:, 0]
    x_min, x_max = xs.min(), xs.max()
    span = x_max - x_min
    head = mesh.vertices[xs < x_min + 0.1 * span]
    tail = mesh.vertices[xs > x_max - 0.1 * span]
    head_area = (head[:, 1:].max(0) - head[:, 1:].min(0)).prod()
    tail_area = (tail[:, 1:].max(0) - tail[:, 1:].min(0)).prod()
    if head_area > tail_area:
        v = mesh.vertices.copy()
        v[:, 0] = -v[:, 0]
        v[:, 1] = -v[:, 1]  # preserve handedness
        return trimesh.Trimesh(vertices=v, faces=mesh.faces, process=False)
    return mesh


def make_axis_gizmos(length_mm: float = 80.0, thickness_mm: float = 3.0) -> trimesh.Trimesh:
    """Three axis-colored boxes along +X, +Y, +Z. Useful for visually
    confirming the detected alignment when loaded alongside the aligned scan.
    (Note: STL does not carry colors, so this is a geometry-only gizmo. But
    since the X box is long+X-extended, the Y box is long+Y-extended, etc.,
    you can still read orientation from shape.)
    """
    boxes = []
    for axis in range(3):
        extents = [thickness_mm, thickness_mm, thickness_mm]
        extents[axis] = length_mm
        box = trimesh.creation.box(extents=extents)
        # Translate so the box starts at origin and points along +axis.
        offset = np.zeros(3)
        offset[axis] = length_mm / 2
        box.apply_translation(offset)
        boxes.append(box)
    return trimesh.util.concatenate(boxes)


def voxelize_filled(mesh: trimesh.Trimesh, pitch: float) -> tuple[np.ndarray, np.ndarray]:
    vox = mesh.voxelized(pitch=pitch).fill()
    occupancy = vox.matrix.copy()
    origin = np.asarray(vox.transform)[:3, 3].astype(float)
    return occupancy, origin


def sweep_cavity(gun_vox: np.ndarray, insertion_depth_vox: int) -> np.ndarray:
    gun_len = gun_vox.shape[0]
    yz = gun_vox.shape[1:]
    limit = min(gun_len, insertion_depth_vox)
    cum = np.zeros((limit,) + yz, dtype=bool)
    running = np.zeros(yz, dtype=bool)
    for i in range(limit):
        running = running | gun_vox[i]
        cum[i] = running
    cavity = np.zeros((insertion_depth_vox,) + yz, dtype=bool)
    for x in range(insertion_depth_vox):
        idx = insertion_depth_vox - 1 - x
        cavity[x] = cum[min(idx, limit - 1)]
    return cavity


def cavity_to_mesh(cavity: np.ndarray, origin: np.ndarray, pitch: float) -> trimesh.Trimesh:
    from skimage import measure
    padded = np.pad(cavity, 1, mode="constant", constant_values=False)
    verts, faces, _, _ = measure.marching_cubes(padded.astype(np.float32), level=0.5)
    verts = (verts - 1) * pitch + origin
    m = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    m.merge_vertices()
    return m


def main() -> None:
    console = Console()
    raw: trimesh.Trimesh = trimesh.load_mesh(INPUT_STL, process=True)
    raw.merge_vertices()
    console.rule("Load")
    console.print(f"raw: {len(raw.faces):,} faces, bbox {raw.bounds[1] - raw.bounds[0]}")

    console.rule("Detect slide sides via RANSAC on decimated mesh")
    small = decimate(raw, DECIMATE_FOR_RANSAC)
    console.print(f"decimated to {len(small.faces):,} faces for RANSAC")
    z_axis = find_slide_normal(small, console)
    console.print(f"slide thickness axis (Z): {z_axis.round(3)}")

    console.rule("Build rotation")
    R, centroid = build_rotation(raw, z_axis)
    console.print(f"rotation matrix R (rows = X, Y, Z):\n{R.round(3)}")
    # Apply rotation on the FULL scan.
    aligned_verts = (R @ (raw.vertices - centroid).T).T
    aligned = trimesh.Trimesh(vertices=aligned_verts, faces=raw.faces, process=True)
    aligned.merge_vertices()
    console.print(f"aligned bbox: {aligned.bounds[1] - aligned.bounds[0]}")

    aligned = orient_muzzle_low(aligned)
    console.print(f"after muzzle orient: bbox {aligned.bounds[1] - aligned.bounds[0]}")

    # Export for inspection.
    aligned_out = OUT_DIR / "sig_slide_aligned.stl"
    aligned.export(aligned_out)
    gizmos = make_axis_gizmos()
    gizmos_out = OUT_DIR / "axis_gizmos.stl"
    gizmos.export(gizmos_out)
    console.print(f"wrote {aligned_out.relative_to(PROJECT_DIR)}")
    console.print(f"wrote {gizmos_out.relative_to(PROJECT_DIR)}  (load alongside the aligned STL — long boxes along +X, +Y, +Z)")

    console.rule("Voxelize + sweep")
    occupancy, origin = voxelize_filled(aligned, VOXEL_PITCH_MM)
    console.print(f"voxel grid: {occupancy.shape}, {int(occupancy.sum()):,} filled")
    insertion_vox = int(round(INSERTION_DEPTH_MM / VOXEL_PITCH_MM))
    cavity = sweep_cavity(occupancy, insertion_vox)
    console.print(f"cavity grid: {cavity.shape}, {int(cavity.sum()):,} filled")

    mesh = cavity_to_mesh(cavity, origin, VOXEL_PITCH_MM)
    console.print(f"MC mesh: {len(mesh.faces):,} faces, watertight={mesh.is_watertight}")

    full = OUT_DIR / f"swept_slide_{int(INSERTION_DEPTH_MM)}mm_full.stl"
    mesh.export(full)
    console.print(f"wrote {full.relative_to(PROJECT_DIR)}  faces={len(mesh.faces):,}")

    for target in (8_000, 15_000, 30_000):
        dec = decimate(mesh, target)
        out = OUT_DIR / f"swept_slide_{int(INSERTION_DEPTH_MM)}mm_decim{target}.stl"
        dec.export(out)
        console.print(f"wrote {out.relative_to(PROJECT_DIR)}  faces={len(dec.faces):,}  watertight={dec.is_watertight}")


if __name__ == "__main__":
    main()
