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
    total_len = 2 * spacing + outer_rad * 2
    radius_vox = int(np.ceil((outer_rad + 2) / pitch))
    
    # Bounding box calculation for the whole feature
    # (Rough but safe)
    all_x = [c[0] for c in centers_world]
    all_y = [c[1] for c in centers_world]
    
    x_min, x_max = min(all_x) - outer_rad, max(all_x) + outer_rad
    y_min, y_max = min(all_y) - outer_rad, max(all_y) + outer_rad
    
    # Map World X to swept indices
    i_min = int(round((insertion_vox - 1) - (x_max - origin[0]) / pitch))
    i_max = int(round((insertion_vox - 1) - (x_min - origin[0]) / pitch))
    j0 = int(round((y_min - origin[1]) / pitch))
    j1 = int(round((y_max - origin[1]) / pitch))
    
    i0, i1 = max(0, i_min - 2), min(nx - 1, i_max + 2)
    j0, j1 = max(0, j0 - 2), min(ny - 1, j1 + 2)

    height_vox = height / pitch
    count_added = 0
    count_removed = 0

    for i in range(i0, i1 + 1):
        # Swept index -> World X
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
                
            # Density for outer circle AA
            outer_cov = 1.0
            if d_min > outer_rad - pitch:
                outer_cov = max(0.0, (outer_rad - d_min) / pitch)
            
            # Density for inner circle (hole)
            inner_cov = 0.0
            if d_min < inner_rad + pitch:
                if d_min < inner_rad:
                    inner_cov = 1.0
                else:
                    inner_cov = max(0.0, (inner_rad + pitch - d_min) / pitch)

            if outer_cov <= 0:
                continue

            col = cavity_bin[i, j, :]
            if not col.any(): continue
            zs = np.where(col)[0]
            z_surf = int(zs.max()) if is_positive_side else int(zs.min())
            
            # 1. Add boss material
            for v_off in range(int(np.ceil(height_vox)) + 1):
                dens = outer_cov
                if v_off > height_vox: continue
                if v_off + 1 > height_vox:
                    dens *= (height_vox - v_off)
                
                k = z_surf + v_off if is_positive_side else z_surf - v_off
                if 0 <= k < nz:
                    if dens > cavity_f[i, j, k]:
                        cavity_f[i, j, k] = dens
                        count_added += 1

            # 2. Subtract hole material
            # Holes go deeper than the boss to ensure they are clear
            if inner_cov > 0:
                hole_depth_vox = height_vox + 2 # slightly deeper
                for v_off in range(int(np.ceil(hole_depth_vox)) + 1):
                    k = z_surf + v_off if is_positive_side else z_surf - v_off
                    if 0 <= k < nz:
                        # Subtraction: reduce density
                        new_dens = max(0.0, cavity_f[i, j, k] - inner_cov)
                        if new_dens < cavity_f[i, j, k]:
                            cavity_f[i, j, k] = new_dens
                            count_removed += 1

    if console:
        console.print(f"  [blue]slide_circles[/blue]: added {count_added:,} voxels, removed {count_removed:,} for holes")
        
    return cavity_f, origin
