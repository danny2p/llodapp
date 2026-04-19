# LLOD Holster Workshop

A high-fidelity prototype for generating 3D-printable holster molds from firearm scan data.

## Features

- **Automated Alignment:** Uses RANSAC plane detection to find the slide's thickness axis and Minimum Area Bounding Rectangle (MABR) for in-plane rotation.
- **Functional Carving:** Generates holster cavity geometry via a swept voxel union approach, ensuring smooth "clay imprint" results.
- **Parametric Features:**
    - **Trigger Retention:** Add ramped triangular bumps with configurable offset, length, width, depth, and corner rounding.
    - **Slide Release Relief:** Carve rectangular clearance channels for slide releases, swept forward to the holster entrance.
- **Voxel-to-Mesh Pipeline:**
    - Voxelization for robust handling of messy STL input.
    - Gaussian smoothing and Taubin mesh smoothing to eliminate stair-stepping on radiused edges.
    - Quadric decimation for optimized face counts.
- **Interactive UI:** 
    - Real-time 3D preview with wireframe overlays for feature placement.
    - Drag-and-drop accessory placement (e.g., DCC clips, spacers) with manual X/Y/Z coordinate control.
    - Unified or split-half view modes.
- **Merged Exports:** Automatically merges placed accessories into the final STL exports for direct 3D printing.

## Tech Stack

- **Backend:** FastAPI, Trimesh, NumPy, SciPy, Open3D, scikit-image, rtree.
- **Frontend:** Next.js (App Router), React Three Fiber (R3F), Drei, Three.js.

## Getting Started

### Prerequisites

- Python 3.12+
- Node.js 20+
- `uv` (recommended for Python package management)

### Backend Setup

```bash
cd python-proto
uv venv
source .venv/bin/activate
uv sync
python api.py
```

The API will be available at `http://127.0.0.1:8000`.

### Frontend Setup

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Project Structure

- `python-proto/`: Core Python pipeline and FastAPI server.
    - `prototype_v11_mabr.py`: The main processing engine.
    - `api.py`: FastAPI endpoints for alignment, processing, and merged exports.
    - `merge_accessories.py`: Utility for transforming and joining STLs.
    - `split_plug.py`: Slices the unified mold into left/right halves.
- `web/`: Next.js web application.
    - `app/page.tsx`: Main UI and state management.
    - `components/Scene.tsx`: 3D viewer logic and feature overlays.
- `accessories/`: Folder for accessory STL files available to the UI.
