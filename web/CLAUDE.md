# LLOD Holster Workshop Rules

## Coordinate System (Viewer)
- **X-Axis:** Length of the gun.
- **Positive X (+X):** Muzzle side (Right side of screen).
- **Negative X (-X):** Grip / Holster Entrance side (Left side of screen).
- **Animation:** 3D Scan enters from Left (-X) and moves Right (+X), plunging into the mold.

## Universal Carver Rule (CRITICAL)
- **World Space:** +X is Muzzle, -X is Grip.
- **Voxel Space:** Index 0 is the ENTRANCE (Grip). The grid is reversed.
- **Conversion Math:** 
    - `index_i = (insertion_vox - 1) - (world_x - origin_x) / pitch`
    - `world_x = origin_x + (insertion_vox - 1 - index_i) * pitch`
- **Synchronization:** The `overlay.tsx` (Three.js) and `apply.py` (Python) MUST use these exact mappings to ensure wireframes match physical carving.

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
