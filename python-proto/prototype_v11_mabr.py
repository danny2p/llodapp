"""v11: alignment via slide-normal Z + MABR for in-plane rotation.

Z (thickness axis) is detected via RANSAC on the two slide sides, same as
v10. The in-plane rotation (around Z) was previously done by 2D PCA which
picked a diagonal between the slide and the grip — not the slide axis.

Replacement: compute the minimum-area bounding rectangle (MABR) of the 2D
convex hull of the projected vertices. For a firearm side profile, the
slide is the dominant rectangular feature, and the MABR's long edge snaps
to it.

Manual override: if the MABR still misses on a given scan, pass
--rotate-z-deg N to apply an additional N-degree rotation around Z after
automatic alignment. The override is additive; e.g. --rotate-z-deg -25
corrects a 25-degree CCW error.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
from rich.console import Console
from scipy.spatial import ConvexHull

from prototype_v3_snap import iterative_ransac

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
INPUT_STL = PROJECT_DIR / "sig.stl"

VOXEL_PITCH_MM = 0.5
INSERTION_DEPTH_MM = 160.0
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
    rng = np.random.default_rng(42)
    planes = iterative_ransac(mesh, rng)
    planes = sorted(planes, key=lambda p: -p["area"])
    if not planes:
        raise RuntimeError("no planes found")
    p1 = planes[0]
    n1 = p1["plane"][:3]
    console.print(f"biggest plane area={p1['area']:.1f}mm^2 normal={n1.round(3)}")
    partner = None
    for p in planes[1:]:
        if abs(np.dot(n1, p["plane"][:3])) > 0.9:
            partner = p
            break
    if partner is None:
        console.print("[yellow]no partner slide side; using single-plane normal[/yellow]")
        return n1 / np.linalg.norm(n1)
    n2 = partner["plane"][:3]
    console.print(f"partner plane area={partner['area']:.1f}mm^2 normal={n2.round(3)}")
    if np.dot(n1, n2) < 0:
        n2 = -n2
    avg = n1 + n2
    return avg / np.linalg.norm(avg)


def min_area_bbox_angle(points_2d: np.ndarray) -> tuple[float, tuple[float, float]]:
    """Return (angle_rad, (width, height)) for the minimum-area rectangle
    enclosing points_2d. The angle is the orientation of the rectangle's
    LONG edge relative to the +X axis. Rotating points by -angle makes the
    long edge horizontal."""
    hull = ConvexHull(points_2d)
    pts = points_2d[hull.vertices]  # in CCW order
    n = len(pts)
    best_area = float("inf")
    best_angle = 0.0
    best_dims = (0.0, 0.0)
    for i in range(n):
        edge = pts[(i + 1) % n] - pts[i]
        angle = np.arctan2(edge[1], edge[0])
        c, s = np.cos(-angle), np.sin(-angle)
        R = np.array([[c, -s], [s, c]])
        rotated = pts @ R.T
        xs = rotated[:, 0]
        ys = rotated[:, 1]
        w = xs.max() - xs.min()
        h = ys.max() - ys.min()
        area = w * h
        if area < best_area:
            best_area = area
            best_angle = angle
            best_dims = (w, h)
    # Ensure "long edge" is the reported angle — if w < h, rotate by 90 deg.
    w, h = best_dims
    if w < h:
        best_angle += np.pi / 2
        best_dims = (h, w)
    return best_angle, best_dims


def build_rotation(mesh: trimesh.Trimesh, z_axis: np.ndarray, console: Console) -> tuple[np.ndarray, np.ndarray]:
    centroid = mesh.centroid
    v = mesh.vertices - centroid

    helper = np.array([1.0, 0.0, 0.0]) if abs(z_axis[0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    e1 = helper - np.dot(helper, z_axis) * z_axis
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(z_axis, e1)

    # Project to 2D in (e1, e2) coords.
    v_proj_3d = v - (v @ z_axis)[:, None] * z_axis
    v_2d = np.column_stack([v_proj_3d @ e1, v_proj_3d @ e2])

    angle, (w, h) = min_area_bbox_angle(v_2d)
    console.print(f"MABR: long edge angle = {np.degrees(angle):.1f} deg in (e1,e2) frame, dims = {w:.1f} x {h:.1f} mm")

    # Build X in 3D from (cos, sin) of the MABR angle.
    x_axis = np.cos(angle) * e1 + np.sin(angle) * e2
    x_axis /= np.linalg.norm(x_axis)
    y_axis = np.cross(z_axis, x_axis)
    R = np.stack([x_axis, y_axis, z_axis])
    return R, centroid


def apply_rotation(mesh: trimesh.Trimesh, R: np.ndarray, centroid: np.ndarray) -> trimesh.Trimesh:
    v = (R @ (mesh.vertices - centroid).T).T
    out = trimesh.Trimesh(vertices=v, faces=mesh.faces, process=True)
    out.merge_vertices()
    return out


def rotate_around_z(mesh: trimesh.Trimesh, degrees: float) -> trimesh.Trimesh:
    if degrees == 0:
        return mesh
    rad = np.radians(degrees)
    c, s = np.cos(rad), np.sin(rad)
    Rz = np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])
    v = mesh.vertices @ Rz.T
    out = trimesh.Trimesh(vertices=v, faces=mesh.faces, process=True)
    out.merge_vertices()
    return out


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
        v[:, 1] = -v[:, 1]
        return trimesh.Trimesh(vertices=v, faces=mesh.faces, process=False)
    return mesh


def make_axis_gizmos(length_mm: float = 80.0, thickness_mm: float = 3.0) -> trimesh.Trimesh:
    boxes = []
    for axis in range(3):
        extents = [thickness_mm, thickness_mm, thickness_mm]
        extents[axis] = length_mm
        box = trimesh.creation.box(extents=extents)
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--rotate-z-deg", type=float, default=0.0,
                        help="Additional rotation around Z after auto alignment (to correct MABR errors).")
    parser.add_argument("--mirror", action="store_true",
                        help="Mirror across XY plane (flip Z). Use if slide release/ejection side comes out wrong.")
    args = parser.parse_args()

    console = Console()
    raw: trimesh.Trimesh = trimesh.load_mesh(INPUT_STL, process=True)
    raw.merge_vertices()
    console.rule("Load")
    console.print(f"raw: {len(raw.faces):,} faces, bbox {raw.bounds[1] - raw.bounds[0]}")

    console.rule("Detect slide sides (Z axis)")
    small = decimate(raw, DECIMATE_FOR_RANSAC)
    z_axis = find_slide_normal(small, console)
    console.print(f"Z (thickness) = {z_axis.round(3)}")

    console.rule("MABR in-plane rotation (X axis)")
    R, centroid = build_rotation(raw, z_axis, console)
    aligned = apply_rotation(raw, R, centroid)
    console.print(f"aligned bbox: {aligned.bounds[1] - aligned.bounds[0]}")

    if args.rotate_z_deg != 0.0:
        console.rule(f"Manual correction: rotate {args.rotate_z_deg:+.1f} deg around Z")
        aligned = rotate_around_z(aligned, args.rotate_z_deg)
        console.print(f"post-correction bbox: {aligned.bounds[1] - aligned.bounds[0]}")

    if args.mirror:
        console.rule("Mirror across XY plane")
        v = aligned.vertices.copy()
        v[:, 2] = -v[:, 2]
        faces = aligned.faces[:, ::-1]  # reverse winding to keep normals outward
        aligned = trimesh.Trimesh(vertices=v, faces=faces, process=True)
        aligned.merge_vertices()

    aligned = orient_muzzle_low(aligned)
    console.print(f"after muzzle orient: bbox {aligned.bounds[1] - aligned.bounds[0]}")

    suffix = f"_rz{int(args.rotate_z_deg)}" if args.rotate_z_deg else ""
    if args.mirror:
        suffix += "_mir"
    aligned_out = OUT_DIR / f"sig_mabr_aligned{suffix}.stl"
    aligned.export(aligned_out)
    gizmos_out = OUT_DIR / "axis_gizmos.stl"
    make_axis_gizmos().export(gizmos_out)
    console.print(f"wrote {aligned_out.relative_to(PROJECT_DIR)}")
    console.print(f"wrote {gizmos_out.relative_to(PROJECT_DIR)}")

    console.rule("Voxelize + sweep")
    occupancy, origin = voxelize_filled(aligned, VOXEL_PITCH_MM)
    console.print(f"voxel grid: {occupancy.shape}, {int(occupancy.sum()):,} filled")
    insertion_vox = int(round(INSERTION_DEPTH_MM / VOXEL_PITCH_MM))
    cavity = sweep_cavity(occupancy, insertion_vox)

    mesh = cavity_to_mesh(cavity, origin, VOXEL_PITCH_MM)
    console.print(f"MC mesh: {len(mesh.faces):,} faces, watertight={mesh.is_watertight}")

    for target in (8_000, 15_000, 30_000):
        dec = decimate(mesh, target)
        out = OUT_DIR / f"swept_mabr_{int(INSERTION_DEPTH_MM)}mm_decim{target}{suffix}.stl"
        dec.export(out)
        console.print(f"wrote {out.relative_to(PROJECT_DIR)}  faces={len(dec.faces):,}")


if __name__ == "__main__":
    main()
