"""Generic Rectangular Cut Carver.

Cuts away (sets to 0) voxels within a transformed rectangular prism with
adjustable chamfers on the front/rear interior walls.
"""

import numpy as np
from features_frame import flf_from_points, rot_z

def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype(np.float32)

    # 1. Get Params
    vals = state.get("values", {})
    w = float(vals.get("width", 7.0))
    h = float(vals.get("height", 7.0))
    d = float(vals.get("depth", 5.0))
    rz_deg = float(vals.get("rotateZ", 0.0))
    chamfer = float(vals.get("chamfer", 1.0))
    ox = float(vals.get("offsetX", 0.0))
    oy = float(vals.get("offsetY", 0.0))
    
    # 2. Setup FLF
    pts = state.get("points", [])
    flf = flf_from_points(pts)
    if not flf:
        return cavity_f, origin
        
    # p0 is the HANDLE point. The box center is p0 + rotated offset.
    p0 = flf.origin
    
    # Feature rotation matrix
    R_local = rot_z(np.radians(rz_deg))
    # Combined rotation: Gun -> FLF -> Feature
    R_total = flf.R @ R_local
    
    # world center of the box
    # Handle (0,0) is 10mm to the right of the top-right corner.
    # Top-right corner = (-10, 0)
    # Center = (-10 - w/2, -h/2)
    base_x = -10.0 - w / 2.0
    base_y = -h / 2.0
    
    local_offset = np.array([base_x + ox, base_y + oy, 0.0])
    world_center = p0 + flf.R @ local_offset
    
    # Inverse to go World -> local Box space
    R_inv = R_total.T
    
    # 3. Bounding Box in Swept Voxel Space
    # Use a safe radius for AABB clipping
    radius = np.sqrt(w**2 + h**2 + d**2) / 2.0 + np.sqrt(ox**2 + oy**2)
    
    # HAS linear mapping: gx = origin[0] + i * pitch
    i_c = int(round((world_center[0] - origin[0]) / pitch))
    j_c = int(round((world_center[1] - origin[1]) / pitch))
    k_c = int(round((world_center[2] - origin[2]) / pitch))
    r_vox = int(np.ceil(radius / pitch)) + 2

    i0, i1 = max(0, i_c - r_vox), min(nx - 1, i_c + r_vox)
    j0, j1 = max(0, j_c - r_vox), min(ny - 1, j_c + r_vox)
    k0, k1 = max(0, k_c - r_vox), min(nz - 1, k_c + r_vox)

    # 4. Carving Loop
    half_w, half_h, half_d = w/2.0, h/2.0, d/2.0

    count = 0
    for i in range(i0, i1 + 1):
        gx = origin[0] + i * pitch
        for j in range(j0, j1 + 1):
            gy = origin[1] + j * pitch
            for k in range(k0, k1 + 1):
                gz = origin[2] + k * pitch
                
                # Transform world point to local box space
                dw = np.array([gx, gy, gz]) - world_center
                lp = R_inv @ dw # Local Pt
                
                # Basic AABB check in local space
                if (abs(lp[1]) <= half_h and 
                    abs(lp[2]) <= half_d and 
                    abs(lp[0]) <= half_w):
                    
                    # Chamfer logic: front (+X) and rear (-X) inside walls.
                    dist_from_x_edge = half_w - abs(lp[0])
                    
                    if chamfer > 0 and dist_from_x_edge < chamfer:
                        z_min = -half_d + (chamfer - dist_from_x_edge)
                        if lp[2] < z_min:
                            continue
                            
                    if cavity_f[i, j, k] > 0:
                        cavity_f[i, j, k] = 0.0
                        count += 1
                        
    if console:
        console.print(f"  [red]generic_cut[/red]: carved {count:,} voxels using {w}x{h}x{d} chamfered block")
        
    return cavity_f, origin
