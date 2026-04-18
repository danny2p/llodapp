"""Verify watertightness after merging duplicate vertices.

STL is a triangle-soup format, so trimesh sees separate copies of every
shared vertex until we explicitly merge. If the mesh is watertight after
merging, we know the geometry is fine and we only need to weld on export.
"""

from pathlib import Path

import trimesh
from rich.console import Console
from rich.table import Table

OUT_DIR = Path(__file__).resolve().parent / "out"


def check(path: Path) -> dict:
    m = trimesh.load_mesh(path, process=False)
    before = {
        "faces": len(m.faces),
        "verts": len(m.vertices),
        "watertight": m.is_watertight,
    }
    m.merge_vertices()
    m.update_faces(m.unique_faces())
    m.remove_unreferenced_vertices()
    after = {
        "faces": len(m.faces),
        "verts": len(m.vertices),
        "watertight": m.is_watertight,
        "winding_ok": m.is_winding_consistent,
        "euler": m.euler_number,
    }
    return {"path": path.name, "before": before, "after": after}


def main() -> None:
    console = Console()
    table = Table(title="Watertight check after vertex merge")
    for col in (
        "file",
        "faces before",
        "verts before",
        "WT before",
        "faces after",
        "verts after",
        "WT after",
        "winding",
        "euler",
    ):
        table.add_column(col)

    for path in sorted(OUT_DIR.glob("*.stl")):
        r = check(path)
        b, a = r["before"], r["after"]
        table.add_row(
            r["path"],
            f"{b['faces']:,}",
            f"{b['verts']:,}",
            "yes" if b["watertight"] else "no",
            f"{a['faces']:,}",
            f"{a['verts']:,}",
            "yes" if a["watertight"] else "no",
            "ok" if a["winding_ok"] else "bad",
            str(a["euler"]),
        )

    console.print(table)


if __name__ == "__main__":
    main()
