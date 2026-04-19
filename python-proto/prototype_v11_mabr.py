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
from detect_features import detect_trigger_guard

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
DEFAULT_INPUT_STL = PROJECT_DIR / "sig.stl"

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


def inject_triangular_retention_indent(cavity_bin: np.ndarray, origin: np.ndarray, pitch: float,
                                       tg_data: dict, insertion_vox: int,
                                       front_offset_mm: float, length_mm: float,
                                       width_y_mm: float, depth_z_mm: float,
                                       y_offset_mm: float, both_sides: bool,
                                       rotate_deg: float = 0.0,
                                       ) -> tuple[np.ndarray, np.ndarray]:
    """Carve a triangular, ramped-depth indentation INTO the cavity plug.

    The kydex molded onto this plug will form a matching bump in that
    indentation — on extraction, the gun's TG front edge hits the bump and
    has to climb out, providing retention.

    Gun-frame geometry, in a rotated local (u, v) frame anchored at the
    flat-side midpoint:
      - u = 0 is the flat side (full width_y, max depth_z carved)
      - u = length_mm is the point (zero width, zero depth)
      - v is perpendicular, ranging |v| ≤ (1 - u/length) * width_y/2
      - rotate_deg rotates the (u, v) frame around +Z in the gun frame. 0°
        points the triangle at the muzzle (legacy behavior); positive
        rotates the point CCW when viewed down -Z.

    Anti-aliased: returns a FLOAT density field in [0, 1]. A voxel partially
    carved gets density = 1 - (carve coverage), so marching cubes at 0.5
    produces smooth diagonal walls instead of voxel staircases.
    """
    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype(np.float32)

    half_w_mm = width_y_mm / 2.0
    if length_mm <= 0 or half_w_mm <= 0 or depth_z_mm <= 0:
        return cavity_f, origin

    tg_front_gun_x = tg_data["bbox_min"][0]
    flat_gun_x = tg_front_gun_x + front_offset_mm
    flat_gun_y = tg_data["center"][1] + y_offset_mm

    theta = np.radians(rotate_deg)
    ct, st = np.cos(theta), np.sin(theta)

    # AABB of the rotated triangle in gun-frame (gx, gy), then to (i, j).
    # Corners are the two flat endpoints and the point.
    corners_uv = [(0.0, -half_w_mm), (0.0, half_w_mm), (length_mm, 0.0)]
    corner_gx = [flat_gun_x + u * ct - v * st for (u, v) in corners_uv]
    corner_gy = [flat_gun_y + u * st + v * ct for (u, v) in corners_uv]

    # cavity_i = insertion_vox - 1 - (gx - origin[0]) / pitch
    ci_vals = [insertion_vox - 1 - (g - origin[0]) / pitch for g in corner_gx]
    j_vals = [(g - origin[1]) / pitch for g in corner_gy]

    # 1-voxel margin so the AA band at triangle edges is preserved.
    i_lo = max(0, int(np.floor(min(ci_vals))) - 1)
    i_hi = min(nx - 1, int(np.ceil(max(ci_vals))) + 1)
    j_lo = max(0, int(np.floor(min(j_vals))) - 1)
    j_hi = min(ny - 1, int(np.ceil(max(j_vals))) + 1)

    for i in range(i_lo, i_hi + 1):
        gx_i = origin[0] + (insertion_vox - 1 - i) * pitch
        for j in range(j_lo, j_hi + 1):
            gy_j = origin[1] + (j + 0.5) * pitch  # use voxel center in Y
            # Voxel center in gun frame; X already expresses the cavity
            # column center because the sweep is aligned with the grid.
            dx = gx_i - flat_gun_x
            dy = gy_j - flat_gun_y
            u = dx * ct + dy * st
            v = -dx * st + dy * ct
            if u < 0.0 or u > length_mm:
                continue
            frac = 1.0 - u / length_mm  # 0 at point, 1 at flat
            half_w_here = half_w_mm * frac
            depth_here_mm = depth_z_mm * frac
            if half_w_here <= 0.0 or depth_here_mm <= 0.0:
                continue

            # AA in v: treat voxel as 1 pitch wide perpendicular to the
            # rotated width axis. An exact rotated-voxel overlap would need
            # a polygon clip; Gaussian smoothing upstream absorbs the slop.
            v_vox = abs(v) / pitch
            half_w_vox = half_w_here / pitch
            if v_vox + 0.5 <= half_w_vox:
                v_cov = 1.0
            elif v_vox - 0.5 >= half_w_vox:
                continue
            else:
                v_cov = float(half_w_vox - (v_vox - 0.5))

            depth_vox = depth_here_mm / pitch
            z_full = int(np.floor(depth_vox))
            z_frac = depth_vox - z_full

            col = cavity_bin[i, j, :]
            if not col.any():
                continue
            zs = np.where(col)[0]
            z_max = int(zs.max())
            z_min = int(zs.min())

            # Carve from +Z surface inward.
            for k in range(z_full):
                idx = z_max - k
                if z_min <= idx <= z_max:
                    new_v = 1.0 - v_cov
                    if cavity_f[i, j, idx] > new_v:
                        cavity_f[i, j, idx] = new_v
            if z_frac > 0.0:
                idx = z_max - z_full
                if z_min <= idx <= z_max:
                    new_v = 1.0 - v_cov * z_frac
                    if cavity_f[i, j, idx] > new_v:
                        cavity_f[i, j, idx] = new_v

            if both_sides:
                for k in range(z_full):
                    idx = z_min + k
                    if z_min <= idx <= z_max:
                        new_v = 1.0 - v_cov
                        if cavity_f[i, j, idx] > new_v:
                            cavity_f[i, j, idx] = new_v
                if z_frac > 0.0:
                    idx = z_min + z_full
                    if z_min <= idx <= z_max:
                        new_v = 1.0 - v_cov * z_frac
                        if cavity_f[i, j, idx] > new_v:
                            cavity_f[i, j, idx] = new_v

    return cavity_f, origin


def cavity_to_mesh(cavity: np.ndarray, origin: np.ndarray, pitch: float,
                   smooth_sigma: float = 0.0) -> trimesh.Trimesh:
    from skimage import measure
    from scipy.ndimage import gaussian_filter
    padded = np.pad(cavity, 1, mode="constant", constant_values=False).astype(np.float32)
    if smooth_sigma > 0:
        padded = gaussian_filter(padded, sigma=smooth_sigma)
    verts, faces, _, _ = measure.marching_cubes(padded, level=0.5)
    verts = (verts - 1) * pitch + origin
    m = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    m.merge_vertices()
    return m


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=str, default=str(DEFAULT_INPUT_STL),
                        help="Path to input STL (default: sig.stl at project root).")
    parser.add_argument("--rotate-z-deg", type=float, default=0.0,
                        help="Additional rotation around Z after auto alignment (to correct MABR errors).")
    parser.add_argument("--mirror", action="store_true",
                        help="Mirror across XY plane (flip Z). Use if slide release/ejection side comes out wrong.")
    parser.add_argument("--retention", action="store_true",
                        help="Add a triangular retention bump behind the trigger guard's front edge.")
    parser.add_argument("--retention-front-offset", type=float, default=4.0,
                        help="mm behind TG front edge where the triangle's FLAT side starts.")
    parser.add_argument("--retention-length", type=float, default=16.0,
                        help="Triangle length along gun X, from flat side to point (mm).")
    parser.add_argument("--retention-width-y", type=float, default=14.0,
                        help="Triangle width at the flat side, in Y (mm).")
    parser.add_argument("--retention-depth-z", type=float, default=4.0,
                        help="Max bump outward depth at the flat side (mm). Ramps linearly to 0 at the point.")
    parser.add_argument("--retention-y-offset", type=float, default=0.0,
                        help="Y offset from trigger-guard center to triangle center (mm, +Y in aligned frame).")
    parser.add_argument("--retention-rotate-deg", type=float, default=0.0,
                        help="Rotate the retention triangle around +Z, anchored at the flat-side midpoint. "
                             "0 points at the muzzle; positive rotates CCW looking down -Z.")
    parser.add_argument("--smooth-sigma", type=float, default=0.8,
                        help="Gaussian sigma (voxels) for cavity-grid smoothing; 0 disables.")
    parser.add_argument("--voxel-pitch", type=float, default=VOXEL_PITCH_MM,
                        help=f"Voxel grid pitch in mm (default {VOXEL_PITCH_MM}). "
                             "Lower = more detail, quadratically more compute/memory.")
    parser.add_argument("--retention-one-side", action="store_true",
                        help="Only add bump to +Z side (default: both sides).")
    parser.add_argument("--out-dir", type=str, default=None,
                        help="Directory for output STLs (default: python-proto/out).")
    parser.add_argument("--decim-target", type=int, default=None,
                        help="If set, only write a single decimated plug at this target (skips other variants).")
    parser.add_argument("--gun-decim-target", type=int, default=60_000,
                        help="Face count for the aligned gun export (web needs this compact).")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    stem = input_path.stem
    out_dir = Path(args.out_dir).resolve() if args.out_dir else OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    console = Console()
    console.print(f"input: {input_path.relative_to(PROJECT_DIR)}")
    raw: trimesh.Trimesh = trimesh.load_mesh(input_path, process=True)
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
    if args.retention:
        suffix += "_ret"
    aligned_out = out_dir / f"{stem}_mabr_aligned{suffix}.stl"
    aligned.export(aligned_out)
    console.print(f"wrote {aligned_out.name}  faces={len(aligned.faces):,}")
    if args.gun_decim_target and args.gun_decim_target < len(aligned.faces):
        gun_dec = decimate(aligned, args.gun_decim_target)
        gun_dec_out = out_dir / f"{stem}_mabr_aligned_decim{args.gun_decim_target}{suffix}.stl"
        gun_dec.export(gun_dec_out)
        console.print(f"wrote {gun_dec_out.name}  faces={len(gun_dec.faces):,}")

    console.rule("Voxelize + sweep")
    occupancy, origin = voxelize_filled(aligned, args.voxel_pitch)
    console.print(f"voxel grid: {occupancy.shape}, {int(occupancy.sum()):,} filled")
    insertion_vox = int(round(INSERTION_DEPTH_MM / args.voxel_pitch))
    cavity = sweep_cavity(occupancy, insertion_vox)

    cavity_origin = origin
    console.rule("Detect trigger guard")
    tg = detect_trigger_guard(occupancy, origin, args.voxel_pitch, console)
    if tg is not None:
        # Persist TG anchor so the UI can draw a live retention-triangle
        # overlay without re-running the pipeline.
        import json
        tg_json_path = out_dir / "tg.json"
        tg_json_path.write_text(json.dumps({
            "tg_front_x": float(tg["bbox_min"][0]),
            "tg_center_y": float(tg["center"][1]),
            "tg_center_z": float(tg["center"][2]),
        }))
        console.print(f"wrote {tg_json_path.name}")
    if args.retention:
        if tg is None:
            console.print("[yellow]no trigger guard detected; skipping retention[/yellow]")
        else:
            console.rule("Inject retention bump")
            cavity, cavity_origin = inject_triangular_retention_indent(
                cavity, origin, args.voxel_pitch,
                tg_data=tg,
                insertion_vox=insertion_vox,
                front_offset_mm=args.retention_front_offset,
                length_mm=args.retention_length,
                width_y_mm=args.retention_width_y,
                depth_z_mm=args.retention_depth_z,
                y_offset_mm=args.retention_y_offset,
                both_sides=not args.retention_one_side,
                rotate_deg=args.retention_rotate_deg,
            )
            console.print(f"retention triangle: flat at TG_front+{args.retention_front_offset}mm, "
                          f"length {args.retention_length}mm, width {args.retention_width_y}mm, "
                          f"depth {args.retention_depth_z}mm, y_offset {args.retention_y_offset:+.1f}mm, "
                          f"rotate_z {args.retention_rotate_deg:+.1f}°, "
                          f"{'both' if not args.retention_one_side else '+Z'} sides")

    mesh = cavity_to_mesh(cavity, cavity_origin, args.voxel_pitch, smooth_sigma=args.smooth_sigma)
    console.print(f"MC mesh: {len(mesh.faces):,} faces, watertight={mesh.is_watertight}")

    if args.decim_target is None:
        raw_out = out_dir / f"{stem}_swept_mabr_{int(INSERTION_DEPTH_MM)}mm_raw{suffix}.stl"
        mesh.export(raw_out)
        console.print(f"wrote {raw_out.name}  faces={len(mesh.faces):,}")
        targets = (8_000, 15_000, 30_000, 120_000)
    else:
        targets = (args.decim_target,)

    for target in targets:
        if target >= len(mesh.faces):
            continue
        dec = decimate(mesh, target)
        out = out_dir / f"{stem}_swept_mabr_{int(INSERTION_DEPTH_MM)}mm_decim{target}{suffix}.stl"
        dec.export(out)
        console.print(f"wrote {out.name}  faces={len(dec.faces):,}")


if __name__ == "__main__":
    main()
