"""Slide Circles Carver.

Adds a set of 3 nested cylinders (bosses with holes) to the mold surface.
Optimized for high-speed voxel processing.
"""

import numpy as np
from features_frame import rot_z

def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype(np.float32)

    # 1. Get Params
    vals = state.get("values", {})
    outer_rad = float(vals.get("outerDia", 10.0)) / 2.0
    inner_rad = float(vals.get("innerDia", 2.0)) / 2.0
    spacing = float(vals.get("spacing", 30.0))
    height = float(vals.get("height", 6.0))
    rz_deg = float(vals.get("rotateZ", 0.0))
    
    # 2. Setup Coordinate Math
    pts = state.get("points", [])
    if not pts or pts[0] is None:
        return cavity_f, origin
        
    p0 = np.array(pts[0])
    
    # We follow the SR channel orientation logic:
    # Anchor at p0, extend toward holster entrance (+X).
    # Rotation around world Z axis.
    theta = np.radians(rz_deg)
    ct, st = np.cos(theta), np.sin(theta)
    
    # Centers of the 3 circles in world space
    centers_local = [np.array([i * spacing, 0.0, 0.0]) for i in range(3)]
    # Rotate local offsets by rz_deg (around Z)
    centers_world = []
    for cl in centers_local:
        # standard 2D rotation for XY plane
        rx = cl[0] * ct - cl[1] * st
        ry = cl[0] * st + cl[1] * ct
        centers_world.append(p0 + np.array([rx, ry, 0.0]))

    # 3. Determine Side
    # Use p0[2] to decide if we are on +Z or -Z side
    z_mid_vox = nz / 2.0
    k_tag_vox = (p0[2] - origin[2]) / pitch
    is_positive_side = k_tag_vox > z_mid_vox

    # 4. Carving Loop
    # We iterate over a bounding box that covers all 3 circles
    radius_vox = int(np.ceil((outer_rad + 2) / pitch))
    
    all_x = [c[0] for c in centers_world]
    all_y = [c[1] for c in centers_world]
    x_min, x_max = min(all_x) - outer_rad, max(all_x) + outer_rad
    y_min, y_max = min(all_y) - outer_rad, max(all_y) + outer_rad
    
    i_min = int(round((insertion_vox - 1) - (x_max - origin[0]) / pitch))
    i_max = int(round((insertion_vox - 1) - (x_min - origin[0]) / pitch))
    j0 = int(round((y_min - origin[1]) / pitch))
    j1 = int(round((y_max - origin[1]) / pitch))
    
    i0, i1 = max(0, i_min - 2), min(nx - 1, i_max + 2)
    j0, j1 = max(0, j0 - 2), min(ny - 1, j1 + 2)

    count_added = 0

    for i in range(i0, i1 + 1):
        gx = origin[0] + (insertion_vox - 1 - i) * pitch
        for j in range(j0, j1 + 1):
            gy = origin[1] + j * pitch
            
            # Check distance to each circle center
            d_min = float('inf')
            for cw in centers_world:
                d = np.sqrt((gx - cw[0])**2 + (gy - cw[1])**2)
                if d < d_min:
                    d_min = d
            
            if d_min > outer_rad + pitch:
                continue
                
            # 1. Determine local max height for this voxel
            # Outer boss smoothing
            outer_cov = 1.0
            if d_min > outer_rad - pitch:
                outer_cov = max(0.0, (outer_rad - d_min) / pitch)
            
            # Inner pin smoothing (additive, sits on top and goes higher)
            inner_cov = 0.0
            if d_min < inner_rad + pitch:
                if d_min < inner_rad - pitch:
                    inner_cov = 1.0
                else:
                    # Smoothing transition between inner and outer zones
                    inner_cov = max(0.0, (inner_rad - d_min) / pitch + 1.0) # rough but works
            
            # Final allowed height at this voxel:
            # - If in inner circle: height + 1mm
            # - If in outer circle: height
            # We use max height logic with smoothing
            if d_min < inner_rad:
                target_height = height + 1.0
                edge_dens = 1.0 # inner core is solid
            elif d_min < outer_rad:
                # In the 'outer' ring
                target_height = height
                # Smooth the inner wall of the ring if we want, 
                # but for an additive boss we'll just step up.
                edge_dens = outer_cov
            else:
                continue

            if edge_dens <= 0: continue

            col = cavity_bin[i, j, :]
            if not col.any(): continue
            zs = np.where(col)[0]
            z_surf = int(zs.max()) if is_positive_side else int(zs.min())
            
            # Add material upward from the surface
            h_vox = target_height / pitch
            for v_off in range(int(np.ceil(h_vox)) + 1):
                v_dens = edge_dens
                if v_off > h_vox: continue
                if v_off + 1 > h_vox:
                    v_dens *= (h_vox - v_off)
                
                k = z_surf + v_off if is_positive_side else z_surf - v_off
                if 0 <= k < nz:
                    if v_dens > cavity_f[i, j, k]:
                        cavity_f[i, j, k] = v_dens
                        count_added += 1

    if console:
        console.print(f"  [blue]slide_circles[/blue]: added {count_added:,} voxels in additive ring pattern")
        
    return cavity_f, origin
