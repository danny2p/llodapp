"""v9: swept-volume cavity with PCA-based alignment.

v8 used the scan's bounding-box axes, which only match the gun's natural
axes if the scan was already nicely oriented. When the scan is rotated,
the sweep goes through the gun at an angle and one edge of the output
appears to flare. This version fixes that by aligning the gun to its
principal axes first.

Pipeline:
  1. Load scan, merge verts.
  2. Compute PCA on vertices weighted by incident face area. PC1 = gun
     length axis, PC2 = height (slide-to-grip), PC3 = thickness.
  3. Rotate the mesh so PC1 -> +X, PC2 -> +Y, PC3 -> +Z. Right-hand
     coordinate system enforced via determinant check.
  4. Auto-flip along X so the muzzle (narrower end) is at X=0.
  5. Voxelize the aligned mesh and run the v8 sweep.
  6. Export the aligned scan (so user can sanity-check the rotation)
     alongside the sweep outputs.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import open3d as o3d
import trimesh
from rich.console import Console

PROJECT_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = Path(__file__).resolve().parent / "out"
INPUT_STL = PROJECT_DIR / "sig.stl"

VOXEL_PITCH_MM = 0.5
INSERTION_DEPTH_MM = 130.0


def pca_align_mesh(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, np.ndarray, np.ndarray]:
    """Return (aligned_mesh, rotation_matrix, translation).

    Weights each vertex by the sum of its incident face areas so dense
    triangulated regions don't bias the principal axes.
    """
    v = mesh.vertices
    # Weight vertex by 1/3 of each incident face's area.
    face_areas = mesh.area_faces
    w = np.zeros(len(v))
    for f_idx, (a, b, c) in enumerate(mesh.faces):
        aw = face_areas[f_idx] / 3.0
        w[a] += aw
        w[b] += aw
        w[c] += aw
    w = w / w.sum()

    mean = (v * w[:, None]).sum(axis=0)
    centered = v - mean

    # Weighted covariance: sum w_i * (x_i) (x_i)^T.
    cov = (centered * w[:, None]).T @ centered
    eigvals, eigvecs = np.linalg.eigh(cov)
    # eigh returns ascending eigenvalues; we want descending (largest first = PC1).
    order = np.argsort(-eigvals)
    eigvecs = eigvecs[:, order]

    # Enforce right-handed coordinate system.
    if np.linalg.det(eigvecs) < 0:
        eigvecs[:, 2] = -eigvecs[:, 2]

    # Rotation matrix that maps world coords -> PCA frame:
    #   aligned = R @ (v - mean), where R rows are PC1, PC2, PC3.
    R = eigvecs.T

    aligned_verts = (R @ centered.T).T
    aligned_mesh = trimesh.Trimesh(vertices=aligned_verts, faces=mesh.faces, process=False)
    return aligned_mesh, R, mean


def orient_muzzle_low(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Ensure the muzzle (narrower end along X) is at smaller X values.

    Compares the silhouette area in the first 10% vs the last 10% of X;
    flips along X and Y (to preserve right-handedness) if the muzzle is
    currently at high X.
    """
    xs = mesh.vertices[:, 0]
    x_min, x_max = xs.min(), xs.max()
    length = x_max - x_min
    low_thresh = x_min + 0.1 * length
    high_thresh = x_max - 0.1 * length
    head_verts = mesh.vertices[xs < low_thresh]
    tail_verts = mesh.vertices[xs > high_thresh]
    # Silhouette area approximation: bounding box of YZ coords at each end.
    head_span = (head_verts[:, 1:].max(0) - head_verts[:, 1:].min(0)).prod()
    tail_span = (tail_verts[:, 1:].max(0) - tail_verts[:, 1:].min(0)).prod()
    if head_span > tail_span:
        # Muzzle is at HIGH X; flip. Also flip Y to preserve right-handedness.
        v = mesh.vertices.copy()
        v[:, 0] = -v[:, 0]
        v[:, 1] = -v[:, 1]
        return trimesh.Trimesh(vertices=v, faces=mesh.faces, process=False)
    return mesh


def voxelize_filled(mesh: trimesh.Trimesh, pitch: float) -> tuple[np.ndarray, np.ndarray]:
    vox = mesh.voxelized(pitch=pitch).fill()
    occupancy = vox.matrix.copy()
    origin = np.asarray(vox.transform)[:3, 3].astype(float)
    return occupancy, origin


def sweep_cavity(gun_vox: np.ndarray, insertion_depth_vox: int) -> np.ndarray:
    """Swept cavity occupancy. See prototype_v8_sweep for the derivation.

    gun_vox axis 0 MUST be the gun local X axis with muzzle at index 0.
    Returns cavity[depth, y, z] where depth=0 is clay surface.
    """
    gun_len = gun_vox.shape[0]
    yz = gun_vox.shape[1:]
    limit = min(gun_len, insertion_depth_vox)

    cum = np.zeros((limit,) + yz, dtype=bool)
    running = np.zeros(yz, dtype=bool)
    for i in range(limit):
        running = running | gun_vox[i]
        cum[i] = running

    cavity = np.zeros((insertion_depth_vox,) + yz, dtype=bool)
    for x in range(insertion_depth_vox):
        idx = insertion_depth_vox - 1 - x
        cavity[x] = cum[min(idx, limit - 1)]
    return cavity


def cavity_to_mesh(cavity: np.ndarray, origin: np.ndarray, pitch: float) -> trimesh.Trimesh:
    """Marching cubes on cavity. Output mesh is in the aligned (PCA) frame:
    X = depth axis (0 = clay surface, grows with depth), YZ = transverse.
    """
    padded = np.pad(cavity, 1, mode="constant", constant_values=False)
    from skimage import measure
    verts, faces, _, _ = measure.marching_cubes(padded.astype(np.float32), level=0.5)
    verts = (verts - 1) * pitch + origin
    m = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    m.merge_vertices()
    return m


def decimate(mesh: trimesh.Trimesh, target: int) -> trimesh.Trimesh:
    tm = o3d.geometry.TriangleMesh(
        vertices=o3d.utility.Vector3dVector(mesh.vertices),
        triangles=o3d.utility.Vector3iVector(mesh.faces),
    )
    tm = tm.simplify_quadric_decimation(target_number_of_triangles=target)
    out = trimesh.Trimesh(
        vertices=np.asarray(tm.vertices),
        faces=np.asarray(tm.triangles),
        process=True,
    )
    out.merge_vertices()
    return out


def main() -> None:
    console = Console()
    raw: trimesh.Trimesh = trimesh.load_mesh(INPUT_STL, process=True)
    raw.merge_vertices()
    console.rule("Load + align")
    console.print(f"raw scan: {len(raw.faces):,} faces, bbox {raw.bounds[1] - raw.bounds[0]}")

    aligned, R, translation = pca_align_mesh(raw)
    console.print(f"PCA-aligned bbox: {aligned.bounds[1] - aligned.bounds[0]}")
    console.print(f"(length = X, height = Y, thickness = Z — if this list isn't in descending order, PCA is confused)")

    aligned = orient_muzzle_low(aligned)
    console.print(f"muzzle oriented to low X")

    aligned_out = OUT_DIR / "sig_pca_aligned.stl"
    aligned.export(aligned_out)
    console.print(f"wrote aligned scan for inspection: {aligned_out.relative_to(PROJECT_DIR)}")

    console.rule("Voxelize + sweep")
    occupancy, origin = voxelize_filled(aligned, VOXEL_PITCH_MM)
    console.print(f"voxel grid: {occupancy.shape}, {int(occupancy.sum()):,} filled")
    # occupancy is a 3D array with axis 0 = X (long axis). gun_vox = occupancy.
    insertion_vox = int(round(INSERTION_DEPTH_MM / VOXEL_PITCH_MM))
    cavity = sweep_cavity(occupancy, insertion_vox)
    console.print(f"cavity grid: {cavity.shape}, {int(cavity.sum()):,} filled")

    mesh = cavity_to_mesh(cavity, origin, VOXEL_PITCH_MM)
    console.print(f"MC mesh: {len(mesh.faces):,} faces, watertight={mesh.is_watertight}")

    full = OUT_DIR / f"swept_aligned_{int(INSERTION_DEPTH_MM)}mm_full.stl"
    mesh.export(full)
    console.print(f"wrote {full.relative_to(PROJECT_DIR)}  faces={len(mesh.faces):,}")

    for target in (8_000, 15_000, 30_000):
        dec = decimate(mesh, target)
        out = OUT_DIR / f"swept_aligned_{int(INSERTION_DEPTH_MM)}mm_decim{target}.stl"
        dec.export(out)
        console.print(f"wrote {out.relative_to(PROJECT_DIR)}  faces={len(dec.faces):,}  watertight={dec.is_watertight}")


if __name__ == "__main__":
    main()
