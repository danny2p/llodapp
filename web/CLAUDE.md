# LLOD Holster Workshop Rules

## Coordinate Systems & Synchronization (CRITICAL)
- **Viewer Space (Frontend):** Muzzle is +X, Grip is -X.
- **Voxel Space (Backend):** Index 0 is always the ENTRANCE (Grip).
- **Coordinate Sync:** The carver logic must account for the fact that grid index `i` increases as world X decreases.
- **Conversion Math:** 
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
