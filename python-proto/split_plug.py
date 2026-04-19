"""Split a cavity plug STL into watertight left/right halves at Z=0.

Decimation upstream can leave the plug non-watertight, and trimesh's
built-in `cap=True` triangulation doesn't always produce a seam that
shares vertices with the sliced boundary. So we slice uncapped, then
manually triangulate the z=0 boundary rings with mapbox-earcut using
the existing slice-edge vertices. That guarantees the cap's edges are
shared with the side wall.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

import mapbox_earcut as earcut
import numpy as np
import trimesh
from rich.console import Console
from shapely.geometry import Polygon
from trimesh.grouping import group_rows


Z_TOL = 1e-3


def _trace_loops(edges: np.ndarray) -> list[list[int]]:
    """Walk a set of boundary edges into closed vertex loops."""
    adj: dict[int, list[int]] = defaultdict(list)
    for a, b in edges:
        adj[int(a)].append(int(b))
        adj[int(b)].append(int(a))

    visited: set[tuple[int, int]] = set()

    def ekey(a: int, b: int) -> tuple[int, int]:
        return (a, b) if a < b else (b, a)

    loops: list[list[int]] = []
    for a0, b0 in edges:
        a0, b0 = int(a0), int(b0)
        if ekey(a0, b0) in visited:
            continue
        visited.add(ekey(a0, b0))
        loop = [a0, b0]
        prev, curr = a0, b0
        while curr != a0:
            nxts = [n for n in adj[curr] if n != prev and ekey(curr, n) not in visited]
            if not nxts:
                break
            nxt = nxts[0]
            visited.add(ekey(curr, nxt))
            loop.append(nxt)
            prev, curr = curr, nxt
        if loop[-1] == loop[0]:
            loop = loop[:-1]
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def cap_at_z0(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Close the z=0 opening by triangulating its boundary loop(s)."""
    mesh = mesh.copy()
    mesh.merge_vertices()
    edges_sorted = mesh.edges_sorted
    boundary_idx = group_rows(edges_sorted, require_count=1)
    if len(boundary_idx) == 0:
        return mesh

    boundary_edges = edges_sorted[boundary_idx]
    v = mesh.vertices
    on_plane = np.all(np.abs(v[boundary_edges][..., 2]) < Z_TOL, axis=1)
    cap_edges = boundary_edges[on_plane]
    if len(cap_edges) == 0:
        return mesh

    loops = _trace_loops(cap_edges)
    if not loops:
        return mesh

    # Classify loops into outers and holes by containment.
    polys = []
    for loop in loops:
        pts = v[loop][:, :2]
        poly = Polygon(pts)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty or poly.area < 1e-9:
            continue
        polys.append({"loop": loop, "pts": pts, "poly": poly})

    if not polys:
        return mesh

    polys.sort(key=lambda p: -p["poly"].area)
    parent = [-1] * len(polys)
    for i, pi in enumerate(polys):
        for j in range(i):
            if polys[j]["poly"].contains(pi["poly"]):
                parent[i] = j
    depth = [0] * len(polys)
    for i in range(len(polys)):
        p = parent[i]
        while p != -1:
            depth[i] += 1
            p = parent[p]

    new_faces: list[np.ndarray] = []
    for i, pi in enumerate(polys):
        if depth[i] % 2 == 1:
            continue
        ring_pts = [pi["pts"]]
        ring_idx = [np.asarray(pi["loop"], dtype=np.int64)]
        for j, pj in enumerate(polys):
            if parent[j] == i:
                ring_pts.append(pj["pts"])
                ring_idx.append(np.asarray(pj["loop"], dtype=np.int64))
        flat = np.vstack(ring_pts).astype(np.float64)
        rings = np.cumsum([len(r) for r in ring_pts]).astype(np.uint32)
        tris = earcut.triangulate_float64(flat, rings).reshape(-1, 3)
        if len(tris) == 0:
            continue
        all_idx = np.concatenate(ring_idx)
        new_faces.append(all_idx[tris])

    if not new_faces:
        return mesh

    combined = trimesh.Trimesh(
        vertices=mesh.vertices,
        faces=np.vstack([mesh.faces, *new_faces]),
        process=False,
    )
    combined.merge_vertices()
    return combined


def split_at_z0(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, trimesh.Trimesh]:
    mesh = mesh.copy()
    # Aggressive manifold repair
    mesh.merge_vertices()
    mesh.update_faces(mesh.nondegenerate_faces())
    mesh.update_faces(mesh.unique_faces())
    mesh.fill_holes()
    
    # Slice and cap
    # Using cap=True with a manifold input is the most reliable path.
    right = trimesh.intersections.slice_mesh_plane(
        mesh, plane_normal=[0, 0, 1], plane_origin=[0, 0, 0], cap=True
    )
    left = trimesh.intersections.slice_mesh_plane(
        mesh, plane_normal=[0, 0, -1], plane_origin=[0, 0, 0], cap=True
    )
    
    # Final post-process to ensure slicers are happy
    for half in (left, right):
        half.merge_vertices()
        half.update_faces(half.nondegenerate_faces())
        half.fix_normals()
        half.fill_holes()
    
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
