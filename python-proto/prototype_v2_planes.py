"""Iterative RANSAC planar segmentation on the decimated scan.

Goal: detect large flat regions (slide sides, grip panels, frame faces) on
the cleaned mesh so we can eventually snap those regions onto fitted planes
and produce the "simplified flat-plane" aesthetic from the glock target
files.

Approach:
  - Use face centroids + face normals as the segmentation primitive.
  - Iteratively fit planes: at each step, find the plane that maximises a
    score that weights face area AND normal alignment.
  - Stop when the next-best plane is too small or we hit max_planes.
  - Color the mesh by plane membership and write a PLY (STL can't carry
    face colors). Also write each plane as its own STL for inspection.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
from rich.console import Console
from rich.table import Table

OUT_DIR = Path(__file__).resolve().parent / "out"
INPUT = OUT_DIR / "raw_decim12000.stl"

NORMAL_ALIGN_MIN = 0.95       # face normal dot plane normal threshold
DIST_THRESHOLD_MM = 0.8        # face centroid max signed distance from plane
MIN_PLANE_AREA_RATIO = 0.01    # stop when next plane covers < 1% of total area
MAX_PLANES = 20


def face_props(mesh: trimesh.Trimesh) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    centroids = mesh.triangles_center
    normals = mesh.face_normals
    areas = mesh.area_faces
    return centroids, normals, areas


def fit_best_plane(centroids: np.ndarray, normals: np.ndarray, areas: np.ndarray, unassigned: np.ndarray, n_iters: int = 200, rng: np.random.Generator | None = None) -> tuple[np.ndarray, np.ndarray, float]:
    """RANSAC: sample a seed face, use its normal as the plane normal, compute
    the offset, score inliers weighted by area. Returns (best_inliers_mask,
    best_plane[a,b,c,d], best_score).
    """
    rng = rng or np.random.default_rng(0)
    idx_pool = np.flatnonzero(unassigned)
    if len(idx_pool) == 0:
        return np.zeros(len(centroids), dtype=bool), np.zeros(4), 0.0

    # Weight seed sampling by area so large planes surface first.
    weights = areas[idx_pool]
    weights = weights / weights.sum()
    seeds = rng.choice(idx_pool, size=min(n_iters, len(idx_pool)), p=weights, replace=True)

    best_mask = np.zeros(len(centroids), dtype=bool)
    best_plane = np.zeros(4)
    best_score = 0.0

    for seed in seeds:
        n = normals[seed]
        d = -np.dot(n, centroids[seed])
        # Inlier test: face normal aligned with plane normal AND close to plane.
        align = normals @ n
        dist = np.abs(centroids @ n + d)
        inliers = unassigned & (align > NORMAL_ALIGN_MIN) & (dist < DIST_THRESHOLD_MM)
        score = areas[inliers].sum()
        if score > best_score:
            best_score = score
            best_mask = inliers
            best_plane = np.array([*n, d])

    # Refit plane to final inlier set (least-squares) to reduce seed bias.
    if best_mask.any():
        pts = centroids[best_mask]
        w = areas[best_mask]
        centroid_mean = np.average(pts, axis=0, weights=w)
        centered = pts - centroid_mean
        # Weighted SVD: the smallest singular vector is the plane normal.
        weighted = centered * np.sqrt(w)[:, None]
        _, _, vh = np.linalg.svd(weighted, full_matrices=False)
        n = vh[-1]
        # Keep normal in the hemisphere of the seed's normal (consistency).
        if np.dot(n, best_plane[:3]) < 0:
            n = -n
        d = -np.dot(n, centroid_mean)
        best_plane = np.array([*n, d])
        # Re-evaluate inliers with the refined plane.
        align = normals @ n
        dist = np.abs(centroids @ n + d)
        best_mask = unassigned & (align > NORMAL_ALIGN_MIN) & (dist < DIST_THRESHOLD_MM)
        best_score = areas[best_mask].sum()

    return best_mask, best_plane, best_score


def palette(n: int) -> np.ndarray:
    import colorsys
    return np.array([
        colorsys.hsv_to_rgb((i * 0.6180339887) % 1.0, 0.70, 0.92)
        for i in range(n)
    ])


def main() -> None:
    console = Console()
    if not INPUT.exists():
        console.print(f"[red]Missing input: {INPUT}. Run prototype_v1.py first.[/red]")
        return

    mesh: trimesh.Trimesh = trimesh.load_mesh(INPUT, process=True)
    mesh.merge_vertices()
    centroids, normals, areas = face_props(mesh)
    total_area = areas.sum()
    unassigned = np.ones(len(mesh.faces), dtype=bool)
    rng = np.random.default_rng(42)

    console.rule(f"Iterative RANSAC on {INPUT.name}")
    console.print(f"faces: {len(mesh.faces):,}, total area: {total_area:.1f} mm^2")

    planes: list[dict] = []
    for i in range(MAX_PLANES):
        mask, plane, score = fit_best_plane(centroids, normals, areas, unassigned, rng=rng)
        ratio = score / total_area
        if ratio < MIN_PLANE_AREA_RATIO:
            console.print(f"stopping: plane {i} area ratio {ratio:.3%} below threshold")
            break
        n_faces = int(mask.sum())
        planes.append({"plane": plane, "mask": mask, "area": score, "ratio": ratio, "n_faces": n_faces})
        unassigned = unassigned & ~mask
        console.print(f"plane {i}: n=[{plane[0]:+.2f},{plane[1]:+.2f},{plane[2]:+.2f}] d={plane[3]:+.2f}  faces={n_faces:,}  area={score:.1f}mm^2 ({ratio:.1%})")

    table = Table(title=f"Detected planes ({len(planes)} planes found)")
    for col in ("#", "normal", "offset mm", "faces", "area mm^2", "% of total"):
        table.add_column(col)
    for i, p in enumerate(planes):
        n = p["plane"][:3]
        d = p["plane"][3]
        table.add_row(str(i), f"[{n[0]:+.2f},{n[1]:+.2f},{n[2]:+.2f}]", f"{d:+.2f}", f"{p['n_faces']:,}", f"{p['area']:.1f}", f"{p['ratio']:.1%}")
    console.print(table)

    # Coverage summary.
    covered = sum(p["area"] for p in planes)
    console.print(f"\ntotal planar coverage: {covered / total_area:.1%} of mesh area")
    console.print(f"residual (protrusions / non-planar): {1 - covered / total_area:.1%}")

    # Write colored PLY for visualisation.
    colors = np.full((len(mesh.faces), 3), 0.5)
    pal = palette(len(planes))
    for i, p in enumerate(planes):
        colors[p["mask"]] = pal[i]
    mesh.visual.face_colors = np.concatenate([colors, np.ones((len(colors), 1))], axis=1)
    out_ply = OUT_DIR / "planes_colored.ply"
    mesh.export(out_ply)
    console.print(f"\nwrote colored mesh: {out_ply.relative_to(Path(__file__).resolve().parent.parent)}")

    # Also write each plane's faces as a separate STL (for picking apart in Fusion).
    per_plane_dir = OUT_DIR / "planes"
    per_plane_dir.mkdir(exist_ok=True)
    for old in per_plane_dir.glob("*.stl"):
        old.unlink()
    for i, p in enumerate(planes):
        sub = mesh.submesh([np.flatnonzero(p["mask"])], append=True)
        sub.export(per_plane_dir / f"plane_{i:02d}.stl")
    # Residual = whatever wasn't assigned.
    if unassigned.any():
        sub = mesh.submesh([np.flatnonzero(unassigned)], append=True)
        sub.export(per_plane_dir / "residual.stl")
    console.print(f"wrote per-plane STLs: {per_plane_dir.relative_to(Path(__file__).resolve().parent.parent)}/")


if __name__ == "__main__":
    main()
