"""Trigger-retention carver.

Carves a triangular indent into the cavity, anchored at the tagged trigger-
guard point. See overlay.tsx for the matching preview geometry — they share
the Feature-Local Frame convention (origin = tagged point, +X = entrance,
+Y = up, +Z = gun's left).
"""

from __future__ import annotations

import numpy as np


def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    """Inject the triangular retention wedge into `cavity_bin`.

    state   = {"enabled": bool, "points": [[x,y,z], ...], "values": {...}}
    context = {"tg": dict | None}  (auto-detected trigger guard, unused here)
    """
    v = state["values"]
    coords = state["points"][0]
    front_offset_mm = float(v.get("frontOffset", 4.0))
    length_mm = float(v.get("length", 16.0))
    width_y_mm = float(v.get("widthY", 14.0))
    depth_z_mm = float(v.get("depthZ", 4.0))
    y_offset_mm = float(v.get("yOffset", 0.0))
    rotate_deg = float(v.get("rotateZDeg", 0.0))
    corner_radius = float(v.get("cornerRadius", 0.0))
    both_sides = not bool(v.get("oneSide", False))

    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype(np.float32)
    half_w = width_y_mm / 2.0
    if length_mm <= 0 or half_w <= 0 or depth_z_mm <= 0:
        return cavity_f, origin

    tg_front_x = float(coords[0])
    anchor_x = tg_front_x + front_offset_mm
    anchor_y = float(coords[1]) + y_offset_mm
    theta = np.radians(rotate_deg)
    ct, st = np.cos(theta), np.sin(theta)

    r = min(corner_radius, half_w * 0.9, length_mm * 0.5)
    hyp = np.sqrt(half_w ** 2 + length_mm ** 2)
    n_top = np.array([half_w, length_mm]) / hyp
    n_bot = np.array([half_w, -length_mm]) / hyp

    corners_uv = [(0.0, -half_w), (0.0, half_w), (length_mm, 0.0)]
    corner_gx = [anchor_x + u * ct - v * st for (u, v) in corners_uv]
    corner_gy = [anchor_y + u * st + v * ct for (u, v) in corners_uv]
    ci_vals = [insertion_vox - 1 - (g - origin[0]) / pitch for g in corner_gx]
    j_vals = [(g - origin[1]) / pitch for g in corner_gy]
    i_lo, i_hi = max(0, int(np.floor(min(ci_vals))) - 2), min(nx - 1, int(np.ceil(max(ci_vals))) + 2)
    j_lo, j_hi = max(0, int(np.floor(min(j_vals))) - 2), min(ny - 1, int(np.ceil(max(j_vals))) + 2)

    for i in range(i_lo, i_hi + 1):
        gx = origin[0] + (insertion_vox - 1 - i) * pitch
        for j in range(j_lo, j_hi + 1):
            gy = origin[1] + (j + 0.5) * pitch
            du, dv = gx - anchor_x, gy - anchor_y
            u, vv = du * ct + dv * st, -du * st + dv * ct

            sd1 = -u + r
            sd2 = (u * n_top[0] + (vv - half_w) * n_top[1]) + r
            sd3 = (u * n_bot[0] + (vv + half_w) * n_bot[1]) + r

            d_shrunken = max(sd1, sd2, sd3)
            if r <= 0:
                dist = d_shrunken
            else:
                if d_shrunken <= 0:
                    dist = d_shrunken - r
                else:
                    dist = d_shrunken - r
                    if sd1 > 0 and sd2 > 0:
                        dist = np.sqrt(sd1 ** 2 + sd2 ** 2) - r
                    elif sd1 > 0 and sd3 > 0:
                        dist = np.sqrt(sd1 ** 2 + sd3 ** 2) - r
                    elif sd2 > 0 and sd3 > 0:
                        dist = np.sqrt(sd2 ** 2 + sd3 ** 2) - r

            if dist > 0:
                continue

            v_cov = min(1.0, abs(dist) / pitch) if dist > -pitch else 1.0
            frac = max(0.0, min(1.0, 1.0 - u / length_mm))
            depth_vox = (depth_z_mm * frac) / pitch
            z_full, z_frac = int(np.floor(depth_vox)), depth_vox - np.floor(depth_vox)

            col = cavity_bin[i, j, :]
            if not col.any():
                continue
            zs = np.where(col)[0]
            z_max, z_min = int(zs.max()), int(zs.min())

            for k_off in range(z_full + 1):
                dens = v_cov
                if k_off > depth_vox:
                    continue
                if k_off + 1 > depth_vox:
                    dens *= z_frac

                idx_pos, idx_neg = z_max - k_off, z_min + k_off
                if z_min <= idx_pos <= z_max:
                    cavity_f[i, j, idx_pos] = min(cavity_f[i, j, idx_pos], 1.0 - dens)
                if both_sides and z_min <= idx_neg <= z_max:
                    cavity_f[i, j, idx_neg] = min(cavity_f[i, j, idx_neg], 1.0 - dens)

    if console is not None:
        console.print(
            f"retention triangle: flat at anchor+{front_offset_mm}mm, "
            f"length {length_mm}mm, width {width_y_mm}mm, depth {depth_z_mm}mm, "
            f"y_offset {y_offset_mm:+.1f}mm, rotate_z {rotate_deg:+.1f}°, "
            f"{'both' if both_sides else '+Z'} sides"
        )
    return cavity_f, origin
