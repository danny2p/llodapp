# Holster Aligned System (HAS) Migration Plan

## The Current State (The Problem)
The application currently suffers from a "Tangled Coordinate System" where the 3D model and its features exist in three conflicting coordinate spaces depending on the current step:

1.  **Tagging Space (Step 1.5):** The raw scan is aligned by the backend, but its forward/backward orientation is arbitrary (currently settling with Muzzle pointing to `-X`). User clicks are recorded in this `-X` facing space.
2.  **Backend Voxel Space (The Carver):** The `sweep_cavity_sdf` function effectively reverses the grid array to imprint the mold from the muzzle down to the grip. This makes the Entrance index `0` and the Muzzle the maximum index (`+X`). Feature carvers must mathematically translate the `-X` tagged points into this reversed `+X` grid.
3.  **Animation/Mold Space (Steps 2 & 3):** To make the mold and the gun animate correctly into the clay block, the React frontend applies a manual 180-degree rotation (`Math.PI` around Y) to the gun mesh, forcing the Muzzle to `+X`. It also uses conditional `direction` flags (1 or -1) to prevent the teal feature wireframes from flipping backwards.

This creates a fragile system where adding or modifying features requires complex, conditional math to translate between the three spaces.

## The HAS Definition (The Solution)
We will establish the **Holster Aligned System (HAS)** as the single, absolute source of truth across the entire application. 

**HAS Coordinate Rules:**
*   **Muzzle (Forward)** is always exactly **+X**.
*   **Entrance (Rearward)** is always exactly **-X**.
*   **Top of Slide (Up)** is always **+Y**.
*   **Center of Gun** is exactly **[0, 0, 0]** in world space.

## Technical Implementation Plan

### Step 1: Config Data Migration
Existing configuration files (like `sig_p320-04-19-2026-holster-config.json`) have points saved in the old "Tagging Space" (Muzzle = `-X`). 
*   **Action:** Create a script or manually translate these reference files into HAS. Since the gun will be rotated 180 degrees around the Y-axis to face `+X`, we must invert the X and Z coordinates of every saved point (`X -> -X`, `Z -> -Z`). The Y coordinate remains unchanged.
*   **Output:** Save translated configs with a `-HAS` suffix for testing.

### Step 2: Backend Master Alignment (`prototype_v11_mabr.py`)
The backend Python script must become the enforcer of the HAS standard.
*   **Action:** 
    1.  Update the initial alignment logic to force the Muzzle to point to `+X` (`orient_muzzle_high`).
    2.  Explicitly calculate the bounding box center of the aligned gun and translate the entire mesh so it sits perfectly at `[0, 0, 0]`.
    3.  Rewrite `sweep_cavity_sdf` so it natively sweeps from the `+X` muzzle down to the `-X` entrance without reversing the output grid. Index `0` will naturally be the Entrance.

### Step 3: Frontend Cleanup (`web/components/Scene.tsx` & `web/app/page.tsx`)
The frontend must trust the backend and stop applying manual transformations.
*   **Action:**
    1.  Remove the `rotateY(Math.PI)` applied to the gun mesh in the `MoldAssets` and `ProcessingSimulation` components.
    2.  Remove any manual centering or `-gunCenter.x` shifts; the mesh arrives already centered.
    3.  Remove the `direction` props and conditional flipping logic from the `FeatureOverlays` and `DebugLabels`. The frontend will just render the points exactly as they exist in HAS world space.

### Step 4: Feature Frame Standardization (`web/lib/featuresFrame.ts` & Overlays)
Features (like the trigger wedge or sight channel) are conceptually designed to point "backwards" toward the holster entrance.
*   **Action:**
    1.  Update `flfFromPoints`: For single-point features, the default Identity Matrix must be rotated 180 degrees around Y. This ensures the local `+X` axis of the feature points toward the World `-X` (Entrance).
    2.  For multi-point features (Gun Band), ensure the calculated X-axis points exactly from the first click to the second click in 3D space.
    3.  Update all overlay components (`overlay.tsx`) to use robust Matrix/Quaternion transformations (`makeBasis` or `setFromRotationMatrix`) instead of manual Euler angles, ensuring they perfectly respect the Feature-Local Frame.

### Step 5: Carver Synchronization (`web/features/*/apply.py`)
The Python feature carvers must map the HAS world coordinates directly to the voxel grid.
*   **Action:**
    1.  Update every `apply.py` script so that mapping grid indices to world coordinates is a simple, linear equation: `gx = origin[0] + i * pitch`.
    2.  Ensure local frame projections (`R_inv @ dw`) use the correctly oriented matrices provided by the frontend state.
    3.  Remove any legacy hacks that tried to account for the old flipped grid or shifted origins.

## Testing Strategy
1.  Load the migrated `sig_p320-HAS` config file.
2.  In the Tagging View (Step 1.5), verify that the gun's muzzle points to the right (+X) and that the feature wireframes appear exactly where they should on the gun.
3.  Process the file.
4.  In the Mold View (Step 3), verify that the generated mold has the features carved in the exact same physical locations as the preview, without any mirroring, offset, or clipping issues.
5.  Verify the clay block animation moves smoothly from left (-X) to right (+X).