"""Trigger Platen Carver.

Automatically creates an internal wall centered on the gun midplane.
Anchored to the muzzle end and bottom of the bounding box.
"""

import numpy as np

def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    nx, ny, nz = cavity_bin.shape
    cavity_f = cavity_bin.astype(np.float32)

    # 1. Get Params
    vals = state.get("values", {})
    thickness_mm = float(vals.get("thickness", 4.0))
    
    # 2. Determine Bounding Box from grid occupancy
    # We find where the gun currently exists in the cavity
    # Note: cavity_bin is actually the MOLD cavity (SDF < 0).
    # The gun's extent in Y can be inferred from the mold's extent.
    
    occupancy = cavity_bin > 0
    occupied_indices = np.where(occupancy.any(axis=(0, 2)))[0]
    
    if len(occupied_indices) == 0:
        return cavity_f, origin
        
    j_min, j_max = occupied_indices.min(), occupied_indices.max()
    
    # physical_muzzle_i is the World +X limit
    muzzle_i = context.get("physical_muzzle_i", nx - 1)
    
    # 3. Calculate Ranges
    muzzle_extension = 0.0
    fs = context.get("features_state", {})
    mc_instances = fs.get("muzzle_cut", [])
    if isinstance(mc_instances, dict): mc_instances = [mc_instances]
    for mc in mc_instances:
        if mc.get("enabled"):
            muzzle_extension = float(mc.get("values", {}).get("extension", 30.0))
            break
            
    vox_total = int(round(insertion_vox))
    vox_30 = int(round(30.0 / pitch))
    muzzle_ext_vox = int(round(muzzle_extension / pitch))
    
    # Platen length is (TotalLength - 30 + Extension) in voxels
    platen_length_vox = vox_total - vox_30 + muzzle_ext_vox
    
    i_start = max(0, muzzle_i - platen_length_vox)
    i_end = muzzle_i
    
    if console:
        console.print(f"     Platen Debug: i_start={i_start}, i_end={i_end} (length_vox={platen_length_vox})")
    
    # Y range: From j_min to (j_max - 15mm)
    vox_15 = int(round(15.0 / pitch))
    j_start = j_min
    j_end = max(j_start + 1, j_max - vox_15)
    
    # Z range: Back side aligns with midpoint (nz/2).
    # Box grows away from midplane (+Z).
    z_mid = nz / 2.0
    k_start = int(np.floor(z_mid))
    k_end = int(np.ceil(z_mid + (thickness_mm / pitch)))

    # 4. Apply (Additive)
    # Clamp to grid
    i0, i1 = max(0, i_start), min(nx - 1, i_end)
    j0, j1 = max(0, j_start), min(ny - 1, j_end)
    k0, k1 = max(0, k_start), min(nz - 1, k_end)
    
    cavity_f[i0:i1+1, j0:j1+1, k0:k1+1] = 1.0
    
    if console:
        count = (i1 - i0 + 1) * (j1 - j0 + 1) * (k1 - k0 + 1)
        console.print(f"  [teal]trigger_platen[/teal]: added {count:,} voxels (thickness {thickness_mm}mm)")
        
    return cavity_f, origin
