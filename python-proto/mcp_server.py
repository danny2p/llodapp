"""MCP server: feature-plugin authoring for the LLOD Mold Maker.

Exposes file operations scoped to `web/features/` so Claude Desktop can
create, edit, and inspect feature plugins on this machine. The model
does the reasoning (what the feature should look like, what params it
needs); this server just gives it hands to touch the filesystem and
keeps the operations inside the plugin-contract guardrails.

Registering with Claude Desktop — add to
`~/Library/Application Support/Claude/claude_desktop_config.json`:

  {
    "mcpServers": {
      "llod-features": {
        "command": "/Users/dannyp/sites/ai/llod-maker/python-proto/.venv/bin/python",
        "args": ["/Users/dannyp/sites/ai/llod-maker/python-proto/mcp_server.py"]
      }
    }
  }

Next.js HMR and FastAPI's subprocess-per-job pattern mean the browser
picks up changes on the next pipeline run without restarting anything.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Literal

from mcp.server.fastmcp import FastMCP

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FEATURES_DIR = PROJECT_ROOT / "web" / "features"
INDEX_TS = FEATURES_DIR / "index.ts"

FEATURE_FILES = {"feature.ts", "overlay.tsx", "apply.py"}
ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

# Intent → default color + whether geometry files are required.
INTENT_DEFAULTS = {
    "additive":    {"color": "#5eead4", "needs_geometry": True},
    "subtractive": {"color": "#fde047", "needs_geometry": True},
    "marker":      {"color": "#94a3b8", "needs_geometry": False},
}

mcp = FastMCP("llod-features")


# ──────────────────────────────────────────────────────────────────
# helpers
# ──────────────────────────────────────────────────────────────────

def _feature_path(fid: str) -> Path:
    if not ID_PATTERN.match(fid):
        raise ValueError(f"invalid feature id {fid!r}: must match {ID_PATTERN.pattern}")
    p = (FEATURES_DIR / fid).resolve()
    if FEATURES_DIR.resolve() not in p.parents and p != FEATURES_DIR.resolve():
        raise ValueError(f"feature id {fid!r} resolves outside features dir")
    return p


def _camel(fid: str) -> str:
    parts = fid.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _read_index_ts() -> str:
    return INDEX_TS.read_text()


def _write_index_ts(content: str) -> None:
    INDEX_TS.write_text(content)


def _registered_ids() -> list[str]:
    """Return feature ids in registry order (by parsing index.ts imports)."""
    src = _read_index_ts()
    # match: import <camel> from "./<id>/feature";
    return [m.group(1) for m in re.finditer(
        r'import\s+\w+\s+from\s+"\./([a-z][a-z0-9_]*)/feature"', src
    )]


def _register_in_index(fid: str) -> None:
    """Append a registered feature to index.ts. Idempotent."""
    src = _read_index_ts()
    if fid in _registered_ids():
        return
    camel = _camel(fid)
    import_line = f'import {camel} from "./{fid}/feature";'

    # Insert import after the last import line.
    lines = src.splitlines()
    last_import = max(
        (i for i, ln in enumerate(lines) if ln.startswith("import ")),
        default=-1,
    )
    lines.insert(last_import + 1, import_line)

    # Append to FEATURES array before the closing `];`.
    out: list[str] = []
    inserted = False
    for ln in lines:
        if not inserted and ln.strip() == "];":
            # Ensure prior line ends with a comma.
            if out and out[-1].rstrip().endswith(","):
                pass
            elif out:
                out[-1] = out[-1].rstrip() + ","
            out.append(f"  {camel},")
            inserted = True
        out.append(ln)
    _write_index_ts("\n".join(out) + "\n")


def _unregister_from_index(fid: str) -> None:
    """Remove a feature's import and array entry from index.ts. Idempotent."""
    if fid not in _registered_ids():
        return
    src = _read_index_ts()
    camel = _camel(fid)
    # Drop matching import line.
    src = re.sub(
        rf'^\s*import\s+{re.escape(camel)}\s+from\s+"\./{re.escape(fid)}/feature";\s*\n',
        "",
        src,
        flags=re.MULTILINE,
    )
    # Drop array entry (with or without trailing comma).
    src = re.sub(rf"^\s*{re.escape(camel)},?\s*\n", "", src, flags=re.MULTILINE)
    _write_index_ts(src)


# ──────────────────────────────────────────────────────────────────
# templates
# ──────────────────────────────────────────────────────────────────

def _feature_ts_template(fid: str, label: str, description: str, intent: str,
                         color: str, points: list[dict], params: list[dict],
                         enabled_by_default: bool, published: bool) -> str:
    has_overlay = intent != "marker"
    points_ts = ",\n    ".join(
        "{ "
        + ", ".join(f'{k}: {repr(v) if not isinstance(v, bool) else str(v).lower()}' for k, v in pt.items())
        + " }"
        for pt in points
    ) or ""
    params_ts = ",\n    ".join(
        "{ "
        + ", ".join(
            f'{k}: {"true" if v is True else "false" if v is False else repr(v) if isinstance(v, str) else v}'
            for k, v in p.items()
        )
        + " }"
        for p in params
    ) or ""
    overlay_import = 'import Overlay from "./overlay";\n' if has_overlay else ""
    overlay_field = "  Overlay,\n" if has_overlay else ""
    return f'''import type {{ FeatureDef }} from "@/lib/features";
{overlay_import}
const feature: FeatureDef = {{
  id: "{fid}",
  label: "{label}",
  description: "{description}",
  color: "{color}",
  published: {"true" if published else "false"},
  enabledByDefault: {"true" if enabled_by_default else "false"},
  intent: "{intent}",
  points: [
    {points_ts}
  ],
  params: [
    {params_ts}
  ],
{overlay_field}}};

export default feature;
'''


def _overlay_tsx_template(fid: str, label: str) -> str:
    return f'''"use client";

import type {{ FeatureOverlayProps }} from "@/lib/features";

// Preview geometry for "{label}". Replace the placeholder with geometry
// that matches what apply.py carves so the user sees the same shape
// they'll get in the final mold.
export default function Overlay({{ def, state, flf }}: FeatureOverlayProps) {{
  return (
    <group position={{flf.origin as [number, number, number]}}>
      <mesh>
        <boxGeometry args={{[10, 10, 10]}} />
        <meshBasicMaterial color={{def.color}} wireframe transparent opacity={{0.5}} />
      </mesh>
    </group>
  );
}}
'''


def _apply_py_template(fid: str, label: str) -> str:
    return f'''"""{label} ({fid}) — voxel carver.

See web/features/README.md for the contract. Mutate a float32 copy of
cavity_bin, then return it. Writing values in [0, 1] gives sub-voxel
precision at boundaries.
"""

from __future__ import annotations

import numpy as np


def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    values = state["values"]
    points = state["points"]

    cavity_f = cavity_bin.astype("float32")

    # TODO: read values[...] and points[0] and mutate cavity_f.
    console.print(f"[yellow]{fid}: stub apply() — no geometry carved yet[/yellow]")

    return cavity_f, origin
'''


# ──────────────────────────────────────────────────────────────────
# tools
# ──────────────────────────────────────────────────────────────────

@mcp.tool()
def list_features() -> list[dict]:
    """List all feature plugins in registry order.

    Returns a list of {id, label, intent, published, has_overlay, has_apply,
    points_count, params_count} dicts. Use this for a quick inventory before
    deciding which feature to read/edit.
    """
    result = []
    for fid in _registered_ids():
        fdir = FEATURES_DIR / fid
        feature_ts = fdir / "feature.ts"
        if not feature_ts.exists():
            result.append({"id": fid, "error": "feature.ts missing"})
            continue
        src = feature_ts.read_text()
        label = _grep(src, r'label:\s*"([^"]+)"', "?")
        intent = _grep(src, r'intent:\s*"(additive|subtractive|marker)"', "?")
        published = "published: true" in src
        result.append({
            "id": fid,
            "label": label,
            "intent": intent,
            "published": published,
            "has_overlay": (fdir / "overlay.tsx").exists(),
            "has_apply": (fdir / "apply.py").exists(),
            "points_count": len(re.findall(r"\{\s*id:", _extract_array(src, "points"))),
            "params_count": len(re.findall(r"\{\s*id:", _extract_array(src, "params"))),
        })
    return result


def _grep(src: str, pattern: str, default: str) -> str:
    m = re.search(pattern, src)
    return m.group(1) if m else default


def _extract_array(src: str, name: str) -> str:
    # Return the substring between `points: [` and the matching `]`. Handles
    # nested braces but not nested brackets (which features don't use).
    m = re.search(rf"{name}:\s*\[", src)
    if not m:
        return ""
    i = m.end()
    depth = 1
    start = i
    while i < len(src) and depth > 0:
        c = src[i]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
        i += 1
    return src[start:i - 1]


@mcp.tool()
def read_feature(feature_id: str) -> dict:
    """Return the contents of a feature's three files.

    feature_id: folder name under web/features (e.g. "slide_release").
    Returns {id, feature_ts, overlay_tsx, apply_py, registered} — each file
    is either a string or null if the file doesn't exist. Use this before
    editing to see the current state.
    """
    fdir = _feature_path(feature_id)
    def _read(name: str) -> str | None:
        p = fdir / name
        return p.read_text() if p.exists() else None
    return {
        "id": feature_id,
        "feature_ts": _read("feature.ts"),
        "overlay_tsx": _read("overlay.tsx"),
        "apply_py": _read("apply.py"),
        "registered": feature_id in _registered_ids(),
    }


@mcp.tool()
def scaffold_feature(
    feature_id: str,
    label: str,
    description: str,
    intent: Literal["additive", "subtractive", "marker"],
    points: list[dict],
    params: list[dict],
    color: str | None = None,
    enabled_by_default: bool = False,
    published: bool = True,
    register: bool = True,
) -> dict:
    """Create a new feature plugin: folder + stub files + optional registry line.

    feature_id: snake_case, matches the folder name (e.g. "beavertail_ledge").
    intent: "additive" (teal, adds to cavity), "subtractive" (yellow, carves
      mold), or "marker" (no geometry, just stores a tagged point).
    points: list of {id, label, hint?} — tagged anchor points the user clicks.
      Use [] for auto-placed features (see sight_channel).
    params: list of {id, type, label, code?, unit?, default, min?, max?, step?, hint?}
      where type is "number" | "toggle" | "select".
    color: optional hex like "#5eead4"; defaults to the intent's convention.
    register: if True (default), append to web/features/index.ts so the
      feature appears in the UI and Python pipeline.

    Fails if the folder already exists. Use delete_feature first if you
    want to start over, or write_feature_file to edit in place.
    """
    if intent not in INTENT_DEFAULTS:
        raise ValueError(f"intent must be one of {list(INTENT_DEFAULTS)}")
    if color is None:
        color = INTENT_DEFAULTS[intent]["color"]
    elif not HEX_COLOR.match(color):
        raise ValueError(f"color must be #rrggbb hex, got {color!r}")

    fdir = _feature_path(feature_id)
    if fdir.exists():
        raise FileExistsError(f"{feature_id} already exists at {fdir}")

    fdir.mkdir(parents=True)
    (fdir / "feature.ts").write_text(_feature_ts_template(
        feature_id, label, description, intent, color,
        points, params, enabled_by_default, published,
    ))

    if INTENT_DEFAULTS[intent]["needs_geometry"]:
        (fdir / "overlay.tsx").write_text(_overlay_tsx_template(feature_id, label))
        (fdir / "apply.py").write_text(_apply_py_template(feature_id, label))

    if register:
        _register_in_index(feature_id)

    return {
        "id": feature_id,
        "path": str(fdir),
        "files_written": sorted(p.name for p in fdir.iterdir()),
        "registered": register,
    }


@mcp.tool()
def write_feature_file(
    feature_id: str,
    which: Literal["feature.ts", "overlay.tsx", "apply.py"],
    content: str,
) -> dict:
    """Overwrite one of the three files in a feature plugin.

    which: must be "feature.ts", "overlay.tsx", or "apply.py".
    content: full file contents (not a diff). Use read_feature first to
    see what's there, then send back the full updated file.
    """
    if which not in FEATURE_FILES:
        raise ValueError(f"which must be one of {sorted(FEATURE_FILES)}")
    fdir = _feature_path(feature_id)
    if not fdir.exists():
        raise FileNotFoundError(f"{feature_id} does not exist; scaffold it first")
    path = fdir / which
    path.write_text(content)
    return {"path": str(path), "bytes": len(content)}


@mcp.tool()
def validate_feature(feature_id: str) -> dict:
    """Quick sanity check on a feature plugin.

    Runs `python -m py_compile` on apply.py and does a lightweight
    regex check that feature.ts exports a default with id matching the
    folder name. Returns {ok, checks: {...}, errors: [...]} so the caller
    can decide whether to proceed.

    Does NOT run tsc — that's too heavy for a quick loop. Run the Next
    dev server and watch for compile errors for full TS validation.
    """
    fdir = _feature_path(feature_id)
    errors: list[str] = []
    checks: dict[str, Any] = {}

    # feature.ts: must exist, must have id matching folder name.
    ft = fdir / "feature.ts"
    if not ft.exists():
        errors.append("feature.ts missing")
    else:
        src = ft.read_text()
        id_match = re.search(r'id:\s*"([^"]+)"', src)
        checks["feature_ts_id"] = id_match.group(1) if id_match else None
        if not id_match or id_match.group(1) != feature_id:
            errors.append(f"feature.ts id does not match folder name {feature_id!r}")
        if "export default" not in src:
            errors.append("feature.ts has no `export default`")

    # apply.py: must compile (if present).
    ap = fdir / "apply.py"
    if ap.exists():
        proc = subprocess.run(
            [sys.executable, "-m", "py_compile", str(ap)],
            capture_output=True, text=True,
        )
        checks["apply_py_compile"] = "ok" if proc.returncode == 0 else "failed"
        if proc.returncode != 0:
            errors.append(f"apply.py compile error: {proc.stderr.strip()}")

    # Registry.
    checks["registered"] = feature_id in _registered_ids()
    if not checks["registered"]:
        errors.append("not registered in web/features/index.ts (use register_feature)")

    return {"ok": not errors, "checks": checks, "errors": errors}


@mcp.tool()
def register_feature(feature_id: str) -> dict:
    """Add an existing feature folder to web/features/index.ts.

    Useful if you scaffolded with register=False, or if the index got
    out of sync. Idempotent.
    """
    if not (_feature_path(feature_id) / "feature.ts").exists():
        raise FileNotFoundError(f"{feature_id}/feature.ts does not exist")
    _register_in_index(feature_id)
    return {"id": feature_id, "registered_ids": _registered_ids()}


@mcp.tool()
def delete_feature(feature_id: str, confirm: bool = False) -> dict:
    """Remove a feature plugin folder and unregister it from index.ts.

    Destructive — pass confirm=True to actually delete. Without confirm,
    returns what would be deleted so you can double-check first.
    """
    fdir = _feature_path(feature_id)
    if not fdir.exists():
        raise FileNotFoundError(f"{feature_id} does not exist")
    if not confirm:
        return {
            "would_delete": str(fdir),
            "would_unregister": feature_id in _registered_ids(),
            "confirm": False,
        }
    _unregister_from_index(feature_id)
    shutil.rmtree(fdir)
    return {"deleted": feature_id, "confirm": True}


if __name__ == "__main__":
    mcp.run()
