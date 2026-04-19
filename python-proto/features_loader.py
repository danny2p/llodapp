"""Load per-feature carvers from the plugin folders under web/features/.

Each feature folder ships an `apply.py` that exports a function:

    def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
        ...
        return cavity_f, origin

This loader walks `../web/features/*/apply.py` (relative to this file),
imports each one, and returns an ordered map of {feature_id: apply_fn}.
The feature_id is taken from the folder name. Folders without an
`apply.py` (marker-only features like ejection_port) are skipped.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Callable

ApplyFn = Callable[..., tuple]

_FEATURES_DIR = (Path(__file__).resolve().parent.parent / "web" / "features").resolve()


def _load_module(feature_id: str, apply_path: Path):
    mod_name = f"_llod_feature_{feature_id}"
    spec = importlib.util.spec_from_file_location(mod_name, apply_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not load spec for {apply_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    return module


def load_appliers(features_dir: Path | None = None) -> dict[str, ApplyFn]:
    """Return {feature_id: apply_fn} discovered under web/features/."""
    base = (features_dir or _FEATURES_DIR).resolve()
    if not base.is_dir():
        return {}
    appliers: dict[str, ApplyFn] = {}
    for child in sorted(base.iterdir()):
        if not child.is_dir():
            continue
        apply_path = child / "apply.py"
        if not apply_path.is_file():
            continue
        module = _load_module(child.name, apply_path)
        fn = getattr(module, "apply", None)
        if not callable(fn):
            raise AttributeError(
                f"{apply_path} must export a callable named `apply`"
            )
        appliers[child.name] = fn
    return appliers
