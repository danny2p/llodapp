"""Sight Channel Carver.

Automatically centered rectangular ridge spanning the full length of the mold.
Uses the Planar Override Principle for smooth CAD-quality surfaces.
"""

from __future__ import annotations
import numpy as np

def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype("float32")

    # 1. Get Params
    v = state.get("values", {})
    height_y = float(v.get("height", 10.0))
    width_z = float(v.get("width", 4.0))
    ox = float(v.get("offsetX", -19.0))
    oy = float(v.get("offsetY", 50.0))
    rz_deg = float(v.get("rotateZ", 0.0))
    
    # 2. Geometric Anchors (Backend Space: Muzzle is MIN X, Grip is MAX X)
    # Grid is centered at y=0, z=0 in world space (roughly).
    # We use manual offsets directly to match the 3D viewer.
    
    half_h_vox = (height_y / 2.0) / pitch
    half_w_vox = (width_z / 2.0) / pitch
    
    # Vertical target (match THREE.Vector3(ox, oy, 0))
    # world_y = origin[1] + j * pitch  => j = (world_y - origin[1]) / pitch
    target_j = (oy / pitch) + (half_h_vox) - (origin[1] / pitch)
    j_start = (oy / pitch) - (half_h_vox) - (origin[1] / pitch)
    
    # Horizontal center (match Z=0)
    k_c = -origin[2] / pitch
    k0, k1 = int(np.floor(k_c - half_w_vox)), int(np.ceil(k_c + half_w_vox))
    
    # 3. Carving Loop
    count = 0
    
    # Find the actual physical muzzle floor in the grid
    occupied_i = np.where(cavity_bin.any(axis=(1, 2)))[0]
    if len(occupied_i) > 0:
        muzzle_i = int(occupied_i.max())
    else:
        muzzle_i = nx - 1
        
    # Stop 2mm before the floor to prevent protrusion past the muzzle
    safety_vox = int(np.ceil(2.0 / pitch))
    end_i = max(0, muzzle_i - safety_vox)

    for i in range(end_i + 1):
        # Local X with offset
        # world_x = origin[0] + (insertion_vox - 1 - i) * pitch
        # world_x_shifted = world_x - ox
        
        for k in range(max(0, k0), min(nz, k1 + 1)):
            # Local Z smoothing
            k_dist = min(abs(k - k0), abs(k - k1))
            z_dens = min(1.0, k_dist)
            
            # Fill the rectangular volume
            for j in range(max(0, int(np.floor(j_start))), min(ny, int(np.ceil(target_j)) + 1)):
                density = z_dens
                if j > target_j: continue
                if j + 1 > target_j:
                    density *= (target_j - j)
                if j < j_start: continue
                if j - 1 < j_start:
                    density *= (j - j_start)
                        
                if density > cavity_f[i, j, k]:
                    cavity_f[i, j, k] = density
                    count += 1

    if console is not None:
        console.print(
            f"  [blue]sight_channel[/blue]: auto-added {count:,} voxels (centered ridge)"
        )
        
    return cavity_f, origin
