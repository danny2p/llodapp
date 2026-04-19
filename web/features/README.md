# LLOD Feature Plugin Architecture

This folder contains the modular plugins for holster features. Any new feature added here must strictly follow the **Geometric Synchronization** rules defined below to ensure the 3D wireframe preview and the physical voxel carving are aligned.

## Directory Structure
```text
web/features/<feature_id>/
├── feature.ts   # UI Metadata (sliders, labels, colors)
├── overlay.tsx  # Three.js wireframe preview
└── apply.py     # Python voxel carving logic
```

## The "Holy Trinity" of Synchronization

### 1. Feature-Local Frame (FLF)
Always use the shared FLF logic to anchor your geometry. 
- **Origin:** The first point the user clicked.
- **Orientation:** Automatically calculated to be tangential to the surface and muzzle-oriented.
- **In Python:** `from features_frame import flf_from_points`.
- **In React:** Component receives `flf` prop automatically.

### 2. The X-Axis Flip (CRITICAL)
The core mold-maker pipeline "sweeps" the gun silhouette. This process **reverses the X-axis** in the voxel grid.
- **Holster Entrance (Grip):** Is at Voxel Index `i = 0`.
- **Muzzle Tip:** Is at Voxel Index `i = insertion_vox - 1`.

#### Conversion Math:
When iterating through voxels in `apply.py`, you **must** map the current index `i` to the world `x` coordinate using this formula:
```python
# SWEPT INDEX -> WORLD X
world_x = origin[0] + (insertion_vox - 1 - i) * pitch

# WORLD X -> SWEPT INDEX (for bounding box optimization)
index_i = (insertion_vox - 1) - (world_x - origin[0]) / pitch
```

### 3. Sub-Voxel Precision
To avoid "lego-style" steps on your features, do not use binary (on/off) voxel logic.
- **Float Densities:** Set `cavity_f[i,j,k]` to fractional values (0.0 to 1.0).
- **Anti-Aliasing:** Calculate the distance to your feature's edge and use the remainder of the voxel pitch to determine the density. This results in CAD-smooth surfaces even at low voxel resolutions.

## Reference Implementations
- **trigger_retention:** Standard SDF-based ramped triangle.
- **slide_release:** Absolute planar targeting with 3D chamfering.
- **generic_cut:** Simple volume subtraction with rotation.
