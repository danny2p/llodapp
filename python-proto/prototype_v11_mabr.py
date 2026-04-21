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
import hashlib
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
from features_loader import load_appliers

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
CACHE_DIR = Path(__file__).resolve().parent / "cache" / "prep"
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


def orient_muzzle_high(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """HAS Standard: Muzzle must be at HIGH X (+X)."""
    xs = mesh.vertices[:, 0]
    x_min, x_max = xs.min(), xs.max()
    span = x_max - x_min
    # Look at the 'head' (low X) and 'tail' (high X)
    head = mesh.vertices[xs < x_min + 0.1 * span]
    tail = mesh.vertices[xs > x_max - 0.1 * span]
    # Handguns are 'blunter' at the back (grip/hammer) and 'smaller' at the muzzle.
    head_area = (head[:, 1:].max(0) - head[:, 1:].min(0)).prod()
    tail_area = (tail[:, 1:].max(0) - tail[:, 1:].min(0)).prod()
    
    if head_area < tail_area:
        # Muzzle is currently at low X. Rotate 180 around Y to point it to HIGH X.
        v = mesh.vertices.copy()
        v[:, 0] = -v[:, 0]
        v[:, 2] = -v[:, 2]
        return trimesh.Trimesh(vertices=v, faces=mesh.faces, process=True)
    return mesh


def normalize_y_orientation(mesh, console=None):
    """Handguns are top-heavy (slide is more massive than grip).
    After centering the centroid at (0,0,0), the distance to the grip bottom
    (-Y) should be greater than the distance to the slide top (+Y).
    """
    ys = mesh.vertices[:, 1]
    y_min, y_max = ys.min(), ys.max()
    
    # If the bounding box center is above the centroid, it means
    # there is more geometric extension in the +Y direction (upside down).
    if (y_min + y_max) > 0:
        if console:
            console.print("[yellow]Orientation check: mass-distribution detects upside-down scan. Flipping...[/yellow]")
        # Rotate 180 around X
        v = mesh.vertices.copy()
        v[:, 1] = -v[:, 1]
        v[:, 2] = -v[:, 2]
        return trimesh.Trimesh(vertices=v, faces=mesh.faces, process=True)
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


def voxelize_sdf(mesh: trimesh.Trimesh, pitch: float, band: int = 3
                 ) -> tuple[np.ndarray, np.ndarray]:
    """True mesh signed-distance field via Open3D RaycastingScene."""
    from scipy.ndimage import binary_fill_holes, distance_transform_edt

    tm = o3d.geometry.TriangleMesh(
        vertices=o3d.utility.Vector3dVector(mesh.vertices),
        triangles=o3d.utility.Vector3iVector(mesh.faces),
    )
    vg = o3d.geometry.VoxelGrid.create_from_triangle_mesh(tm, voxel_size=pitch)
    voxels = vg.get_voxels()
    if not voxels:
        return np.full((1, 1, 1), band * pitch, dtype=np.float32), np.zeros(3)
    idx = np.array([v.grid_index for v in voxels], dtype=np.int64)
    i_min = idx.min(axis=0)
    idx -= i_min
    shape = tuple((idx.max(axis=0) + 1).tolist())
    surface = np.zeros(shape, dtype=bool)
    surface[idx[:, 0], idx[:, 1], idx[:, 2]] = True
    occ = binary_fill_holes(surface)
    o3d_origin = np.asarray(vg.origin, dtype=float)
    origin = o3d_origin + (np.asarray(i_min, dtype=float) + 0.5) * pitch

    dist_in  = distance_transform_edt(occ)
    dist_out = distance_transform_edt(~occ)
    dist_to_surface = np.where(occ, dist_in, dist_out)
    band_mask = dist_to_surface <= band
    ijk = np.argwhere(band_mask)
    coords = (origin[None, :] + ijk.astype(np.float64) * pitch).astype(np.float32)

    scene = o3d.t.geometry.RaycastingScene()
    scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(tm))
    sdf_band = scene.compute_signed_distance(o3d.core.Tensor(coords)).numpy()

    sdf_grid = np.where(occ, -band * pitch, band * pitch).astype(np.float32)
    sdf_grid[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = sdf_band.astype(np.float32)
    return sdf_grid, origin


def sweep_cavity_sdf(gun_sdf: np.ndarray, insertion_depth_vox: int) -> np.ndarray:
    """Generate the cavity by sweeping the gun muzzle-first.
    
    HAS Standard: 
    - Input gun_sdf has Muzzle at HIGH X.
    - Output cavity_sdf has Entrance at index 0 and Muzzle Floor at high index.
    """
    gun_len = gun_sdf.shape[0]
    limit = min(gun_len, insertion_depth_vox)
    
    # We want swept[i] to be the union of gun[i] through gun[max] (Muzzle-first sweep)
    # This is a 'suffix min'.
    # Suffix min(x) = Prefix min(reverse(x)) then reverse back.
    flipped = gun_sdf[:limit][::-1]
    cum = np.minimum.accumulate(flipped, axis=0)
    swept = cum[::-1]
    
    # Pad or trim to the requested insertion depth
    idx = np.minimum(np.arange(insertion_depth_vox), limit - 1)
    return swept[idx].astype(np.float32)


def cavity_to_mesh(cavity_sdf: np.ndarray, origin: np.ndarray, pitch: float,
                   smooth_sigma: float = 0.0) -> trimesh.Trimesh:
    from skimage import measure
    pad_val = float(np.abs(cavity_sdf).max())
    padded = np.pad(cavity_sdf, 1, mode="constant", constant_values=pad_val).astype(np.float32)
    if smooth_sigma > 0:
        from scipy.ndimage import gaussian_filter
        padded = gaussian_filter(padded, sigma=smooth_sigma)
    verts, faces, _, _ = measure.marching_cubes(padded, level=0.0)
    verts = (verts - 1.0) * pitch + origin
    m = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    m.merge_vertices()
    return m


# ────────────────────────────────────────────────────────────────────
# Prep-pipeline cache
#
# Alignment + voxelization + sweep + TG detection are the 80% of wall time
# and depend only on (input STL, voxel pitch, rotate_z, mirror). The feature
# loop and mesh extraction are the cheap tail. Cache the prep output so
# feature-slider tweaks on the same scan skip straight to carving.
# ────────────────────────────────────────────────────────────────────

def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def _cache_key(input_path: Path, voxel_pitch: float, rotate_z_deg: float, mirror: bool, total_length: float) -> str:
    mir = "1" if mirror else "0"
    # has1: HAS migration — cavity origin/sweep convention now muzzle=+X, entrance=index 0.
    return f"{_hash_file(input_path)}_p{voxel_pitch}_rz{rotate_z_deg}_m{mir}_l{total_length}_has1"


def _load_prep_cache(cache_base: Path, key: str):
    entry = cache_base / key
    if not (entry / "ok").exists():
        return None
    meta = json.loads((entry / "meta.json").read_text())
    data = np.load(entry / "grids.npz")
    cavity_sdf = data["cavity_sdf"]
    origin = data["origin"]
    insertion_vox = int(meta["insertion_vox"])
    physical_muzzle_i = int(meta.get("physical_muzzle_i", 0))
    tg = meta.get("tg")
    if tg is not None:
        tg = {k: (np.asarray(v) if isinstance(v, list) else v) for k, v in tg.items()}
    aligned = trimesh.load_mesh(entry / "aligned.stl", process=True)
    return aligned, cavity_sdf, origin, insertion_vox, tg, physical_muzzle_i


def _save_prep_cache(cache_base: Path, key: str, aligned, cavity_sdf, origin, insertion_vox, tg, physical_muzzle_i: int) -> None:
    entry = cache_base / key
    entry.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(entry / "grids.npz", cavity_sdf=cavity_sdf, origin=origin)
    tg_json = None
    if tg is not None:
        tg_json = {k: (v.tolist() if hasattr(v, "tolist") else v) for k, v in tg.items()}
    (entry / "meta.json").write_text(json.dumps({
        "insertion_vox": insertion_vox,
        "physical_muzzle_i": physical_muzzle_i,
        "tg": tg_json,
    }))
    aligned.export(entry / "aligned.stl")
    (entry / "ok").write_text("ok")  # marker; half-written entries have no "ok"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=str, default=str(DEFAULT_INPUT_STL),
                        help="Path to input STL (default: sig.stl at project root).")
    parser.add_argument("--rotate-z-deg", type=float, default=0.0,
                        help="Additional rotation around Z after auto alignment (to correct MABR errors).")
    parser.add_argument("--mirror", action="store_true",
                        help="Mirror across XY plane (flip Z). Use if slide release/ejection side comes out wrong.")
    parser.add_argument("--smooth-sigma", type=float, default=0.0,
                        help="Gaussian sigma (voxels) for cavity-grid smoothing; 0 disables. "
                             "Default 0: the true-SDF pipeline already produces sub-voxel surfaces, "
                             "so blurring rounds good radii and is usually not wanted.")
    parser.add_argument("--smooth-iter", type=int, default=0,
                        help="Number of Taubin smoothing iterations on the final mesh. Helps with voxel stair-stepping.")
    parser.add_argument("--total-length", type=float, default=INSERTION_DEPTH_MM,
                        help=f"Total length of the holster mold in mm (default {INSERTION_DEPTH_MM}).")
    parser.add_argument("--voxel-pitch", type=float, default=VOXEL_PITCH_MM,
                        help=f"Voxel grid pitch in mm (default {VOXEL_PITCH_MM}). "
                             "Lower = more detail, quadratically more compute/memory.")
    parser.add_argument("--out-dir", type=str, default=None,
                        help="Directory for output STLs (default: python-proto/out).")
    parser.add_argument("--decim-target", type=int, default=None,
                        help="If set, only write a single decimated plug at this target (skips other variants).")
    parser.add_argument("--gun-decim-target", type=int, default=60_000,
                        help="Face count for the aligned gun export (web needs this compact).")
    parser.add_argument("--features-state", type=str, default=None,
                        help="Path to JSON FeatureStates from the frontend registry. "
                             "Each enabled entry with a tagged point fires its plugin's apply().")
    parser.add_argument("--cache-dir", type=str, default=None,
                        help="Directory for the prep-pipeline cache (alignment + voxel grid + tg). "
                             f"Default: {CACHE_DIR}.")
    parser.add_argument("--no-cache", action="store_true",
                        help="Skip the prep cache: always re-run alignment + voxelization.")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    stem = input_path.stem
    out_dir = Path(args.out_dir).resolve() if args.out_dir else OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    features_state: dict = {}
    if args.features_state:
        with open(args.features_state, "r") as f:
            features_state = json.load(f)

    appliers = load_appliers()

    console = Console()
    def emit_progress(p: float, label: str):
        # Print a simple JSON line that api.py can intercept
        # Use flush=True to ensure it's sent immediately through the pipe
        print(f"__PROGRESS__:{json.dumps({'p': p, 'l': label})}", flush=True)

    emit_progress(0.01, "initializing pipeline")
    console.print(f"input: {input_path.relative_to(PROJECT_DIR)}")

    suffix = f"_rz{int(args.rotate_z_deg)}" if args.rotate_z_deg else ""
    if args.mirror:
        suffix += "_mir"

    cache_base = Path(args.cache_dir).resolve() if args.cache_dir else CACHE_DIR
    cache_key = _cache_key(input_path, args.voxel_pitch, args.rotate_z_deg, args.mirror, args.total_length)
    cached = None if args.no_cache else _load_prep_cache(cache_base, cache_key)

    if cached is not None:
        emit_progress(0.60, "prep cache hit :: loading grids")
        console.rule("Prep cache hit")
        aligned, cavity_sdf, cavity_origin, insertion_vox, tg, physical_muzzle_i = cached
        console.print(f"key: {cache_key}  ({cache_base})")
        console.print(f"aligned: {len(aligned.faces):,} faces; cavity_sdf: {cavity_sdf.shape}; tg: {'yes' if tg else 'no'}")
    else:
        raw: trimesh.Trimesh = trimesh.load_mesh(input_path, process=True)
        raw.merge_vertices()
        console.rule("Load")
        console.print(f"raw: {len(raw.faces):,} faces, bbox {raw.bounds[1] - raw.bounds[0]}")

        emit_progress(0.15, "detecting slide alignment")
        console.rule("Detect slide sides (Z axis)")
        small = decimate(raw, DECIMATE_FOR_RANSAC)
        z_axis = find_slide_normal(small, console)
        console.print(f"Z (thickness) = {z_axis.round(3)}")

        emit_progress(0.25, "calculating MABR rotation")
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

        aligned = orient_muzzle_high(aligned)
        aligned = normalize_y_orientation(aligned, console)
        
        # HAS Standard: Center the bounding box at [0,0,0]
        bb_center = (aligned.bounds[1] + aligned.bounds[0]) / 2.0
        aligned.apply_translation(-bb_center)
        console.print(f"after orientation normalization & centering: bbox {aligned.bounds[1] - aligned.bounds[0]}")

        emit_progress(0.35, "voxelizing mesh to SDF")
        console.rule("Voxelize + sweep")
        gun_sdf, origin = voxelize_sdf(aligned, args.voxel_pitch)

        # Pad the voxel grid in all dimensions to provide headroom for
        # offset relief channels and ensure clean mesh end-caps. Outside
        # the mesh the SDF should stay positive — use the band constant.
        pad_mm = 15.0
        pad_vox = int(np.ceil(pad_mm / args.voxel_pitch))
        outside_val = float(np.max(gun_sdf))
        gun_sdf = np.pad(gun_sdf, ((pad_vox, pad_vox),) * 3, mode="constant", constant_values=outside_val)
        origin -= pad_vox * args.voxel_pitch

        # Detect physical muzzle before the sweep/padding
        physical_occupancy = gun_sdf < 0
        phys_occupied_i = np.where(physical_occupancy.any(axis=(1, 2)))[0]
        
        # Muzzle is at MAX i in the gun_sdf (due to orient_muzzle_high)
        muzzle_vox = int(phys_occupied_i.max()) if len(phys_occupied_i) > 0 else 0

        emit_progress(0.50, "computing swept cavity volume")
        insertion_vox = int(round(args.total_length / args.voxel_pitch))
        
        # SLICING:
        # We want the mold to represent the space from Entrance to Muzzle Floor + Pad.
        # Total length requested is 'insertion_vox'.
        # The 'end' of our model should be (muzzle_vox + pad).
        # The 'start' should be (end - insertion_vox).
        end = min(gun_sdf.shape[0], muzzle_vox + pad_vox + 1)
        start = end - insertion_vox
        slice_start = max(0, start)
        pad_entrance = max(0, -start)
        
        sliced_gun = gun_sdf[slice_start:end]
        if pad_entrance > 0:
            sliced_gun = np.pad(sliced_gun, ((pad_entrance, 0), (0, 0), (0, 0)), mode='edge')
            
        cavity_sdf = sweep_cavity_sdf(sliced_gun, insertion_vox)
        
        # IMPORTANT: Shift origin to match the slice
        cavity_origin = origin.copy()
        cavity_origin[0] += (slice_start - pad_entrance) * args.voxel_pitch

        emit_progress(0.55, "detecting trigger guard anchors")
        occupancy = cavity_sdf < 0
        tg = detect_trigger_guard(occupancy, cavity_origin, args.voxel_pitch, console)
        
        # In this slice, the physical muzzle is exactly at (muzzle_vox - slice_start + pad_entrance)
        physical_muzzle_i = muzzle_vox - slice_start + pad_entrance
        context = {"tg": tg, "physical_muzzle_i": physical_muzzle_i}

        if not args.no_cache:
            _save_prep_cache(cache_base, cache_key, aligned, cavity_sdf, cavity_origin, insertion_vox, tg, physical_muzzle_i)
            console.print(f"cached prep under {cache_key}")

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

    # Features use the origin established during prep
    console.rule("Features")

    if tg is not None:
        # Persist TG anchor so the UI can pre-fill the retention overlay
        # before the pipeline runs end-to-end.
        tg_json_path = out_dir / "tg.json"
        tg_json_path.write_text(json.dumps({
            "tg_front_x": float(tg["bbox_min"][0]),
            "tg_center_y": float(tg["center"][1]),
            "tg_center_z": float(tg["center"][2]),
        }))
        console.print(f"wrote {tg_json_path.name}")

    # Iterate features in registry order (frontend barrel = JSON dict order).
    # Each enabled feature with at least one tagged point fires its applier.
    # Features honor the existing binary-cavity plugin contract; we derive
    # a binary view from the SDF, hand it to the features, then splice their
    # output back into the SDF only at voxels they actually modified.
    # Clobbering the whole SDF with a ±pitch binary field would clip the
    # true mesh distance at pristine surfaces (e.g. the slide top), pulling
    # MC zero-crossings off their sub-voxel positions and reintroducing
    # stair-steps on angled surfaces.
    original_cavity_bin = (cavity_sdf < 0).astype(np.float32)
    cavity_bin = original_cavity_bin.copy()
    context = {"tg": tg, "physical_muzzle_i": physical_muzzle_i}
    
    enabled_fids = [fid for fid, state in features_state.items() if state.get("enabled")]
    
    for idx, fid in enumerate(enabled_fids):
        state = features_state[fid]
        pts = state.get("points") or []
        
        # Only skip if the feature HAS tag slots but they are all empty.
        # Automatic features have 0 slots (pts=[]) and should never be skipped.
        if pts and pts[0] is None:
            console.print(f"[yellow]{fid}: enabled but not tagged; skipping[/yellow]")
            continue
            
        emit_progress(0.65 + (idx / len(enabled_fids)) * 0.15, f"applying feature :: {fid}")
        
        fn = appliers.get(fid)
        if fn is None:
            continue  # marker-only feature (no apply.py)
        console.rule(f"Apply: {fid}")
        cavity_bin, cavity_origin = fn(
            cavity_bin, cavity_origin, args.voxel_pitch,
            state=state,
            insertion_vox=insertion_vox,
            context=context,
            console=console,
        )

    if cavity_bin.shape != cavity_sdf.shape:
        console.print("[yellow]feature resized grid; using binary-derived SDF[/yellow]")
        cavity_sdf_final = (args.voxel_pitch * (1.0 - 2.0 * np.clip(cavity_bin, 0.0, 1.0))).astype(np.float32)
    else:
        cavity_sdf_final = cavity_sdf.copy()
        touched = cavity_bin != original_cavity_bin
        if touched.any():
            feature_sdf = (args.voxel_pitch * (1.0 - 2.0 * np.clip(cavity_bin, 0.0, 1.0))).astype(np.float32)
            cavity_sdf_final[touched] = feature_sdf[touched]
            console.print(f"features touched {int(touched.sum()):,} voxels")

    emit_progress(0.85, "extracting high-res mesh via marching cubes")
    mesh = cavity_to_mesh(cavity_sdf_final, cavity_origin, args.voxel_pitch, smooth_sigma=args.smooth_sigma)
    if args.smooth_iter > 0:
        console.rule(f"Taubin Smoothing ({args.smooth_iter} iterations)")
        mesh = smooth_mesh(mesh, iterations=args.smooth_iter)

    console.print(f"MC mesh: {len(mesh.faces):,} faces, watertight={mesh.is_watertight}")

    if args.decim_target is None:
        raw_out = out_dir / f"{stem}_swept_mabr_{int(args.total_length)}mm_raw{suffix}.stl"
        mesh.export(raw_out)
        console.print(f"wrote {raw_out.name}  faces={len(mesh.faces):,}")
        targets = (8_000, 15_000, 30_000, 120_000)
    else:
        targets = (args.decim_target,)

    for idx, target in enumerate(targets):
        emit_progress(0.90 + (idx / len(targets)) * 0.08, f"decimating to {target} faces")
        out = out_dir / f"{stem}_swept_mabr_{int(args.total_length)}mm_decim{target}{suffix}.stl"
        if target < len(mesh.faces):
            dec = decimate(mesh, target)
            dec.export(out)
        else:
            mesh.export(out)
        console.print(f"wrote {out.name} (target {target})")

    emit_progress(1.0, "processing complete")


if __name__ == "__main__":
    main()
