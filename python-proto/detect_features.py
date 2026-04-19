"""Detect trigger guard and ejection port on an aligned firearm mesh.

Takes an input STL that has already been aligned by prototype_v11_mabr.py
(X = length, Y = height, Z = thickness). Uses 2D projections of the voxel
occupancy to find:

  - Trigger guard: the largest enclosed hole in the side-view (XY)
    silhouette. On a handgun this is unambiguously the trigger guard —
    nothing else makes a hole that size in the side profile.

  - Ejection port: a gap in the slide's top-down silhouette (XZ),
    restricted to the upper Y band where the slide lives. The slide is a
    closed tube along Z except where the port opens it.

Writes a markers STL with a small sphere at each detected centroid and
a wireframe-ish box around each bbox, so the detections can be visually
verified alongside the aligned scan.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import trimesh
from rich.console import Console
from scipy import ndimage

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"

VOXEL_PITCH_MM = 0.5
SLIDE_Y_BAND_FRAC = 0.15  # top N% of Y range is "slide top" for ejection-port search


def voxelize(mesh: trimesh.Trimesh, pitch: float) -> tuple[np.ndarray, np.ndarray]:
    vox = mesh.voxelized(pitch=pitch).fill()
    return vox.matrix.copy(), np.asarray(vox.transform)[:3, 3].astype(float)


def find_biggest_hole(grid_2d: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int], tuple[float, float], float] | None:
    """In a 2D binary occupancy grid, find the largest enclosed hole.
    Returns (mask, (i0, j0, i1, j1), (i_centroid, j_centroid), area_voxels)
    or None if no holes.
    """
    filled = ndimage.binary_fill_holes(grid_2d)
    holes = filled & ~grid_2d
    labeled, n = ndimage.label(holes)
    if n == 0:
        return None
    sizes = ndimage.sum(holes, labeled, range(1, n + 1))
    best = int(np.argmax(sizes)) + 1
    mask = labeled == best
    ij = np.argwhere(mask)
    i0, j0 = ij.min(axis=0)
    i1, j1 = ij.max(axis=0)
    i_c, j_c = ij.mean(axis=0)
    return mask, (int(i0), int(j0), int(i1), int(j1)), (float(i_c), float(j_c)), float(sizes[best - 1])


def detect_trigger_guard(occ: np.ndarray, origin: np.ndarray, pitch: float, console: Console) -> dict | None:
    """Project occupancy along Z (side view). Find the biggest hole."""
    side = occ.any(axis=2)  # shape (NX, NY)
    result = find_biggest_hole(side)
    if result is None:
        console.print("[yellow]no trigger-guard hole found in side projection[/yellow]")
        return None
    _, (i0, j0, i1, j1), (i_c, j_c), area_vox = result
    area_mm2 = area_vox * pitch * pitch
    x_c = origin[0] + i_c * pitch
    y_c = origin[1] + j_c * pitch
    x0, x1 = origin[0] + i0 * pitch, origin[0] + i1 * pitch
    y0, y1 = origin[1] + j0 * pitch, origin[1] + j1 * pitch
    # Z center = middle of the gun's thickness (trigger guard passes through).
    z0 = origin[2]
    z1 = origin[2] + occ.shape[2] * pitch
    z_c = (z0 + z1) / 2
    console.print(f"trigger guard: center=({x_c:.1f}, {y_c:.1f}, {z_c:.1f}) "
                  f"bbox X=[{x0:.1f},{x1:.1f}] Y=[{y0:.1f},{y1:.1f}] "
                  f"area={area_mm2:.1f}mm^2")
    return {
        "center": np.array([x_c, y_c, z_c]),
        "bbox_min": np.array([x0, y0, z0]),
        "bbox_max": np.array([x1, y1, z1]),
        "area_mm2": area_mm2,
    }


def detect_ejection_port(occ: np.ndarray, origin: np.ndarray, pitch: float, console: Console,
                         trigger_guard: dict | None = None) -> dict | None:
    """Find the slide's top plateau, then look for XZ columns inside the
    slide footprint that have material below the plateau but NOT at the
    plateau — those are ports cut downward into the slide.

    Uses trigger_guard.center.x as a prior: the ejection port on a handgun
    sits roughly above the trigger guard in X. We restrict the search to
    X in [tg.x - 15mm, tg.x + 55mm] to avoid confusing the port with
    muzzle tapers or rear slide step-downs.
    """
    nx, ny, nz = occ.shape
    y_idx = np.where(occ, np.arange(ny)[None, :, None], -1)
    top_y = y_idx.max(axis=1)  # shape (NX, NZ); -1 = empty column
    material_mask = top_y >= 0
    plateau_ref = float(np.percentile(top_y[material_mask], 75))

    # A column is "in the slide" if its top surface is close to the plateau
    # (slide top proper), OR if it's in a port (top surface 3-15mm below).
    # "Port depth" = vertical drop of the top surface from the slide plateau.
    slide_tol_vox = int(round(10.0 / pitch))  # slide = within 10mm of plateau
    port_min_drop_vox = int(round(3.0 / pitch))   # ≥ 3mm drop to count as port
    port_max_drop_vox = int(round(15.0 / pitch))  # ≤ 15mm drop (deeper = not port)

    slide_region = material_mask & (top_y >= plateau_ref - slide_tol_vox)
    port = (slide_region
            & (top_y < plateau_ref - port_min_drop_vox)
            & (top_y > plateau_ref - port_max_drop_vox))

    # Constrain to a window around the trigger guard (typical port location).
    if trigger_guard is not None:
        tg_x = trigger_guard["center"][0]
        x_lo = tg_x - 15.0
        x_hi = tg_x + 55.0
        i_lo = max(0, int(round((x_lo - origin[0]) / pitch)))
        i_hi = min(nx, int(round((x_hi - origin[0]) / pitch)))
        window_mask = np.zeros_like(port)
        window_mask[i_lo:i_hi, :] = True
        port = port & window_mask
        console.print(f"  constrained port search to X∈[{x_lo:.1f}, {x_hi:.1f}] (trigger-guard window)")

    labeled, n = ndimage.label(port)
    if n == 0:
        console.print("[yellow]no ejection-port depression found in top-surface map[/yellow]")
        return None
    # Filter components: require ≥ 50mm² area AND bbox extents of at least
    # 10mm in X and 4mm in Z (rules out edge slivers / rollover artifacts).
    min_area_vox = int(50.0 / (pitch * pitch))
    min_x_vox = int(round(10.0 / pitch))
    min_z_vox = int(round(4.0 / pitch))
    candidates = []
    for lid in range(1, n + 1):
        m = labeled == lid
        size = int(m.sum())
        if size < min_area_vox:
            continue
        ij = np.argwhere(m)
        i_extent = ij[:, 0].max() - ij[:, 0].min() + 1
        k_extent = ij[:, 1].max() - ij[:, 1].min() + 1
        if i_extent < min_x_vox or k_extent < min_z_vox:
            continue
        candidates.append((size, lid))
    if not candidates:
        console.print("[yellow]no ejection-port candidate passed size/shape filters[/yellow]")
        return None
    best = max(candidates, key=lambda sc: sc[0])[1]
    mask = labeled == best
    ik = np.argwhere(mask)
    i0, k0 = ik.min(axis=0)
    i1, k1 = ik.max(axis=0)
    i_c, k_c = ik.mean(axis=0)
    area_mm2 = float(sizes[best - 1]) * pitch * pitch

    # Y of the port: use the plateau height (that's the slide top's Y).
    y_plateau = origin[1] + plateau_ref * pitch
    # Y extent: from the port floor to the plateau.
    y_floor_idx = int(top_y[mask].min())
    y_floor = origin[1] + y_floor_idx * pitch

    x_c = origin[0] + i_c * pitch
    z_c = origin[2] + k_c * pitch
    x0, x1 = origin[0] + int(i0) * pitch, origin[0] + int(i1) * pitch
    z0, z1 = origin[2] + int(k0) * pitch, origin[2] + int(k1) * pitch
    console.print(f"ejection port: center=({x_c:.1f}, {y_plateau:.1f}, {z_c:.1f}) "
                  f"bbox X=[{x0:.1f},{x1:.1f}] Z=[{z0:.1f},{z1:.1f}] "
                  f"port floor Y={y_floor:.1f}  plateau Y={y_plateau:.1f}  "
                  f"area={area_mm2:.1f}mm^2")
    return {
        "center": np.array([x_c, y_plateau, z_c]),
        "bbox_min": np.array([x0, y_floor, z0]),
        "bbox_max": np.array([x1, y_plateau, z1]),
        "area_mm2": area_mm2,
    }


def make_markers(features: dict[str, dict], radius: float = 4.0) -> trimesh.Trimesh:
    parts = []
    for name, f in features.items():
        if f is None:
            continue
        sphere = trimesh.creation.icosphere(subdivisions=2, radius=radius)
        sphere.apply_translation(f["center"])
        parts.append(sphere)
        lo, hi = f["bbox_min"], f["bbox_max"]
        extents = np.maximum(hi - lo, 0.5)
        box = trimesh.creation.box(extents=extents)
        box.apply_translation((lo + hi) / 2)
        parts.append(box)
    if not parts:
        return trimesh.Trimesh()
    return trimesh.util.concatenate(parts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=str, required=True,
                        help="Aligned STL (produced by prototype_v11_mabr.py).")
    parser.add_argument("--ejection-port", action="store_true",
                        help="Also attempt to detect ejection port (experimental).")
    args = parser.parse_args()

    console = Console()
    input_path = Path(args.input).resolve()
    stem = input_path.stem.replace("_mabr_aligned", "").replace("_mir", "")
    mesh: trimesh.Trimesh = trimesh.load_mesh(input_path, process=True)
    mesh.merge_vertices()
    console.rule(f"detect features on {input_path.name}")
    console.print(f"mesh: {len(mesh.faces):,} faces, bbox {mesh.bounds[1] - mesh.bounds[0]}")

    occ, origin = voxelize(mesh, VOXEL_PITCH_MM)
    console.print(f"voxel grid: {occ.shape}, {int(occ.sum()):,} filled, origin={origin.round(1)}")

    tg = detect_trigger_guard(occ, origin, VOXEL_PITCH_MM, console)
    ep = detect_ejection_port(occ, origin, VOXEL_PITCH_MM, console, trigger_guard=tg) if args.ejection_port else None

    markers = make_markers({"trigger_guard": tg, "ejection_port": ep})
    out = OUT_DIR / f"{stem}_feature_markers.stl"
    markers.export(out)
    console.print(f"wrote {out.relative_to(PROJECT_DIR)}  (load alongside the aligned STL)")


if __name__ == "__main__":
    main()
