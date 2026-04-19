"""Sight Channel Carver.

Additive rectangular ridge starting at the muzzle-side edge and sweeping to the entrance.
Uses the Planar Override Principle for smooth CAD-quality surfaces.
"""

from __future__ import annotations
import numpy as np
from features_frame import rot_z

def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    v = state["values"]
    pts = state["points"]
    if not pts or pts[0] is None:
        return cavity_bin, origin
        
    p0 = np.asarray(pts[0], dtype=float)
    
    # Defaults: 10mm tall (y), 6mm deep (z), length (x) defaults to total_length
    total_len_mm = insertion_vox * pitch
    height_y_mm = float(v.get("height", 10.0))
    depth_z_mm = float(v.get("depth", 6.0))
    length_x_mm = float(v.get("length", total_len_mm))
    rotate_z_deg = float(v.get("rotateZ", 0.0))
    both_sides = Boolean(v.get("bothSides", True))

    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype("float32")

    # 1. Coordinate Math
    # In the swept grid, index 0 is ENTRANCE, high index is MUZZLE.
    # p0 is the muzzle-side front edge.
    i_start = int((insertion_vox - 1) - round((p0[0] - origin[0]) / pitch))
    
    # 2. Rotation
    theta = np.radians(rotate_z_deg)
    ct, st = np.cos(theta), np.sin(theta)
    
    # Bounding box (rough but safe)
    # The channel extends from p0 toward ENTRANCE (negative world X).
    # Since grid index i increases as world X decreases, we carve from 0 to i_start.
    j_c = (p0[1] - origin[1]) / pitch
    half_h_vox = (height_y_mm / pitch)
    
    # If both sides, we center on p0[2].
    k_c = (p0[2] - origin[2]) / pitch
    half_d_vox = (depth_z_mm / pitch) / 2.0 if both_sides else (depth_z_mm / pitch)
    
    z_mid_vox = nz / 2.0

    # 3. Carving Loop (Planar Override)
    # We want to fill from the gun interior OUT to a target height.
    # The target height is p0[1] + height_y_mm.
    target_y_world = p0[1] + height_y_mm
    target_j_vox = (target_y_world - origin[1]) / pitch
    
    count = 0
    # Carve from entrance (0) to the muzzle-point (i_start)
    for i in range(0, i_start + 1):
        # Local X in channel frame (0 at p0, increasing toward entrance)
        gx = origin[0] + (insertion_vox - 1 - i) * pitch
        lx = p0[0] - gx
        
        if not (0 <= lx <= length_x_mm):
            continue
            
        for k in range(nz):
            gz = origin[2] + k * pitch
            dw_z = gz - p0[2]
            
            # Z check (width of the ridge)
            if both_sides:
                if abs(dw_z) > (depth_z_mm / 2.0): continue
            else:
                # Grow in the direction of the click's side? 
                # For simplicity, we'll grow in +Z.
                if not (0 <= dw_z <= depth_z_mm): continue
                
            # Now we have i and k. We fill from interior UP to target_j_vox.
            # We find the top-most surface of the gun at this (i, k).
            col = cavity_bin[i, :, k]
            if not col.any(): continue
            
            # Handguns are oriented grip-down (-Y). Slide top is at high Y.
            # So the surface we are building on is at max Y.
            j_surf = int(np.where(col)[0].max())
            
            # Fill from j_surf up to target_j_vox
            for j in range(j_surf, int(np.ceil(target_j_vox)) + 1):
                if 0 <= j < ny:
                    density = 1.0
                    if j > target_j_vox: continue
                    if j + 1 > target_j_vox:
                        density = target_j_vox - j
                        
                    if density > cavity_f[i, j, k]:
                        cavity_f[i, j, k] = density
                        count += 1

    if console is not None:
        console.print(
            f"  [blue]sight_channel[/blue]: added {count:,} voxels using planar override"
        )
        
    return cavity_f, origin

def Boolean(v):
    if isinstance(v, bool): return v
    return str(v).lower() == "true"
