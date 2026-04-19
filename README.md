# LLOD Holster Workshop

A high-fidelity prototype for generating 3D-printable holster molds from firearm scan data.

## Features

- **Automated Alignment:** Uses RANSAC plane detection to find the slide's thickness axis and Minimum Area Bounding Rectangle (MABR) for in-plane rotation.
- **Functional Carving:** Generates holster cavity geometry via a swept voxel union approach, ensuring smooth "clay imprint" results.
- **Parametric Features:** Pluggable — each feature is a self-contained folder under `web/features/` with its metadata, R3F overlay, and Python carver. See [`web/features/README.md`](web/features/README.md) for the contract. Ships with:
    - **Trigger Retention:** Ramped triangular indent with configurable offset, length, width, depth, and corner rounding.
    - **Slide Release Relief:** Rectangular clearance channel, swept forward to the holster entrance.
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

## Deployment

### Prerequisites (DigitalOcean Droplet)
- **Ubuntu 24.04**
- **Min 8GB RAM** (high-res voxelization is memory intensive)
- A **domain name** pointed to your Droplet IP.

### Deployment with SSL (using Caddy)

1.  **Install Docker**:
    ```bash
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    ```
2.  **Clone code**:
    ```bash
    git clone <your-repo-url> llod-maker
    cd llod-maker
    ```
3.  **Configure**:
    - Edit `Caddyfile`: Replace `yourdomain.com` with your domain and `your@email.com` with your email.
    - Edit `docker-compose.yml`: Replace `https://yourdomain.com` with your actual URL.
4.  **Open Firewall**:
    ```bash
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw reload
    ```
5.  **Deploy**:
    ```bash
    sudo docker compose up -d --build
    ```
