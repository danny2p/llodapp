"""Merge placed accessories into a mold half STL.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import trimesh


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=str, required=True, help="Base mold half STL.")
    parser.add_argument("--full", type=str, required=True, help="Full mold STL (to calculate center).")
    parser.add_argument("--accessories", type=str, required=True, help="JSON string of accessories.")
    parser.add_argument("--out", type=str, required=True, help="Output STL path.")
    parser.add_argument("--accessories-dir", type=str, required=True, help="Directory where accessory STLs are stored.")
    args = parser.parse_args()

    base_mesh = trimesh.load_mesh(args.base)
    full_mesh = trimesh.load_mesh(args.full)
    
    # Calculate center exactly like Three.js computeBoundingBox().getCenter()
    # trimesh.bounds is [min, max] where each is [x, y, z]
    bounds = full_mesh.bounds
    center = (bounds[0] + bounds[1]) / 2.0
    
    accessories = json.loads(args.accessories)
    acc_dir = Path(args.accessories_dir)
    
    meshes_to_merge = [base_mesh]
    
    for acc in accessories:
        acc_path = acc_dir / acc["name"]
        if not acc_path.exists():
            print(f"Warning: Accessory not found at {acc_path}")
            continue
            
        acc_mesh = trimesh.load_mesh(acc_path)
        
        # 1. Center the accessory (like Three.js STLLoader might not, but Scene.tsx does g.center())
        # g.center() in Three.js centers the geometry around the origin.
        acc_mesh.apply_translation(-acc_mesh.centroid)
        
        # 2. Scale
        scale = acc.get("scale", 1.0)
        if scale != 1.0:
            acc_mesh.apply_scale(scale)
            
        # 3. Rotate
        rot = acc.get("rotation", [0, 0, 0])
        euler = [
            (rot[0] + 90) * np.pi / 180.0,
            rot[1] * np.pi / 180.0,
            rot[2] * np.pi / 180.0
        ]
        matrix = trimesh.transformations.euler_matrix(euler[0], euler[1], euler[2], 'sxyz')
        acc_mesh.apply_transform(matrix)
        
        # 4. Translate
        # acc["position"] is in world space.
        pos = np.array(acc.get("position", [0, 0, 0]))
        acc_mesh.apply_translation(pos)
        
        meshes_to_merge.append(acc_mesh)
        
    merged = trimesh.util.concatenate(meshes_to_merge)
    merged.export(args.out)
    print(f"Exported merged STL to {args.out}")


if __name__ == "__main__":
    main()
