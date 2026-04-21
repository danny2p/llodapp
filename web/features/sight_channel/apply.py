"""Sight Channel Carver.

Automatically centered rectangular ridge anchored at the muzzle and extending
toward the entrance (local +X in HAS). Uses the Planar Override Principle for
smooth CAD-quality surfaces.
"""

from __future__ import annotations
import numpy as np


def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype("float32")

    v = state.get("values", {})
    length_mm = float(v.get("length", 160.0))
    height_y = float(v.get("height", 10.0))
    width_z = float(v.get("width", 4.0))
    ox = float(v.get("offsetX", -19.0))
    oy = float(v.get("offsetY", 0.0))
    rz_deg = float(v.get("rotateZ", 0.0))

    height_vox = height_y / pitch
    half_w_vox = (width_z / 2.0) / pitch

    # Auto-anchor to the SLIDE plateau. For every occupied (i, k) column,
    # take the highest j that is actually filled. The slide forms one huge
    # cluster in that histogram; iron sights form tiny clusters above it.
    # We pick the mode (modal j) and then walk upward as long as neighboring
    # j-bins still hold a meaningful share of the modal count, which keeps
    # slight crowns in the slide top while rejecting sight tips.
    occupied_vox = cavity_bin > 0.5
    col_has_any = occupied_vox.any(axis=1)                            # (nx, nz)
    top_j_per_col = (ny - 1) - np.argmax(occupied_vox[:, ::-1, :], axis=1)
    top_js = top_j_per_col[col_has_any]
    if top_js.size > 0:
        unique, counts = np.unique(top_js, return_counts=True)
        mode_idx = int(np.argmax(counts))
        gun_top_j = float(unique[mode_idx])
    else:
        gun_top_j = float(ny - 1)

    # Bottom edge anchored at gun_top_j + oy; top grows upward by height.
    j_start = gun_top_j + (oy / pitch)
    target_j = j_start + height_vox

    # Lateral band: centered at world Z = 0
    k_c = -origin[2] / pitch
    k0, k1 = int(np.floor(k_c - half_w_vox)), int(np.ceil(k_c + half_w_vox))

    count = 0

    # Find the physical muzzle index (highest occupied i in HAS).
    occupied_i = np.where(cavity_bin.any(axis=(1, 2)))[0]
    muzzle_i = int(occupied_i.max()) if len(occupied_i) > 0 else nx - 1

    # Stop 2mm before the floor to prevent protrusion past the muzzle.
    safety_vox = int(np.ceil(2.0 / pitch))
    end_i = max(0, muzzle_i - safety_vox)

    length_vox = int(np.ceil(length_mm / pitch))
    start_i = max(0, end_i - length_vox)

    for i in range(start_i, end_i + 1):
        for k in range(max(0, k0), min(nz, k1 + 1)):
            k_dist = min(abs(k - k0), abs(k - k1))
            z_dens = min(1.0, k_dist)

            for j in range(max(0, int(np.floor(j_start))), min(ny, int(np.ceil(target_j)) + 1)):
                density = z_dens
                if j > target_j:
                    continue
                if j + 1 > target_j:
                    density *= (target_j - j)
                if j < j_start:
                    continue
                if j - 1 < j_start:
                    density *= (j - j_start)

                if density > cavity_f[i, j, k]:
                    cavity_f[i, j, k] = density
                    count += 1

    if console is not None:
        gun_top_world_y = origin[1] + gun_top_j * pitch
        console.print(
            f"  [blue]sight_channel[/blue]: slide_top_j={gun_top_j:.1f} "
            f"(worldY={gun_top_world_y:+.2f}mm) "
            f"added {count:,} voxels"
        )

    return cavity_f, origin
