"""Gun Band (gun_band) — voxel carver.

p0 and p1 define the *leading diagonal edge* of the band.  The band
extends `width` mm along World X (short sides parallel to X).

PLANAR OVERRIDE: front face is a single flat absolute Z plane
(mean of p0.z and p1.z + depthZ). No surface texture is projected.

Z extents — one solid block per column:
  Back face  : Z=0 (midplane), always flat.
  Front face : z_front_plane (flat), chamfered near ends.

Chamfer params:
  chamfer      — length along the edge over which the ramp runs (mm).
  chamferDepth — how far back in Z the front face drops at the tip (mm).
                 0 = no Z drop (no chamfer effect).
                 Equal to depthZ = full diagonal to the midplane.
                 Values between give a shallower bevel.
"""

from __future__ import annotations

import numpy as np


def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    vals   = state.get("values", {})
    points = state.get("points", [])

    if len(points) < 2:
        if console:
            console.print("[yellow]gun_band: need 2 points — skipping[/yellow]")
        return cavity_bin.astype("float32"), origin

    cavity_f = cavity_bin.astype("float32")

    # ── Parameters ──────────────────────────────────────────────────────────
    width         = float(vals.get("width",         20.0))
    depth_z       = float(vals.get("depthZ",        10.0))
    extend_top    = float(vals.get("extendTop",     12.0))
    extend_bot    = float(vals.get("extendBottom",   0.0))
    offset_x      = float(vals.get("offsetX",        0.0))
    offset_y      = float(vals.get("offsetY",        0.0))
    chamfer       = float(vals.get("chamfer",        1.0))
    chamfer_depth = float(vals.get("chamferDepth",  10.0))
    # Clamp chamfer_depth to the total band thickness (depthZ is proud portion,
    # but full Z thickness from midplane can be larger; cap at a safe value)
    chamfer_depth = max(0.0, chamfer_depth)

    # ── Anchor points with offset ────────────────────────────────────────────
    p0_raw = np.asarray(points[0], dtype=float) + np.array([offset_x, offset_y, 0.0])
    p1_raw = np.asarray(points[1], dtype=float) + np.array([offset_x, offset_y, 0.0])

    edge_vec_raw = p1_raw - p0_raw
    edge_len_raw = float(np.linalg.norm(edge_vec_raw))
    if edge_len_raw < 1e-6:
        if console:
            console.print("[yellow]gun_band: p0 == p1 — skipping[/yellow]")
        return cavity_f, origin

    edge_dir = edge_vec_raw / edge_len_raw

    # Apply extensions
    p0 = p0_raw - edge_dir * extend_top
    p1 = p1_raw + edge_dir * extend_bot

    edge_vec = p1 - p0
    edge_len = float(np.linalg.norm(edge_vec))
    edge_dir = edge_vec / edge_len
    dy_edge  = float(p1[1] - p0[1])
    dx_edge  = float(p1[0] - p0[0])

    # ── Midplane ─────────────────────────────────────────────────────────────
    nx_v, ny_v, nz_v = cavity_f.shape
    k_mid_f = -origin[2] / pitch

    z_mid_pts   = (p0[2] + p1[2]) / 2.0
    is_positive = z_mid_pts >= 0.0
    z_sign      = 1.0 if is_positive else -1.0

    # ── Flat front face plane (Planar Override) ───────────────────────────────
    z_mean        = (p0_raw[2] + p1_raw[2]) / 2.0
    z_front_plane = z_mean + z_sign * depth_z
    k_front_plane = (z_front_plane - origin[2]) / pitch

    # The Z target at the very tip of the chamfer:
    # drop back from the front plane by chamfer_depth (in Z, outward direction)
    z_tip_plane = z_front_plane - z_sign * chamfer_depth
    k_tip_plane = (z_tip_plane - origin[2]) / pitch

    # ── Bounding box ─────────────────────────────────────────────────────────
    x_min = min(p0[0], p1[0]) - width
    x_max = max(p0[0], p1[0])
    y_min = min(p0[1], p1[1])
    y_max = max(p0[1], p1[1])

    def world_to_i(wx): return (wx - origin[0]) / pitch
    def world_to_j(wy): return (wy - origin[1]) / pitch

    margin = 2
    i0 = max(0,       int(np.floor(min(world_to_i(x_min), world_to_i(x_max)))) - margin)
    i1 = min(nx_v-1,  int(np.ceil( max(world_to_i(x_min), world_to_i(x_max)))) + margin)
    j0 = max(0,       int(np.floor(world_to_j(y_min))) - margin)
    j1 = min(ny_v-1,  int(np.ceil( world_to_j(y_max))) + margin)
    k0 = max(0,       min(int(np.floor(k_mid_f)), int(np.floor(min(k_front_plane, k_tip_plane)))) - margin)
    k1 = min(nz_v-1,  max(int(np.ceil( k_mid_f)), int(np.ceil( max(k_front_plane, k_tip_plane)))) + margin)

    # ── Voxel fill loop ──────────────────────────────────────────────────────
    count = 0

    for i in range(i0, i1 + 1):
        gx = origin[0] + i * pitch

        for j in range(j0, j1 + 1):
            gy = origin[1] + j * pitch

            # Solve s (0..1) along the leading edge
            if abs(dy_edge) > 1e-6:
                s = (gy - p0[1]) / dy_edge
            elif abs(dx_edge) > 1e-6:
                s = (gx - p0[0]) / dx_edge
            else:
                continue

            if s < 0.0 or s > 1.0:
                continue

            # X containment — band extends from the tagged edge toward -X
            x_lead = p0[0] + s * dx_edge
            t_x = x_lead - gx
            if t_x < 0.0 or t_x > width:
                continue

            # Chamfer: interpolate front face from k_front_plane to k_tip_plane
            dist_from_end = min(s, 1.0 - s) * edge_len
            if chamfer > 0 and dist_from_end < chamfer:
                tc = dist_from_end / chamfer       # 0 at tip, 1 at full
                k_front_f = k_tip_plane + tc * (k_front_plane - k_tip_plane)
            else:
                k_front_f = k_front_plane

            # Back face always flat at midplane
            k_back_f = k_mid_f

            # Skip if no thickness
            if is_positive and k_front_f <= k_back_f:
                continue
            if not is_positive and k_front_f >= k_back_f:
                continue

            # Fill solid from midplane to front face
            if is_positive:
                for k in range(max(int(np.floor(k_back_f)), k0),
                               min(int(np.ceil(k_front_f)) + 1, nz_v)):
                    if k < k_back_f or k > k_front_f:
                        continue
                    if cavity_f[i, j, k] < 1.0:
                        cavity_f[i, j, k] = 1.0
                        count += 1
            else:
                for k in range(max(int(np.floor(k_front_f)), k0),
                               min(int(np.ceil(k_back_f)) + 1, nz_v)):
                    if k > k_back_f or k < k_front_f:
                        continue
                    if cavity_f[i, j, k] < 1.0:
                        cavity_f[i, j, k] = 1.0
                        count += 1

    if console:
        console.print(
            f"[teal]gun_band[/teal]: filled {count:,} voxels  "
            f"(width={width}mm  depthZ={depth_z}mm  "
            f"chamfer={chamfer}mm  chamferDepth={chamfer_depth}mm  "
            f"side={'pos' if is_positive else 'neg'})"
        )

    return cavity_f, origin
