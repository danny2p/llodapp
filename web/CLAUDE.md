# LLOD Holster Workshop Rules

## Coordinate Systems & Synchronization (CRITICAL)
- **HAS (Holster-Aligned System):** Muzzle is +X, Grip/Entrance is -X. Top of slide is +Y. Gun center is at origin.
- **Voxel Space (Backend):** Index 0 is the ENTRANCE (-X end). Index `nx-1` is the muzzle (+X end). Indices increase monotonically with world X.
- **Conversion Math (linear, forward):**
    - `world_x = origin[0] + i * pitch`
    - `i = (world_x - origin[0]) / pitch`
- **Feature-Local Frame (FLF):** Shared by overlays and carvers. Default (single-point) is HAS_DEFAULT_R = rotY(180°): local +X → world -X (entrance direction), local +Y → world +Y, local +Z → world -Z.

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
