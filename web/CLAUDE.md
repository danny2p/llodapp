# LLOD Mold Maker Rules

## Coordinate System
- **X-Axis:** Length of the gun.
- **Negative X (-X):** Muzzle side (the tip).
- **Positive X (+X):** Grip / Holster Entrance side (where the gun exits).

## Feature Logic
- **Slide Release Clearance:** Channels MUST extend from the tagged point toward the **holster entrance (+X)**.
- **Voxel Grid:** The backend voxel grid is "swept" and inverted. **Index 0** in the `cavity` grid always represents the **holster entrance**.
- **Carving Direction:** To create a draw path, always carve from **index 0** (the entrance) to the feature's tagged location.

## Style Guidelines
- **Frontend:** React Three Fiber, Tailwind CSS, Lucide icons.
- **Backend:** FastAPI, float-based voxel densities for sub-voxel precision.
