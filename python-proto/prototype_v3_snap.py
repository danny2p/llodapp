"""Apply the detected planes: snap planar-region vertices onto their fitted
plane, merge over-segmented plane duplicates, and produce a final STL that
approximates the target aesthetic.

Pipeline:
  1. Load the decimated base mesh.
  2. Iterative RANSAC planar detection (from v2).
  3. Merge near-duplicate planes (similar normal AND similar offset).
  4. Assign each face to its plane (or to "residual").
  5. For each vertex: if all touching faces belong to the same plane, project
     the vertex onto that plane. Otherwise leave it alone (boundary vertex
     or residual region).
  6. Export the snapped mesh.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh
from rich.console import Console
from rich.table import Table

OUT_DIR = Path(__file__).resolve().parent / "out"
INPUT = OUT_DIR / "raw_decim12000.stl"
OUTPUT = OUT_DIR / "simplified_snapped.stl"

NORMAL_ALIGN_MIN = 0.95
DIST_THRESHOLD_MM = 0.8
MIN_PLANE_AREA_RATIO = 0.01
MAX_PLANES = 25

# Plane-merge thresholds.
MERGE_NORMAL_DOT = 0.97        # planes with normal dot > this might merge
MERGE_OFFSET_MM = 2.0           # AND with offsets within this mm


def iterative_ransac(mesh: trimesh.Trimesh, rng: np.random.Generator) -> list[dict]:
    centroids = mesh.triangles_center
    normals = mesh.face_normals
    areas = mesh.area_faces
    total_area = areas.sum()
    unassigned = np.ones(len(mesh.faces), dtype=bool)
    planes: list[dict] = []

    for _ in range(MAX_PLANES):
        idx_pool = np.flatnonzero(unassigned)
        if len(idx_pool) == 0:
            break
        w = areas[idx_pool]
        w = w / w.sum()
        seeds = rng.choice(idx_pool, size=min(200, len(idx_pool)), p=w, replace=True)
        best_mask = np.zeros(len(mesh.faces), dtype=bool)
        best_plane = np.zeros(4)
        best_score = 0.0
        for seed in seeds:
            n = normals[seed]
            d = -np.dot(n, centroids[seed])
            align = normals @ n
            dist = np.abs(centroids @ n + d)
            inliers = unassigned & (align > NORMAL_ALIGN_MIN) & (dist < DIST_THRESHOLD_MM)
            score = areas[inliers].sum()
            if score > best_score:
                best_score = score
                best_mask = inliers
                best_plane = np.array([*n, d])
        if best_mask.any():
            pts = centroids[best_mask]
            wts = areas[best_mask]
            mean = np.average(pts, axis=0, weights=wts)
            centered = pts - mean
            weighted = centered * np.sqrt(wts)[:, None]
            _, _, vh = np.linalg.svd(weighted, full_matrices=False)
            n = vh[-1]
            if np.dot(n, best_plane[:3]) < 0:
                n = -n
            d = -np.dot(n, mean)
            best_plane = np.array([*n, d])
            align = normals @ n
            dist = np.abs(centroids @ n + d)
            best_mask = unassigned & (align > NORMAL_ALIGN_MIN) & (dist < DIST_THRESHOLD_MM)
            best_score = areas[best_mask].sum()
        if best_score / total_area < MIN_PLANE_AREA_RATIO:
            break
        planes.append({"plane": best_plane, "mask": best_mask, "area": best_score})
        unassigned &= ~best_mask

    return planes


def merge_planes(planes: list[dict], n_faces: int) -> list[dict]:
    """Merge planes whose normals are nearly parallel AND offsets are close."""
    if not planes:
        return planes
    merged: list[dict] = []
    used = [False] * len(planes)
    # Process in descending area so big planes absorb smaller duplicates.
    order = sorted(range(len(planes)), key=lambda i: -planes[i]["area"])
    for i in order:
        if used[i]:
            continue
        p_i = planes[i]
        n_i = p_i["plane"][:3]
        d_i = p_i["plane"][3]
        acc_mask = p_i["mask"].copy()
        acc_area = p_i["area"]
        used[i] = True
        for j in order:
            if used[j] or j == i:
                continue
            p_j = planes[j]
            n_j = p_j["plane"][:3]
            d_j = p_j["plane"][3]
            # Offsets only comparable when normals point the same way.
            if np.dot(n_i, n_j) > MERGE_NORMAL_DOT and abs(d_i - d_j) < MERGE_OFFSET_MM:
                acc_mask |= p_j["mask"]
                acc_area += p_j["area"]
                used[j] = True
        merged.append({"plane": p_i["plane"], "mask": acc_mask, "area": acc_area})
    return merged


def snap_vertices(mesh: trimesh.Trimesh, planes: list[dict]) -> trimesh.Trimesh:
    """Project each vertex onto its plane IF every incident face belongs to the
    same plane. Boundary vertices (on edges between planes or adjacent to the
    residual region) keep their original position.
    """
    n_faces = len(mesh.faces)
    face_plane = np.full(n_faces, -1, dtype=int)  # -1 = residual
    for idx, p in enumerate(planes):
        face_plane[p["mask"]] = idx

    # For each vertex, collect the set of plane ids of incident faces.
    vertex_faces: list[list[int]] = [[] for _ in range(len(mesh.vertices))]
    for f_idx, f in enumerate(mesh.faces):
        for v in f:
            vertex_faces[v].append(f_idx)

    new_verts = mesh.vertices.copy()
    snapped_count = 0
    for v_idx, f_list in enumerate(vertex_faces):
        plane_ids = {face_plane[f] for f in f_list}
        plane_ids.discard(-1)
        if len(plane_ids) == 1:
            # Only snap if ALL incident faces are on the same plane (no residual mixed in).
            if all(face_plane[f] != -1 for f in f_list):
                pid = next(iter(plane_ids))
                pl = planes[pid]["plane"]
                n = pl[:3]
                d = pl[3]
                # Project vertex onto plane.
                dist = np.dot(n, new_verts[v_idx]) + d
                new_verts[v_idx] = new_verts[v_idx] - dist * n
                snapped_count += 1
    return trimesh.Trimesh(vertices=new_verts, faces=mesh.faces, process=False), snapped_count


def main() -> None:
    console = Console()
    mesh: trimesh.Trimesh = trimesh.load_mesh(INPUT, process=True)
    mesh.merge_vertices()

    console.rule(f"Segmenting {INPUT.name}")
    rng = np.random.default_rng(42)
    planes = iterative_ransac(mesh, rng)
    console.print(f"detected {len(planes)} raw planes")

    planes = merge_planes(planes, len(mesh.faces))
    console.print(f"after merge: {len(planes)} planes")

    table = Table(title="Merged planes")
    for col in ("#", "normal", "offset mm", "faces", "area mm^2", "%"):
        table.add_column(col)
    total = mesh.area_faces.sum()
    for i, p in enumerate(planes):
        n = p["plane"][:3]
        d = p["plane"][3]
        table.add_row(str(i), f"[{n[0]:+.2f},{n[1]:+.2f},{n[2]:+.2f}]", f"{d:+.2f}", f"{int(p['mask'].sum()):,}", f"{p['area']:.1f}", f"{p['area']/total:.1%}")
    console.print(table)
    covered = sum(p["area"] for p in planes) / total
    console.print(f"planar coverage: {covered:.1%}")

    console.rule("Snapping vertices")
    snapped, n_snapped = snap_vertices(mesh, planes)
    console.print(f"snapped {n_snapped:,} / {len(mesh.vertices):,} vertices onto their plane")

    snapped.export(OUTPUT)
    console.print(f"\nwrote: {OUTPUT.relative_to(Path(__file__).resolve().parent.parent)}")
    console.print(f"final face count: {len(snapped.faces):,}")
    console.print(f"watertight: {snapped.is_watertight}, winding ok: {snapped.is_winding_consistent}")


if __name__ == "__main__":
    main()
