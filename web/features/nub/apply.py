"""Nub Carver.

Adds a small cylindrical protrusion at the tagged point.
"""

import numpy as np
from features_frame import flf_from_points

def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype(np.float32)

    # 1. Get Params
    vals = state.get("values", {})
    dia = float(vals.get("diameter", 5.0))
    height = float(vals.get("height", 3.0))
    
    # 2. Setup FLF
    pts = state.get("points", [])
    flf = flf_from_points(pts)
    if not flf:
        return cavity_f, origin
        
    world_pos = flf.origin
    # R is the rotation from Local to World. R.T is World to Local.
    R_inv = flf.R.T
    
    # 3. Bounding Box
    radius = dia / 2.0
    # Safe AABB
    safe_r = max(radius, height) + 1.0
    
    i_c = int(round((world_pos[0] - origin[0]) / pitch))
    j_c = int(round((world_pos[1] - origin[1]) / pitch))
    k_c = int(round((world_pos[2] - origin[2]) / pitch))
    r_vox = int(np.ceil(safe_r / pitch)) + 2

    i0, i1 = max(0, i_c - r_vox), min(nx - 1, i_c + r_vox)
    j0, j1 = max(0, j_c - r_vox), min(ny - 1, j_c + r_vox)
    k0, k1 = max(0, k_c - r_vox), min(nz - 1, k_c + r_vox)

    # 4. Fill Loop
    rad_sq = radius**2
    count = 0
    for i in range(i0, i1 + 1):
        gx = origin[0] + i * pitch
        for j in range(j0, j1 + 1):
            gy = origin[1] + j * pitch
            for k in range(k0, k1 + 1):
                gz = origin[2] + k * pitch
                
                # Transform world point to local box space
                dw = np.array([gx, gy, gz]) - world_pos
                lp = R_inv @ dw # Local Pt
                
                # Cylinder logic in local space:
                # Circular in XY: x^2 + y^2 <= radius^2
                # Extrude outward: 
                # World +Z is local -Z via HAS_DEFAULT_R.
                z_sign = -1.0 if world_pos[2] >= 0 else 1.0
                
                in_z_range = False
                if z_sign > 0:
                    in_z_range = 0 <= lp[2] <= height
                else:
                    in_z_range = -height <= lp[2] <= 0
                
                if in_z_range:
                    dist_sq = lp[0]**2 + lp[1]**2
                    if dist_sq <= rad_sq:
                        if cavity_f[i, j, k] < 1.0:
                            cavity_f[i, j, k] = 1.0
                            count += 1
                            
    if console:
        console.print(f"  [teal]nub[/teal]: added {count:,} voxels (dia {dia}mm, height {height}mm)")
        
    return cavity_f, origin
