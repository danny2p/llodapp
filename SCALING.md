# Scaling & Performance Roadmap

This document captures the architectural discussion regarding performance improvements for the LLOD Holster Workshop.

## Current State
- **Hardware:** DigitalOcean Droplet (8GB RAM, 2vCPU Intel NVMe).
- **Performance:** ~1 minute local, ~5 minutes cloud.
- **Bottlenecks:** CPU-bound serial processing, Python-native voxel loops, lack of task parallelization.

## Proposed Optimization Roadmap

### Level 1: Software Optimizations (CPU-bound)
1.  **JIT Compilation (Numba):**
    - Apply `@njit` to heavy voxel loops in `prototype_v11_mabr.py` (sweeping, SDF carving).
    - Transform O(N^3) Python loops into optimized machine code.
2.  **Task Parallelization (Multiprocessing):**
    - Fan-out the "Export" phase.
    - Run multiple decimation targets and split operations in parallel across all available vCPUs.
3.  **Algorithmic Caching:**
    - Cache the "Aligned Swept Voxel Grid".
    - Only re-run carving and mesh extraction if feature parameters change, skipping the 90% expensive alignment/voxelization steps.

### Level 2: Infrastructure Optimization
1.  **GCP Compute-Optimized (C3/C4):**
    - Move from shared vCPUs to high-clock-speed dedicated instances.
2.  **Memory Bandwidth:**
    - Voxel grid operations are memory-bandwidth sensitive; higher tier instances provide the necessary throughput for large 3D arrays.

### Level 3: GPU Acceleration (The "Nuclear" Option)
1.  **CuPy Integration:**
    - Replace `numpy` with `cupy` for grid operations.
    - Parallelize voxel "sweep" and "carve" logic on CUDA cores.
2.  **Accelerated Mesh Extraction:**
    - Use Open3D Tensor API or NVIDIA `nv-marching-cubes` for instant mesh generation.
3.  **Hardware Targeting:**
    - **GCP G2 Instances:** NVIDIA L4 GPU (24GB VRAM).
    - **Execution Model:** Use GCP Batch Jobs or Preemptible G2 workers to minimize costs for infrequent usage.

## Reference Goal
- **Target Processing Time:** ~10-15 seconds total in the cloud.
