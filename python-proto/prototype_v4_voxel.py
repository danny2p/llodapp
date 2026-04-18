"""Add a voxelize-then-remesh preprocessing step to kill fine details.

Voxelizing at pitch P means: any feature narrower than ~P mm disappears
entirely. Slide serrations (~0.3mm), grip texturing (~0.5mm), small
engravings all get erased. Sights (~5mm) and controls (~3-5mm) survive.

Pipeline per voxel size:
  1. Voxelize the raw scan at the chosen pitch.
  2. Fill interior voxels, then marching-cubes back to a mesh.
  3. Decimate to ~12k faces.
  4. RANSAC planes + snap vertices (reuses v3 logic).
  5. Write the result as simplified_voxel_{pitch}mm.stl.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh
from rich.console import Console

from prototype_v3_snap import iterative_ransac, merge_planes, snap_vertices

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
INPUT_STL = PROJECT_DIR / "sig.stl"

VOXEL_PITCHES_MM = [0.8, 1.5, 2.5]
TARGET_FACES = 12_000


def voxelize_and_remesh(mesh: trimesh.Trimesh, pitch: float) -> trimesh.Trimesh:
    """Voxelize surface, fill interior, marching-cubes back to a mesh.

    Filling the interior turns a surface occupancy grid into a solid, which
    makes marching cubes output a clean watertight shell.
    """
    vox = mesh.voxelized(pitch=pitch)
    vox = vox.fill()
    remeshed = vox.marching_cubes
    remeshed.merge_vertices()
    remeshed.update_faces(remeshed.unique_faces())
    remeshed.remove_unreferenced_vertices()
    return remeshed


def decimate_trimesh(mesh: trimesh.Trimesh, target: int) -> trimesh.Trimesh:
    """Use Open3D's quadric decimation via round-trip (trimesh's own decimator
    requires blender/fast-simplification; Open3D is already a dep)."""
    import open3d as o3d
    tm = o3d.geometry.TriangleMesh(
        vertices=o3d.utility.Vector3dVector(mesh.vertices),
        triangles=o3d.utility.Vector3iVector(mesh.faces),
    )
    tm = tm.simplify_quadric_decimation(target_number_of_triangles=target)
    v = np.asarray(tm.vertices)
    f = np.asarray(tm.triangles)
    out = trimesh.Trimesh(vertices=v, faces=f, process=True)
    out.merge_vertices()
    return out


def run_one(pitch: float, console: Console) -> None:
    console.rule(f"Voxel pitch = {pitch} mm")
    raw: trimesh.Trimesh = trimesh.load_mesh(INPUT_STL, process=True)
    raw.merge_vertices()
    console.print(f"raw scan: {len(raw.faces):,} faces")

    remeshed = voxelize_and_remesh(raw, pitch)
    console.print(f"post-voxel remesh: {len(remeshed.faces):,} faces, watertight={remeshed.is_watertight}")

    decim = decimate_trimesh(remeshed, TARGET_FACES)
    console.print(f"post-decimate: {len(decim.faces):,} faces, watertight={decim.is_watertight}")

    rng = np.random.default_rng(42)
    planes = iterative_ransac(decim, rng)
    planes = merge_planes(planes, len(decim.faces))
    covered = sum(p["area"] for p in planes) / decim.area_faces.sum()
    console.print(f"planes: {len(planes)}, coverage: {covered:.1%}")

    snapped, n_snap = snap_vertices(decim, planes)
    console.print(f"snapped {n_snap:,} / {len(decim.vertices):,} vertices")

    out = OUT_DIR / f"simplified_voxel_{pitch}mm.stl"
    snapped.export(out)
    console.print(f"wrote {out.relative_to(PROJECT_DIR)}  watertight={snapped.is_watertight}")

    # Also write the pre-segmentation remeshed version, for comparison
    # ("what does the voxel step alone do?").
    pre = OUT_DIR / f"voxel_only_{pitch}mm.stl"
    decim.export(pre)
    console.print(f"wrote {pre.relative_to(PROJECT_DIR)}  (voxel+decimate, no plane snap)")


def main() -> None:
    console = Console()
    for pitch in VOXEL_PITCHES_MM:
        run_one(pitch, console)


if __name__ == "__main__":
    main()
