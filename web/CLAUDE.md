# LLOD Holster Workshop Rules

## Coordinate System (Viewer)
- **X-Axis:** Length of the gun.
- **Positive X (+X):** Muzzle side (Right side of screen).
- **Negative X (-X):** Grip / Holster Entrance side (Left side of screen).
- **Animation:** 3D Scan enters from Left (-X) and moves Right (+X), plunging into the mold.

## Feature Logic
- **Slide Release Clearance:** Channels MUST extend from the tagged point toward the **holster entrance (+X)**.
- **Voxel Grid:** The backend voxel grid is "swept" and inverted. **Index 0** in the `cavity` grid always represents the **holster entrance**.
- **Carving Direction:** To create a draw path, always carve from **index 0** (the entrance) to the feature's tagged location.

## Style Guidelines
- **Frontend:** React Three Fiber, Tailwind CSS, Lucide icons, HUD theme.
- **Backend:** FastAPI, float-based voxel densities for sub-voxel precision.
