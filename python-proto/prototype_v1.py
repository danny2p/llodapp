"""Prototype the scan-simplification pipeline.

Starts from a noisy firearm scan STL, produces several candidate simplified
outputs, and writes them to python-proto/out/ for visual inspection in Fusion
or any STL viewer.

Pipeline (v1 concept):
  1. Sample dense points + normals on the input mesh.
  2. Reconstruct a watertight surface (Poisson, several depths).
  3. Crop Poisson's overfilled bounds back to the original bbox + a small
     margin. Poisson tends to generate outside the original convex hull.
  4. Decimate to a target face count comparable to the user's target refs
     (~7-15k faces).
  5. Also produce an alpha-shape variant for comparison.

The goal at this stage is NOT the final aesthetic — it's to confirm the
mesh cleanup step produces something usable as the input to a later planar-
segmentation pass.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
from rich.console import Console
from rich.table import Table

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
OUT_DIR.mkdir(exist_ok=True)

INPUT_STL = PROJECT_DIR / "sig.stl"
SAMPLE_POINTS = 150_000
TARGET_FACES = 12_000


def load_as_o3d(path: Path) -> o3d.geometry.TriangleMesh:
    mesh = o3d.io.read_triangle_mesh(str(path))
    mesh.remove_duplicated_vertices()
    mesh.remove_duplicated_triangles()
    mesh.remove_degenerate_triangles()
    mesh.compute_vertex_normals()
    return mesh


def sample_points(mesh: o3d.geometry.TriangleMesh, n: int) -> o3d.geometry.PointCloud:
    pcd = mesh.sample_points_poisson_disk(number_of_points=n, init_factor=5)
    pcd.estimate_normals(search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=2.0, max_nn=30))
    pcd.orient_normals_consistent_tangent_plane(k=20)
    return pcd


def poisson_reconstruct(pcd: o3d.geometry.PointCloud, depth: int) -> o3d.geometry.TriangleMesh:
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
        pcd, depth=depth, linear_fit=False
    )
    # Poisson overshoots past the point cloud — trim low-density vertices.
    densities = np.asarray(densities)
    keep = densities > np.quantile(densities, 0.02)
    mesh.remove_vertices_by_mask(~keep)
    mesh.remove_degenerate_triangles()
    mesh.remove_unreferenced_vertices()
    return mesh


def crop_to_bbox(mesh: o3d.geometry.TriangleMesh, reference: o3d.geometry.TriangleMesh, margin_mm: float = 1.0) -> o3d.geometry.TriangleMesh:
    ref_bbox = reference.get_axis_aligned_bounding_box()
    min_b = ref_bbox.min_bound - margin_mm
    max_b = ref_bbox.max_bound + margin_mm
    crop = o3d.geometry.AxisAlignedBoundingBox(min_b, max_b)
    return mesh.crop(crop)


def decimate(mesh: o3d.geometry.TriangleMesh, target: int) -> o3d.geometry.TriangleMesh:
    return mesh.simplify_quadric_decimation(target_number_of_triangles=target)


def alpha_shape(pcd: o3d.geometry.PointCloud, alpha_mm: float) -> o3d.geometry.TriangleMesh:
    return o3d.geometry.TriangleMesh.create_from_point_cloud_alpha_shape(pcd, alpha=alpha_mm)


def save(mesh: o3d.geometry.TriangleMesh, name: str) -> Path:
    path = OUT_DIR / f"{name}.stl"
    mesh.compute_vertex_normals()
    o3d.io.write_triangle_mesh(str(path), mesh)
    return path


def describe(path: Path) -> dict:
    m = trimesh.load_mesh(path, process=False)
    return {
        "faces": len(m.faces),
        "verts": len(m.vertices),
        "watertight": m.is_watertight,
    }


def main() -> None:
    console = Console()
    console.rule(f"Loading {INPUT_STL.name}")
    scan = load_as_o3d(INPUT_STL)
    console.print(f"input: {len(scan.triangles):,} faces, {len(scan.vertices):,} verts")

    console.rule("Sampling points")
    pcd = sample_points(scan, SAMPLE_POINTS)
    console.print(f"sampled: {len(pcd.points):,} points with normals")

    outputs: list[tuple[str, Path]] = []

    # Poisson reconstruction at two depths. Higher depth = more detail = slower.
    for depth in (8, 9):
        console.rule(f"Poisson depth={depth}")
        p = poisson_reconstruct(pcd, depth=depth)
        p = crop_to_bbox(p, scan, margin_mm=1.0)
        d = decimate(p, TARGET_FACES)
        outputs.append((f"poisson_d{depth}_decim{TARGET_FACES}", save(d, f"poisson_d{depth}_decim{TARGET_FACES}")))

    # Alpha shape variants.
    for alpha_mm in (1.5, 3.0):
        console.rule(f"Alpha shape alpha={alpha_mm}mm")
        try:
            a = alpha_shape(pcd, alpha_mm)
            d = decimate(a, TARGET_FACES)
            outputs.append((f"alpha_{alpha_mm}mm_decim{TARGET_FACES}", save(d, f"alpha_{alpha_mm}mm_decim{TARGET_FACES}")))
        except Exception as e:
            console.print(f"alpha {alpha_mm}mm failed: {e}")

    # Pure decimation of the raw scan (baseline for comparison).
    console.rule("Baseline: pure decimation of raw scan")
    d = decimate(scan, TARGET_FACES)
    outputs.append((f"raw_decim{TARGET_FACES}", save(d, f"raw_decim{TARGET_FACES}")))

    # Summary.
    table = Table(title="Prototype v1 outputs")
    for col in ("variant", "faces", "verts", "watertight", "file"):
        table.add_column(col)
    for name, path in outputs:
        s = describe(path)
        table.add_row(name, f"{s['faces']:,}", f"{s['verts']:,}", "yes" if s["watertight"] else "NO", str(path.relative_to(PROJECT_DIR)))
    console.print(table)


if __name__ == "__main__":
    main()
