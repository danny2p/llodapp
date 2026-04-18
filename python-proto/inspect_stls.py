"""Inspect every STL in the project data folders and print a comparison table.

Reports face count, vertex count, bounding box size, watertightness, and
whether the winding looks consistent. The point is to (a) pick a good test
case and (b) learn the target face-count from the glock/ reference files
the user calls their "target aesthetic".
"""

from pathlib import Path

import numpy as np
import trimesh
from rich.console import Console
from rich.table import Table

DATA_DIR = Path(__file__).resolve().parent.parent

INPUT_SCANS = [
    ("sig.stl", "input scan"),
    ("hellcat-mesh.stl", "input scan (hi-res)"),
    ("hellcat-mesh-simplified.stl", "input scan (simplified variant)"),
]

TARGET_REFS = [
    ("glock/glock.stl", "target aesthetic (back)"),
    ("glock/glock-front.stl", "target aesthetic (front)"),
]


def inspect(path: Path) -> dict:
    mesh: trimesh.Trimesh = trimesh.load_mesh(path, process=False)
    bbox = mesh.bounds[1] - mesh.bounds[0]
    return {
        "faces": len(mesh.faces),
        "verts": len(mesh.vertices),
        "bbox_mm": bbox,
        "watertight": mesh.is_watertight,
        "winding_ok": mesh.is_winding_consistent,
        "volume_mm3": mesh.volume if mesh.is_watertight else float("nan"),
    }


def main() -> None:
    console = Console()
    table = Table(title="STL inventory")
    for col in ("file", "role", "faces", "verts", "bbox (mm)", "watertight", "winding", "volume (cm^3)"):
        table.add_column(col, overflow="fold")

    for rel, role in INPUT_SCANS + TARGET_REFS:
        path = DATA_DIR / rel
        if not path.exists():
            table.add_row(rel, role, "[missing]", "", "", "", "", "")
            continue
        s = inspect(path)
        bbox = s["bbox_mm"]
        vol = s["volume_mm3"]
        vol_str = f"{vol / 1000:.1f}" if np.isfinite(vol) else "n/a"
        table.add_row(
            rel,
            role,
            f"{s['faces']:,}",
            f"{s['verts']:,}",
            f"{bbox[0]:.1f} x {bbox[1]:.1f} x {bbox[2]:.1f}",
            "yes" if s["watertight"] else "NO",
            "ok" if s["winding_ok"] else "BAD",
            vol_str,
        )

    console.print(table)


if __name__ == "__main__":
    main()
