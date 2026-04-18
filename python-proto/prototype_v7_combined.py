"""Combined pipeline: shrinkwrap → smooth → RANSAC planes → snap (fixed).

Addresses the two issues from v6 output:
  1. "Stepped across its length" on the slide — scan noise preserved in the
     surface. Cure: detect flat regions and snap them to fitted planes.
  2. Previous plane-snap gave pyramid edges because boundary vertices stayed
     at their original scan position. Cure: snap boundary vertices too —
     for a vertex whose faces belong to plane P and adjacent residual, snap
     to P. For a vertex on the border of two planes, snap to the intersection
     line of those planes.

Output naming: combined_close{R}mm_target{N}.stl where R is closing radius
and N is the target face count.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
from rich.console import Console
from rich.table import Table
from scipy.ndimage import binary_dilation, binary_erosion, generate_binary_structure

from prototype_v3_snap import iterative_ransac, merge_planes

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
INPUT_STL = PROJECT_DIR / "sig.stl"

VOXEL_PITCH_MM = 0.4
CLOSING_RADIUS_MM = 3.5
TAUBIN_ITERS = 40
TARGET_FACES = 18_000
SNAP_AREA_FRACTION = 0.5  # vertex snaps to plane P if >=50% of incident face area is on P


def voxelize_filled(mesh: trimesh.Trimesh, pitch: float) -> tuple[np.ndarray, np.ndarray]:
    vox = mesh.voxelized(pitch=pitch).fill()
    occupancy = vox.matrix.copy()
    origin = np.asarray(vox.transform)[:3, 3].astype(float)
    return occupancy, origin


def morphological_close(grid: np.ndarray, k_voxels: int) -> np.ndarray:
    struct = generate_binary_structure(3, 1)
    pad = k_voxels + 1
    padded = np.pad(grid, pad, mode="constant", constant_values=False)
    dilated = binary_dilation(padded, structure=struct, iterations=k_voxels)
    closed = binary_erosion(dilated, structure=struct, iterations=k_voxels)
    return closed[pad:-pad, pad:-pad, pad:-pad]


def grid_to_mesh(grid: np.ndarray, origin: np.ndarray, pitch: float) -> trimesh.Trimesh:
    padded = np.pad(grid, 1, mode="constant", constant_values=False)
    from skimage import measure
    verts, faces, _, _ = measure.marching_cubes(padded.astype(np.float32), level=0.5)
    verts = (verts - 1) * pitch + origin
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    mesh.merge_vertices()
    return mesh


def taubin(mesh: trimesh.Trimesh, iters: int) -> trimesh.Trimesh:
    o3d_mesh = o3d.geometry.TriangleMesh(
        vertices=o3d.utility.Vector3dVector(mesh.vertices),
        triangles=o3d.utility.Vector3iVector(mesh.faces),
    )
    o3d_mesh = o3d_mesh.filter_smooth_taubin(number_of_iterations=iters)
    return trimesh.Trimesh(
        vertices=np.asarray(o3d_mesh.vertices),
        faces=np.asarray(o3d_mesh.triangles),
        process=True,
    )


def decimate(mesh: trimesh.Trimesh, target: int) -> trimesh.Trimesh:
    o3d_mesh = o3d.geometry.TriangleMesh(
        vertices=o3d.utility.Vector3dVector(mesh.vertices),
        triangles=o3d.utility.Vector3iVector(mesh.faces),
    )
    o3d_mesh = o3d_mesh.simplify_quadric_decimation(target_number_of_triangles=target)
    out = trimesh.Trimesh(
        vertices=np.asarray(o3d_mesh.vertices),
        faces=np.asarray(o3d_mesh.triangles),
        process=True,
    )
    out.merge_vertices()
    return out


def snap_vertices_fixed(mesh: trimesh.Trimesh, planes: list[dict]) -> tuple[trimesh.Trimesh, dict]:
    """For each vertex, decide which plane(s) to project onto based on the
    area-weighted distribution of its incident faces across planes.

    Rules:
      - Build a mapping: vertex -> {plane_id: incident_face_area}.
      - If no plane dominates (all incident area on residual) → leave vertex alone.
      - If one plane holds >= SNAP_AREA_FRACTION of the vertex's incident area
        → project onto that plane.
      - If two planes each hold significant area → project onto the line where
        those two planes intersect (closest point on the line).
      - If 3+ planes → least-squares intersection point of the planes.
    """
    n_faces = len(mesh.faces)
    face_plane = np.full(n_faces, -1, dtype=int)
    for idx, p in enumerate(planes):
        face_plane[p["mask"]] = idx
    face_areas = mesh.area_faces

    # Per-vertex accumulator: dict plane_id -> area.
    vert_plane_area: list[dict[int, float]] = [dict() for _ in range(len(mesh.vertices))]
    vert_total_area = np.zeros(len(mesh.vertices))
    for f_idx, (a, b, c) in enumerate(mesh.faces):
        pid = face_plane[f_idx]
        if pid < 0:
            continue
        area = face_areas[f_idx] / 3.0
        for v in (a, b, c):
            vert_plane_area[v][pid] = vert_plane_area[v].get(pid, 0.0) + area
            vert_total_area[v] += area

    new_verts = mesh.vertices.copy()
    snap_stats = {"single": 0, "line": 0, "point": 0, "left": 0}

    for v_idx, plane_areas in enumerate(vert_plane_area):
        if not plane_areas:
            snap_stats["left"] += 1
            continue
        # Sort planes by area, descending.
        sorted_planes = sorted(plane_areas.items(), key=lambda kv: -kv[1])
        total = vert_total_area[v_idx]
        # Determine dominant planes (those holding a meaningful share).
        dominant = [pid for pid, a in sorted_planes if a / total > 0.15]
        if not dominant:
            snap_stats["left"] += 1
            continue

        if len(dominant) == 1 or sorted_planes[0][1] / total >= SNAP_AREA_FRACTION:
            pid = dominant[0]
            pl = planes[pid]["plane"]
            n = pl[:3]
            d = pl[3]
            dist = np.dot(n, new_verts[v_idx]) + d
            new_verts[v_idx] = new_verts[v_idx] - dist * n
            snap_stats["single"] += 1
        elif len(dominant) == 2:
            # Snap to the intersection line of the two planes (closest point on it).
            p1 = planes[dominant[0]]["plane"]
            p2 = planes[dominant[1]]["plane"]
            new_verts[v_idx] = closest_point_on_plane_intersection(new_verts[v_idx], p1, p2)
            snap_stats["line"] += 1
        else:
            # 3+ planes: least-squares solve for the vertex position closest to
            # all of them simultaneously, weighted by area.
            A_rows, b_rows, w_rows = [], [], []
            for pid in dominant[:4]:
                pl = planes[pid]["plane"]
                n = pl[:3]
                d = pl[3]
                A_rows.append(n)
                b_rows.append(-d)
                w_rows.append(np.sqrt(plane_areas[pid]))
            A = np.array(A_rows) * np.array(w_rows)[:, None]
            b = np.array(b_rows) * np.array(w_rows)
            # Regularise with identity*eps so the system stays well-posed
            # when the three planes are nearly parallel.
            eps = 1e-3
            At_A = A.T @ A + eps * np.eye(3)
            At_b = A.T @ b + eps * new_verts[v_idx]
            new_verts[v_idx] = np.linalg.solve(At_A, At_b)
            snap_stats["point"] += 1

    out = trimesh.Trimesh(vertices=new_verts, faces=mesh.faces, process=False)
    return out, snap_stats


def closest_point_on_plane_intersection(p: np.ndarray, plane1: np.ndarray, plane2: np.ndarray) -> np.ndarray:
    """Find the closest point to p on the line where plane1 and plane2 intersect.

    plane = (a, b, c, d) with a*x+b*y+c*z+d = 0.
    Line direction = n1 x n2. A point on the line = solve the 2 plane eqs.
    """
    n1 = plane1[:3]
    d1 = plane1[3]
    n2 = plane2[:3]
    d2 = plane2[3]
    line_dir = np.cross(n1, n2)
    nd = np.linalg.norm(line_dir)
    if nd < 1e-6:
        # Planes parallel — fall back to snapping onto the larger one (plane1).
        dist = np.dot(n1, p) + d1
        return p - dist * n1
    line_dir /= nd
    # A point on the line: solve [n1; n2; line_dir] @ x = [-d1, -d2, 0].
    A = np.vstack([n1, n2, line_dir])
    rhs = np.array([-d1, -d2, 0.0])
    point_on_line = np.linalg.solve(A, rhs)
    # Closest point on the line to p:
    delta = p - point_on_line
    t = np.dot(delta, line_dir)
    return point_on_line + t * line_dir


def main() -> None:
    console = Console()
    console.rule(f"v7 combined pipeline: shrinkwrap {CLOSING_RADIUS_MM}mm → snap")
    raw: trimesh.Trimesh = trimesh.load_mesh(INPUT_STL, process=True)
    raw.merge_vertices()
    console.print(f"raw scan: {len(raw.faces):,} faces")

    console.print(f"voxelizing at {VOXEL_PITCH_MM}mm pitch...")
    occupancy, origin = voxelize_filled(raw, VOXEL_PITCH_MM)
    console.print(f"occupancy: {occupancy.shape}, {int(occupancy.sum()):,} filled voxels")

    k = max(1, int(round(CLOSING_RADIUS_MM / VOXEL_PITCH_MM)))
    console.print(f"morphological close: k={k} voxels = {k * VOXEL_PITCH_MM:.2f}mm radius")
    closed = morphological_close(occupancy, k)
    console.print(f"after close: {int(closed.sum()):,} voxels ({int(closed.sum() - occupancy.sum()):+,})")

    mesh = grid_to_mesh(closed, origin, VOXEL_PITCH_MM)
    console.print(f"MC: {len(mesh.faces):,} faces")

    mesh = taubin(mesh, iters=TAUBIN_ITERS)
    console.print(f"taubin x{TAUBIN_ITERS}: {len(mesh.faces):,} faces")

    mesh = decimate(mesh, TARGET_FACES)
    console.print(f"decimate: {len(mesh.faces):,} faces, watertight={mesh.is_watertight}")

    # Segment + snap.
    rng = np.random.default_rng(42)
    planes = iterative_ransac(mesh, rng)
    planes = merge_planes(planes, len(mesh.faces))
    covered = sum(p["area"] for p in planes) / mesh.area_faces.sum()
    console.print(f"{len(planes)} planes, coverage {covered:.1%}")

    snapped, stats = snap_vertices_fixed(mesh, planes)
    console.print(f"snap stats: single={stats['single']:,}  line={stats['line']:,}  point={stats['point']:,}  left={stats['left']:,}")

    out = OUT_DIR / f"combined_close{CLOSING_RADIUS_MM}mm_target{TARGET_FACES}.stl"
    snapped.export(out)
    console.print(f"\nwrote {out.relative_to(PROJECT_DIR)}  watertight={snapped.is_watertight}  winding_ok={snapped.is_winding_consistent}")

    # Also write the pre-snap version for A/B comparison.
    pre = OUT_DIR / f"combined_close{CLOSING_RADIUS_MM}mm_presnap.stl"
    mesh.export(pre)
    console.print(f"wrote {pre.relative_to(PROJECT_DIR)}  (pre-snap for comparison)")


if __name__ == "__main__":
    main()
