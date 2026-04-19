"""Split a cavity plug STL into watertight left/right halves at Z=0.

Fills holes in the input mesh first (marching-cubes + decimation sometimes
leaves pinhole gaps), then slices at Z=0 with a flat cap on each half so
both output STLs are closed, flat-backed solids.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import trimesh
from rich.console import Console


def split_at_z0(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, trimesh.Trimesh]:
    mesh = mesh.copy()
    # Ensure mesh is cleaned up before splitting
    mesh.merge_vertices()
    mesh.remove_degenerate_faces()
    mesh.remove_duplicate_faces()
    
    # Fill holes to make it watertight. Marching cubes should be watertight
    # but decimation can sometimes leave pinholes.
    mesh.fill_holes()
    
    # Cap=True requires a closed manifold mesh to work reliably.
    right = trimesh.intersections.slice_mesh_plane(
        mesh, plane_normal=[0, 0, 1], plane_origin=[0, 0, 0], cap=True
    )
    left = trimesh.intersections.slice_mesh_plane(
        mesh, plane_normal=[0, 0, -1], plane_origin=[0, 0, 0], cap=True
    )
    
    # Post-process halves to ensure normals are outward-facing and surfaces are closed
    for half in (left, right):
        half.merge_vertices()
        half.remove_degenerate_faces()
        half.fix_normals()
        half.fill_holes() # Fill any holes left by the slicer
    
    return left, right


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=str, required=True, help="Plug STL to split.")
    parser.add_argument("--out-dir", type=str, default=None,
                        help="Directory for outputs (defaults to the input's directory).")
    args = parser.parse_args()

    console = Console()
    in_path = Path(args.input).resolve()
    out_dir = Path(args.out_dir).resolve() if args.out_dir else in_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    m = trimesh.load_mesh(in_path, process=True)
    m.merge_vertices()
    console.print(f"input: {in_path.name}  {len(m.faces):,} faces  watertight={m.is_watertight}")

    left, right = split_at_z0(m)
    stem = in_path.stem.replace("_swept", "").replace("_mabr", "").replace("_mir_ret", "")
    for name, half in (("left", left), ("right", right)):
        out = out_dir / f"{stem}_{name}.stl"
        half.export(out)
        console.print(
            f"  {name}: {len(half.faces):,} faces  watertight={half.is_watertight}  "
            f"z=[{half.bounds[0,2]:.2f},{half.bounds[1,2]:.2f}]  -> {out.name}"
        )


if __name__ == "__main__":
    main()
