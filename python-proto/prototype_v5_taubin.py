"""Taubin-smooth the scan before decimating and segmenting.

Taubin smoothing ("low-pass" on a mesh) attenuates small surface variations
while preserving overall volume. More iterations = more smoothing. Unlike
pure Laplacian it does not shrink the mesh.

Pipeline:
  1. Load raw scan.
  2. Taubin-smooth N iterations.
  3. Decimate to TARGET_FACES.
  4. Run iterative RANSAC planar segmentation.
  5. Snap planar vertices onto their fitted planes.
  6. Write simplified_taubin_{N}.stl for each N.

This is the "soft" alternative to voxelization. Use the output against
simplified_snapped.stl (no smoothing) and simplified_voxel_{x}mm.stl
(hard cutoff) to pick the right spot on the smoothness dial.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
from rich.console import Console

from prototype_v3_snap import iterative_ransac, merge_planes, snap_vertices

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
INPUT_STL = PROJECT_DIR / "sig.stl"

TAUBIN_ITERS = [10, 30, 60]
TARGET_FACES = 12_000


def taubin_and_decimate(pitch_iters: int) -> trimesh.Trimesh:
    mesh = o3d.io.read_triangle_mesh(str(INPUT_STL))
    mesh.remove_duplicated_vertices()
    mesh.remove_duplicated_triangles()
    mesh.remove_degenerate_triangles()
    mesh = mesh.filter_smooth_taubin(number_of_iterations=pitch_iters)
    mesh = mesh.simplify_quadric_decimation(target_number_of_triangles=TARGET_FACES)
    mesh.compute_vertex_normals()
    out = trimesh.Trimesh(
        vertices=np.asarray(mesh.vertices),
        faces=np.asarray(mesh.triangles),
        process=True,
    )
    out.merge_vertices()
    return out


def run_one(iters: int, console: Console) -> None:
    console.rule(f"Taubin iters = {iters}")
    decim = taubin_and_decimate(iters)
    console.print(f"post-smooth+decimate: {len(decim.faces):,} faces, watertight={decim.is_watertight}")

    rng = np.random.default_rng(42)
    planes = iterative_ransac(decim, rng)
    planes = merge_planes(planes, len(decim.faces))
    covered = sum(p["area"] for p in planes) / decim.area_faces.sum()
    console.print(f"planes: {len(planes)}, coverage: {covered:.1%}")

    snapped, n_snap = snap_vertices(decim, planes)
    console.print(f"snapped {n_snap:,} / {len(decim.vertices):,} vertices")

    out = OUT_DIR / f"simplified_taubin_{iters}.stl"
    snapped.export(out)
    console.print(f"wrote {out.relative_to(PROJECT_DIR)}  watertight={snapped.is_watertight}")


def main() -> None:
    console = Console()
    for iters in TAUBIN_ITERS:
        run_one(iters, console)


if __name__ == "__main__":
    main()
