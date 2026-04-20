"""Gun Band (gun_band) — voxel carver.

p0 and p1 define the *leading diagonal edge* of the band.  The band
extends `width` mm along World X (short sides parallel to X), and
`depthZ` mm outward in Z.

extendTop    pushes p0 backward along the edge direction.
extendBottom pushes p1 forward along the edge direction.

Chamfer logic (modelled after slide_release):
  `chamfer` applies only to the two SHORT X-parallel ends (the top cap
  at p0 and the bottom cap at p1).  As a voxel gets closer to either
  end than `chamfer` mm, the allowed Z depth is reduced linearly —
  reaching zero right at the end edge.  This produces a clean 45° ramp
  on both end corners.
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
    width        = float(vals.get("width",        20.0))
    depth_z      = float(vals.get("depthZ",       10.0))
    extend_top   = float(vals.get("extendTop",     0.0))
    extend_bot   = float(vals.get("extendBottom",  0.0))
    offset_x     = float(vals.get("offsetX",       0.0))
    offset_y     = float(vals.get("offsetY",       0.0))
    chamfer      = float(vals.get("chamfer",       1.0))
    chamfer      = min(chamfer, depth_z, width / 2.0)

    # ── Anchor points with offset and extension ──────────────────────────────
    p0_raw = np.asarray(points[0], dtype=float) + np.array([offset_x, offset_y, 0.0])
    p1_raw = np.asarray(points[1], dtype=float) + np.array([offset_x, offset_y, 0.0])

    edge_vec_raw = p1_raw - p0_raw
    edge_len_raw = float(np.linalg.norm(edge_vec_raw))
    if edge_len_raw < 1e-6:
        if console:
            console.print("[yellow]gun_band: p0 == p1 — skipping[/yellow]")
        return cavity_f, origin

    edge_dir = edge_vec_raw / edge_len_raw

    # Extend endpoints outward along the edge
    p0 = p0_raw - edge_dir * extend_top
    p1 = p1_raw + edge_dir * extend_bot

    # Recompute edge with extended points
    edge_vec = p1 - p0
    edge_len = float(np.linalg.norm(edge_vec))
    edge_dir = edge_vec / edge_len
    dy_edge  = float(p1[1] - p0[1])
    dx_edge  = float(p1[0] - p0[0])

    # ── Z outward direction ──────────────────────────────────────────────────
    nx_v, ny_v, nz_v = cavity_f.shape
    z_mid_world = origin[2] + (nz_v / 2.0) * pitch
    z_mid_pts   = (p0[2] + p1[2]) / 2.0
    z_sign      = 1.0 if z_mid_pts >= z_mid_world else -1.0

    # ── Bounding box ─────────────────────────────────────────────────────────
    x_min = min(p0[0], p1[0])
    x_max = max(p0[0], p1[0]) + width
    y_min = min(p0[1], p1[1])
    y_max = max(p0[1], p1[1])
    z_base_world = min(p0[2], p1[2])
    z_top_world  = z_base_world + z_sign * depth_z

    def world_to_i(wx): return (insertion_vox - 1) - (wx - origin[0]) / pitch
    def world_to_j(wy): return (wy - origin[1]) / pitch
    def world_to_k(wz): return (wz - origin[2]) / pitch

    margin = 2
    i0 = max(0,       int(np.floor(min(world_to_i(x_min), world_to_i(x_max)))) - margin)
    i1 = min(nx_v-1,  int(np.ceil( max(world_to_i(x_min), world_to_i(x_max)))) + margin)
    j0 = max(0,       int(np.floor(world_to_j(y_min))) - margin)
    j1 = min(ny_v-1,  int(np.ceil( world_to_j(y_max))) + margin)
    k0 = max(0,       int(np.floor(min(world_to_k(z_base_world), world_to_k(z_top_world)))) - margin)
    k1 = min(nz_v-1,  int(np.ceil( max(world_to_k(z_base_world), world_to_k(z_top_world)))) + margin)

    # ── Voxel fill loop ──────────────────────────────────────────────────────
    count = 0

    for i in range(i0, i1 + 1):
        gx = origin[0] + (insertion_vox - 1 - i) * pitch

        for j in range(j0, j1 + 1):
            gy = origin[1] + j * pitch

            # Solve s (0..1) along the leading edge from this voxel's Y (or X)
            if abs(dy_edge) > 1e-6:
                s = (gy - p0[1]) / dy_edge
            elif abs(dx_edge) > 1e-6:
                s = (gx - p0[0]) / dx_edge
            else:
                continue

            if s < 0.0 or s > 1.0:
                continue

            # X of the leading edge at this s, and distance into the band
            x_lead = p0[0] + s * dx_edge
            t_x = gx - x_lead
            if t_x < 0.0 or t_x > width:
                continue

            # Distance from each short end in mm along the edge
            dist_from_p0 = s * edge_len          # 0 at p0 end, edge_len at p1
            dist_from_p1 = (1.0 - s) * edge_len  # 0 at p1 end, edge_len at p0
            dist_from_end = min(dist_from_p0, dist_from_p1)

            # Chamfer: reduce allowed Z depth near the short ends
            # Same approach as slide_release — pull back the depth linearly
            local_depth = depth_z
            if chamfer > 0 and dist_from_end < chamfer:
                local_depth = depth_z * (dist_from_end / chamfer)

            if local_depth <= 0.0:
                continue

            # Z containment using the local (possibly reduced) depth
            z_surf = p0[2] + s * (p1[2] - p0[2])

            for k in range(k0, k1 + 1):
                gz = origin[2] + k * pitch
                t_z = (gz - z_surf) * z_sign   # 0 at surface → depth_z at top

                if t_z < 0.0 or t_z > local_depth:
                    continue

                if cavity_f[i, j, k] < 1.0:
                    cavity_f[i, j, k] = 1.0
                    count += 1

    if console:
        console.print(
            f"[teal]gun_band[/teal]: filled {count:,} voxels  "
            f"(width={width}mm  depthZ={depth_z}mm  "
            f"extTop={extend_top}mm  extBot={extend_bot}mm  "
            f"chamfer={chamfer}mm)"
        )

    return cavity_f, origin
