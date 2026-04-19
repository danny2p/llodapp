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
    # We use a global grid center for the "interior" reference to ensure we fill outward.
    z_mid_vox = nz / 2.0
    k_tag_vox = (p0[2] - origin[2]) / pitch
    is_positive_side = k_tag_vox > z_mid_vox

    # 4. Target Absolute Z Planes (the "ceilings" of the cylinders)
    # !!! PLANAR OVERRIDE PRINCIPLE !!!
    # We calculate the exact world Z where the top of the cylinder must be.
    # We then fill from the gun interior OUT TO this plane. This overwrites
    # any bumpy gun geometry with a perfectly flat, cad-quality face.
    outer_z_world = p0[2] + (height if is_positive_side else -height)
    inner_z_world = p0[2] + ((height + 1.0) if is_positive_side else -(height + 1.0))
    
    outer_k_target = (outer_z_world - origin[2]) / pitch
    inner_k_target = (inner_z_world - origin[2]) / pitch

    # 5. Carving Loop
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
            
            d_min = float('inf')
            for cw in centers_world:
                d = np.sqrt((gx - cw[0])**2 + (gy - cw[1])**2)
                if d < d_min: d_min = d
            
            if d_min > outer_rad + pitch:
                continue
                
            # Anti-aliasing / edge smoothing
            outer_cov = max(0.0, min(1.0, (outer_rad - d_min) / pitch + 1.0)) if d_min > outer_rad - pitch else 1.0
            inner_cov = max(0.0, min(1.0, (inner_rad - d_min) / pitch + 1.0)) if d_min > inner_rad - pitch else 1.0
            
            # Decide which target plane to use for this voxel
            if d_min < inner_rad + pitch:
                # Use the inner pin height
                k_target_float = inner_k_target
                edge_dens = inner_cov
            elif d_min < outer_rad + pitch:
                # Use the outer boss height
                k_target_float = outer_k_target
                edge_dens = outer_cov
            else:
                continue

            if edge_dens <= 0: continue

            # Fill from the gun interior out to the target plane
            if is_positive_side:
                k_start = int(np.floor(z_mid_vox))
                for k in range(k_start, int(np.ceil(k_target_float)) + 1):
                    if 0 <= k < nz:
                        density = edge_dens
                        if k > k_target_float: continue
                        if k + 1 > k_target_float:
                            density *= (k_target_float - k)
                        if density > cavity_f[i, j, k]:
                            cavity_f[i, j, k] = density
                            count_added += 1
            else:
                k_start = int(np.ceil(z_mid_vox))
                for k in range(int(np.floor(k_target_float)), k_start + 1):
                    if 0 <= k < nz:
                        density = edge_dens
                        if k < k_target_float: continue
                        if k - 1 < k_target_float:
                            density *= (k - k_target_float)
                        if density > cavity_f[i, j, k]:
                            cavity_f[i, j, k] = density
                            count_added += 1

    if console:
        console.print(f"  [blue]slide_circles[/blue]: added {count_added:,} voxels using absolute planar targeting")
        
    return cavity_f, origin
