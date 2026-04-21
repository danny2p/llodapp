"""Slide-release clearance-channel carver.

Carves a channel from the tagged point toward the holster entrance (local +X).
Matches overlay.tsx geometry.
"""

from __future__ import annotations

import numpy as np


def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    v = state["values"]
    sr_coords = np.asarray(state["points"][0], dtype=float)
    width_y_mm = float(v.get("widthY", 12.0))
    depth_z_mm = float(v.get("depthZ", 6.0))
    y_offset_mm = float(v.get("yOffset", 0.0))
    chamfer_mm = float(v.get("chamfer", 0.0))

    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype("float32")

    # Linear HAS mapping: anchor voxel X is just (anchor_x - origin_x) / pitch.
    # Channel extends from the anchor toward the entrance (i decreasing).
    i_start = int(round((sr_coords[0] - origin[0]) / pitch))
    j_c = int(round((sr_coords[1] + y_offset_mm - origin[1]) / pitch))
    k_tag_vox = (sr_coords[2] - origin[2]) / pitch

    z_mid_vox = nz / 2.0
    is_positive_side = k_tag_vox > z_mid_vox

    half_w_mm = width_y_mm / 2.0
    j0 = max(0, int(np.floor(j_c - (half_w_mm / pitch))))
    j1 = min(ny - 1, int(np.ceil(j_c + (half_w_mm / pitch))))

    target_z_world = sr_coords[2] + (depth_z_mm if is_positive_side else -depth_z_mm)
    target_k_vox = (target_z_world - origin[2]) / pitch

    i_lo = max(0, min(i_start, nx - 1))
    for i in range(0, i_lo + 1):
        x_dist_mm = (i_lo - i) * pitch
        for j in range(j0, j1 + 1):
            y_dist_mm = half_w_mm - abs(j - j_c) * pitch
            min_dist_edge = min(max(0, x_dist_mm), max(0, y_dist_mm))

            local_target_k = target_k_vox
            if chamfer_mm > 0 and min_dist_edge < chamfer_mm:
                offset_vox = (chamfer_mm - min_dist_edge) / pitch
                local_target_k = target_k_vox - (offset_vox if is_positive_side else -offset_vox)

            if is_positive_side:
                k_start = int(np.floor(z_mid_vox))
                k_end_float = local_target_k
                for k in range(k_start, int(np.ceil(k_end_float)) + 1):
                    if 0 <= k < nz:
                        density = 1.0
                        if k > k_end_float:
                            continue
                        if k + 1 > k_end_float:
                            density = k_end_float - k
                        if density > cavity_f[i, j, k]:
                            cavity_f[i, j, k] = density
            else:
                k_start = int(np.ceil(z_mid_vox))
                k_end_float = local_target_k
                for k in range(int(np.floor(k_end_float)), k_start + 1):
                    if 0 <= k < nz:
                        density = 1.0
                        if k < k_end_float:
                            continue
                        if k - 1 < k_end_float:
                            density = k - k_end_float
                        if density > cavity_f[i, j, k]:
                            cavity_f[i, j, k] = density

    if console is not None:
        console.print(
            f"SR relief: width {width_y_mm}mm, depth {depth_z_mm}mm, "
            f"y_offset {y_offset_mm:+.1f}mm, chamfer {chamfer_mm}mm"
        )
    return cavity_f, origin
