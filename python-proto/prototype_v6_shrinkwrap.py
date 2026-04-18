"""Morphological closing: the "thick shrink wrap" preprocessing step.

Concept: imagine vacuum-forming a thick rubber sheet over the firearm. Fine
gaps (slide serrations, ~0.3-0.5mm wide) get bridged by the sheet because
the sheet can't conform to them. Larger features (sights, slide release,
trigger guard) still deform the sheet.

Implementation:
  1. Voxelize the scan at pitch P mm into a binary occupancy grid.
  2. Fill the interior so we have a solid.
  3. Binary dilate by K voxels (expands outward by K*P mm).
  4. Binary erode by K voxels (contracts back by K*P mm).
     Step 3+4 = "morphological closing" at radius K*P mm. Gaps narrower
     than 2*K*P mm get permanently bridged.
  5. Marching-cubes to extract a watertight surface.
  6. Light Taubin smoothing to wash out marching-cubes staircase.
  7. Decimate to target face count.

Output: several closing radii so user can pick the right aggressiveness.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
from rich.console import Console
from scipy.ndimage import binary_dilation, binary_erosion, generate_binary_structure

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
INPUT_STL = PROJECT_DIR / "sig.stl"

VOXEL_PITCH_MM = 0.5          # finer pitch preserves curve quality
CLOSING_RADII_MM = [1.5, 2.5, 3.5]
TARGET_FACES = 12_000


def voxelize_filled(mesh: trimesh.Trimesh, pitch: float) -> tuple[np.ndarray, np.ndarray]:
    """Voxelize the mesh and fill the interior. Returns (occupancy_grid,
    origin_xyz_mm). The occupancy grid is a 3D boolean array."""
    vox = mesh.voxelized(pitch=pitch).fill()
    # trimesh's VoxelGrid exposes dense boolean via .matrix.
    occupancy = vox.matrix.copy()
    # Origin = voxel (0,0,0) center in world coords = translation of transform.
    origin = np.asarray(vox.transform)[:3, 3].astype(float)
    return occupancy, origin


def morphological_close(grid: np.ndarray, k_voxels: int) -> np.ndarray:
    """Dilate by K, then erode by K. Ball-shaped structuring element.

    Pad by K+1 first so the dilation isn't clipped at grid boundaries,
    then strip the padding back off.
    """
    struct = generate_binary_structure(3, 1)  # 6-connected
    pad = k_voxels + 1
    padded = np.pad(grid, pad, mode="constant", constant_values=False)
    dilated = binary_dilation(padded, structure=struct, iterations=k_voxels)
    closed = binary_erosion(dilated, structure=struct, iterations=k_voxels)
    return closed[pad:-pad, pad:-pad, pad:-pad]


def grid_to_mesh(grid: np.ndarray, origin: np.ndarray, pitch: float) -> trimesh.Trimesh:
    """Marching-cubes over the occupancy grid. Output mesh is in world mm."""
    # Pad by 1 voxel so marching cubes closes surfaces at the boundary.
    padded = np.pad(grid, 1, mode="constant", constant_values=False)
    from skimage import measure
    # level=0.5 for binary occupancy (inside > 0.5, outside < 0.5).
    verts, faces, _, _ = measure.marching_cubes(padded.astype(np.float32), level=0.5)
    # Undo padding, convert voxel indices to world coords.
    verts = (verts - 1) * pitch + origin
    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    mesh.merge_vertices()
    return mesh


def taubin_smooth(mesh: trimesh.Trimesh, iters: int = 20) -> trimesh.Trimesh:
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


def run_one(radius_mm: float, occupancy: np.ndarray, origin: np.ndarray, console: Console) -> None:
    k = max(1, int(round(radius_mm / VOXEL_PITCH_MM)))
    actual_radius = k * VOXEL_PITCH_MM
    console.rule(f"Morphological close radius = {actual_radius:.1f}mm (k={k} voxels)")

    closed = morphological_close(occupancy, k)
    added = int(closed.sum() - occupancy.sum())
    console.print(f"voxels after close: {int(closed.sum()):,} ({added:+,} vs. input)")

    mesh = grid_to_mesh(closed, origin, VOXEL_PITCH_MM)
    console.print(f"marching cubes: {len(mesh.faces):,} faces, watertight={mesh.is_watertight}")

    smoothed = taubin_smooth(mesh, iters=20)
    console.print(f"after Taubin smooth: {len(smoothed.faces):,} faces")

    decim = decimate(smoothed, TARGET_FACES)
    console.print(f"after decimate: {len(decim.faces):,} faces, watertight={decim.is_watertight}")

    name = f"shrinkwrap_{actual_radius:.1f}mm"
    out_path = OUT_DIR / f"{name}.stl"
    decim.export(out_path)
    console.print(f"wrote {out_path.relative_to(PROJECT_DIR)}")


def main() -> None:
    console = Console()
    console.rule("Loading and voxelizing raw scan")
    raw: trimesh.Trimesh = trimesh.load_mesh(INPUT_STL, process=True)
    raw.merge_vertices()
    console.print(f"raw scan: {len(raw.faces):,} faces, bbox {raw.bounds[1] - raw.bounds[0]}")

    console.print(f"voxelizing at {VOXEL_PITCH_MM}mm pitch...")
    occupancy, origin = voxelize_filled(raw, VOXEL_PITCH_MM)
    console.print(f"occupancy grid: {occupancy.shape} = {occupancy.size:,} voxels, {int(occupancy.sum()):,} filled")

    for r in CLOSING_RADII_MM:
        run_one(r, occupancy, origin, console)


if __name__ == "__main__":
    main()
