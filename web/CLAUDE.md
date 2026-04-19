# LLOD Holster Workshop Rules

## Coordinate Systems & Synchronization (CRITICAL)
- **Viewer Space (Frontend):** Muzzle is +X, Grip is -X. (Rotated 180° for user comfort).
- **Aligned Space (Backend):** Muzzle is -X, Grip is +X. (Standard calculation frame).
- **Automated Flip:** The pipeline automatically flips incoming feature coordinates ([x, y, z] -> [-x, y, -z]) to bridge these spaces.

## Universal Carver Rule
- **Voxel Grid:** Index 0 is always the ENTRANCE (Grip).
- **Direction:** To create a draw path, always carve from **index 0** (the entrance) to the feature's tagged location.
- **Conversion Math (Aligned Space):** 
    - `index_i = (insertion_vox - 1) - (world_x - min_x) / pitch`
    - `world_x = min_x + (insertion_vox - 1 - index_i) * pitch`

## Planar Override Principle (For Additive Features)
- **Problem:** Growing geometry relative to the gun surface inherits the scan's noise/texture.
- **Solution:** Always use **Absolute Planar Targeting**.
- **Implementation:** 
    1. Define a target Z-plane in world space (`click_z + parameter_depth`).
    2. In the carving loop, fill every voxel from the gun's interior out to that exact plane.
    3. This ensures the top surface is perfectly flat and Cad-accurate, matching the 3D preview.

## Style Guidelines
- **Frontend:** React Three Fiber, Tailwind CSS, Lucide icons, HUD theme.
- **Backend:** FastAPI, float-based voxel densities for sub-voxel precision.
