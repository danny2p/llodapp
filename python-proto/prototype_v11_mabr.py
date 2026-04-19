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
import json
from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
import trimesh.smoothing
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


def smooth_mesh(mesh: trimesh.Trimesh, iterations: int = 10) -> trimesh.Trimesh:
    if iterations <= 0:
        return mesh
    # trimesh.smoothing.filter_taubin is great for removing noise
    # without shrinking the mesh volume too much.
    trimesh.smoothing.filter_taubin(mesh, iterations=iterations)
    return mesh


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
                                       corner_radius: float = 0.0,
                                       ) -> tuple[np.ndarray, np.ndarray]:
    import numpy as np
    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype(np.float32)
    half_w = width_y_mm / 2.0
    if length_mm <= 0 or half_w <= 0 or depth_z_mm <= 0: return cavity_f, origin

    tg_front_x = tg_data["bbox_min"][0]
    anchor_x = tg_front_x + front_offset_mm
    anchor_y = tg_data["center"][1] + y_offset_mm
    theta = np.radians(rotate_deg)
    ct, st = np.cos(theta), np.sin(theta)

    # Rounded Triangle SDF (standard primitive approach)
    # We want to keep outer dimensions fixed, so we shrink the triangle by r.
    r = min(corner_radius, half_w * 0.9, length_mm * 0.5)
    
    # Vertex angles and normal setup
    m = half_w / length_mm
    hyp = np.sqrt(half_w**2 + length_mm**2)
    n_top = np.array([half_w, length_mm]) / hyp
    n_bot = np.array([half_w, -length_mm]) / hyp
    
    # Bounding box
    corners_uv = [(0.0, -half_w), (0.0, half_w), (length_mm, 0.0)]
    corner_gx = [anchor_x + u * ct - v * st for (u, v) in corners_uv]
    corner_gy = [anchor_y + u * st + v * ct for (u, v) in corners_uv]
    ci_vals = [insertion_vox - 1 - (g - origin[0]) / pitch for g in corner_gx]
    j_vals = [(g - origin[1]) / pitch for g in corner_gy]
    i_lo, i_hi = max(0, int(np.floor(min(ci_vals)))-2), min(nx-1, int(np.ceil(max(ci_vals)))+2)
    j_lo, j_hi = max(0, int(np.floor(min(j_vals)))-2), min(ny-1, int(np.ceil(max(j_vals)))+2)

    for i in range(i_lo, i_hi + 1):
        gx = origin[0] + (insertion_vox - 1 - i) * pitch
        for j in range(j_lo, j_hi + 1):
            gy = origin[1] + (j + 0.5) * pitch
            du, dv = gx - anchor_x, gy - anchor_y
            u, v = du * ct + dv * st, -du * st + dv * ct
            
            # Distance to shrunken lines
            sd1 = -u + r
            sd2 = (u * n_top[0] + (v - half_w) * n_top[1]) + r
            sd3 = (u * n_bot[0] + (v + half_w) * n_bot[1]) + r
            
            d_shrunken = max(sd1, sd2, sd3)
            if r <= 0:
                dist = d_shrunken
            else:
                if d_shrunken <= 0:
                    dist = d_shrunken - r
                else:
                    # In corner zones
                    dist = d_shrunken - r
                    if sd1 > 0 and sd2 > 0: dist = np.sqrt(sd1**2 + sd2**2) - r
                    elif sd1 > 0 and sd3 > 0: dist = np.sqrt(sd1**2 + sd3**2) - r
                    elif sd2 > 0 and sd3 > 0: dist = np.sqrt(sd2**2 + sd3**2) - r

            if dist > 0: continue
            
            v_cov = min(1.0, abs(dist) / pitch) if dist > -pitch else 1.0
            frac = max(0.0, min(1.0, 1.0 - u / length_mm))
            depth_vox = (depth_z_mm * frac) / pitch
            z_full, z_frac = int(np.floor(depth_vox)), depth_vox - np.floor(depth_vox)
            
            col = cavity_bin[i, j, :]
            if not col.any(): continue
            zs = np.where(col)[0]
            z_max, z_min = int(zs.max()), int(zs.min())
            
            for k_off in range(z_full + 1):
                dens = v_cov
                if k_off > depth_vox: continue
                if k_off + 1 > depth_vox: dens *= z_frac
                
                idx_pos, idx_neg = z_max - k_off, z_min + k_off
                if z_min <= idx_pos <= z_max:
                    cavity_f[i, j, idx_pos] = min(cavity_f[i, j, idx_pos], 1.0 - dens)
                if both_sides and z_min <= idx_neg <= z_max:
                    cavity_f[i, j, idx_neg] = min(cavity_f[i, j, idx_neg], 1.0 - dens)

    return cavity_f, origin

def inject_slide_release_relief(cavity_bin, origin, pitch, sr_coords, insertion_vox, width_y_mm, depth_z_mm, y_offset_mm, chamfer_mm=0.0):
    import numpy as np
    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype("float32")
    
    # 1. Coordinate Math
    # Entrance is index 0, Button is i_start.
    i_start = int((insertion_vox - 1) - round((sr_coords[0] - origin[0]) / pitch))
    j_c = int(round((sr_coords[1] + y_offset_mm - origin[1]) / pitch))
    k_tag_vox = (sr_coords[2] - origin[2]) / pitch

    # 2. Side detection (Positive or Negative Z relative to gun center)
    # We use a global grid center for the "interior" reference to ensure we fill outward.
    z_mid_vox = nz / 2.0
    is_positive_side = k_tag_vox > z_mid_vox

    # 3. Geometric Constants
    half_w_mm = width_y_mm / 2.0
    j0 = max(0, int(np.floor(j_c - (half_w_mm / pitch))))
    j1 = min(ny - 1, int(np.ceil(j_c + (half_w_mm / pitch))))
    
    # Target absolute Z plane (the "ceiling" of the relief)
    # This matches the 3D preview which starts at sr_coords[2] and goes out by depth_z_mm.
    target_z_world = sr_coords[2] + (depth_z_mm if is_positive_side else -depth_z_mm)
    target_k_vox = (target_z_world - origin[2]) / pitch
    
    # 4. Carving Loop
    for i in range(0, i_start + 1):
        x_dist_mm = (i_start - i) * pitch
        for j in range(j0, j1 + 1):
            y_dist_mm = half_w_mm - abs(j - j_c) * pitch
            
            # 3D Chamfer: we reduce the target_k_vox near edges
            min_dist_edge = min(max(0, x_dist_mm), max(0, y_dist_mm))
            
            local_target_k = target_k_vox
            if chamfer_mm > 0 and min_dist_edge < chamfer_mm:
                # Reduce the depth of the plane near edges
                offset_vox = (chamfer_mm - min_dist_edge) / pitch
                local_target_k = target_k_vox - (offset_vox if is_positive_side else -offset_vox)
            
            # Fill from the gun center out to the target plane
            if is_positive_side:
                k_start = int(np.floor(z_mid_vox))
                k_end_float = local_target_k
                for k in range(k_start, int(np.ceil(k_end_float)) + 1):
                    if 0 <= k < nz:
                        density = 1.0
                        if k > k_end_float: continue
                        if k + 1 > k_end_float:
                            density = k_end_float - k
                        if density > cavity_f[i, j, k]:
                            cavity_f[i, j, k] = density
            else:
                k_start = int(np.ceil(z_mid_vox))
                k_end_float = local_target_k
                for k in range(int(np.floor(k_end_float)), k_start + 1):
                    if 0 <= k < nz:
                        density = 1.0
                        if k < k_end_float: continue
                        if k - 1 < k_end_float:
                            density = k - k_end_float
                        if density > cavity_f[i, j, k]:
                            cavity_f[i, j, k] = density

    return cavity_f, origin

def cavity_to_mesh(cavity: np.ndarray, origin: np.ndarray, pitch: float,
                   smooth_sigma: float = 0.0) -> trimesh.Trimesh:
    from skimage import measure
    from scipy.ndimage import gaussian_filter
    padded = np.pad(cavity, 1, mode="constant", constant_values=0).astype(np.float32)
    if smooth_sigma > 0:
        padded = gaussian_filter(padded, sigma=smooth_sigma)
    verts, faces, _, _ = measure.marching_cubes(padded, level=0.5)
    # Subtract 1.0 to account for padding
    verts = (verts - 1.0) * pitch + origin
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
    parser.add_argument("--retention-corner-radius", type=float, default=0.0,
                        help="Radius (mm) to round the corners of the retention triangle.")
    parser.add_argument("--smooth-sigma", type=float, default=0.8,
                        help="Gaussian sigma (voxels) for cavity-grid smoothing; 0 disables.")
    parser.add_argument("--smooth-iter", type=int, default=0,
                        help="Number of Taubin smoothing iterations on the final mesh. Helps with voxel stair-stepping.")
    parser.add_argument("--voxel-pitch", type=float, default=VOXEL_PITCH_MM,
                        help=f"Voxel grid pitch in mm (default {VOXEL_PITCH_MM}). "
                             "Lower = more detail, quadratically more compute/memory.")
    parser.add_argument("--retention-one-side", action="store_true",
                        help="Only add bump to +Z side (default: both sides).")
    parser.add_argument("--sr-enabled", action="store_true",
                        help="Enable slide release relief carving.")
    parser.add_argument("--sr-width-y", type=float, default=12.0,
                        help="Width of the slide release channel (mm).")
    parser.add_argument("--sr-depth-z", type=float, default=6.0,
                        help="Depth of the slide release channel (mm).")
    parser.add_argument("--sr-y-offset", type=float, default=0.0,
                        help="Vertical offset for the slide release channel (mm).")
    parser.add_argument("--sr-chamfer", type=float, default=0.0,
                        help="Chamfer distance (mm) for the corners of the slide release relief channel.")
    parser.add_argument("--out-dir", type=str, default=None,
                        help="Directory for output STLs (default: python-proto/out).")
    parser.add_argument("--decim-target", type=int, default=None,
                        help="If set, only write a single decimated plug at this target (skips other variants).")
    parser.add_argument("--gun-decim-target", type=int, default=60_000,
                        help="Face count for the aligned gun export (web needs this compact).")
    parser.add_argument("--feature-points", type=str, default=None,
                        help="Path to JSON file containing manual feature coordinates.")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    stem = input_path.stem
    out_dir = Path(args.out_dir).resolve() if args.out_dir else OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    # Load manual features if provided
    manual_features = {}
    if args.feature_points:
        import json
        with open(args.feature_points, "r") as f:
            fps = json.load(f)
            for fp in fps:
                if fp["coords"]:
                    manual_features[fp["name"]] = fp["coords"]

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

    if args.gun_decim_target:
        gun_dec_out = out_dir / f"{stem}_mabr_aligned_decim{args.gun_decim_target}{suffix}.stl"
        if args.gun_decim_target < len(aligned.faces):
            gun_dec = decimate(aligned, args.gun_decim_target)
            gun_dec.export(gun_dec_out)
        else:
            aligned.export(gun_dec_out)
        console.print(f"wrote {gun_dec_out.name} (target {args.gun_decim_target})")

    console.rule("Voxelize + sweep")
    occupancy, origin = voxelize_filled(aligned, args.voxel_pitch)
    
    # Pad the voxel grid in all dimensions to provide headroom for 
    # offset relief channels and ensure clean mesh end-caps.
    pad_mm = 15.0
    pad_vox = int(np.ceil(pad_mm / args.voxel_pitch))
    # Padding: ((x_min, x_max), (y_min, y_max), (z_min, z_max))
    # We pad X now as well to ensure the grip-end face is closed cleanly.
    occupancy = np.pad(occupancy, ((pad_vox, pad_vox), (pad_vox, pad_vox), (pad_vox, pad_vox)), mode="constant", constant_values=0)
    origin -= pad_vox * args.voxel_pitch
    
    console.print(f"voxel grid: {occupancy.shape}, {int(occupancy.sum()):,} filled")
    insertion_vox = int(round(INSERTION_DEPTH_MM / args.voxel_pitch))
    cavity = sweep_cavity(occupancy, insertion_vox)

    cavity_origin = origin
    console.rule("Detect / Use features")
    
    tg = None
    if "tg_front" in manual_features:
        coords = np.array(manual_features["tg_front"])
        console.print(f"using manual trigger guard front: {coords}")
        # Construct a minimal tg dict for inject_triangular_retention_indent
        # We only need center[1] (y) and bbox_min[0] (x) and center[2] (z)
        tg = {
            "center": coords,
            "bbox_min": coords, # used for tg_front_gun_x
            "bbox_max": coords,
        }
    else:
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
                corner_radius=args.retention_corner_radius,
            )
            console.print(f"retention triangle: flat at TG_front+{args.retention_front_offset}mm, "
                          f"length {args.retention_length}mm, width {args.retention_width_y}mm, "
                          f"depth {args.retention_depth_z}mm, y_offset {args.retention_y_offset:+.1f}mm, "
                          f"rotate_z {args.retention_rotate_deg:+.1f}°, "
                          f"{'both' if not args.retention_one_side else '+Z'} sides")

    if args.sr_enabled:
        if "slide_release" not in manual_features:
            console.print("[yellow]slide release relief enabled but no point tagged; skipping[/yellow]")
        else:
            console.rule("Inject slide release relief")
            cavity, cavity_origin = inject_slide_release_relief(
                cavity, origin, args.voxel_pitch,
                sr_coords=np.array(manual_features["slide_release"]),
                insertion_vox=insertion_vox,
                width_y_mm=args.sr_width_y,
                depth_z_mm=args.sr_depth_z,
                y_offset_mm=args.sr_y_offset,
                chamfer_mm=args.sr_chamfer,
            )
            console.print(f"SR relief: width {args.sr_width_y}mm, depth {args.sr_depth_z}mm, "
                          f"y_offset {args.sr_y_offset:+.1f}mm")

    mesh = cavity_to_mesh(cavity, cavity_origin, args.voxel_pitch, smooth_sigma=args.smooth_sigma)
    if args.smooth_iter > 0:
        console.rule(f"Taubin Smoothing ({args.smooth_iter} iterations)")
        mesh = smooth_mesh(mesh, iterations=args.smooth_iter)

    console.print(f"MC mesh: {len(mesh.faces):,} faces, watertight={mesh.is_watertight}")

    if args.decim_target is None:
        raw_out = out_dir / f"{stem}_swept_mabr_{int(INSERTION_DEPTH_MM)}mm_raw{suffix}.stl"
        mesh.export(raw_out)
        console.print(f"wrote {raw_out.name}  faces={len(mesh.faces):,}")
        targets = (8_000, 15_000, 30_000, 120_000)
    else:
        targets = (args.decim_target,)

    for target in targets:
        out = out_dir / f"{stem}_swept_mabr_{int(INSERTION_DEPTH_MM)}mm_decim{target}{suffix}.stl"
        if target < len(mesh.faces):
            dec = decimate(mesh, target)
            dec.export(out)
        else:
            mesh.export(out)
        console.print(f"wrote {out.name} (target {target})")


if __name__ == "__main__":
    main()
