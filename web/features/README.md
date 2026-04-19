# Feature Plugins

Each placeable feature on the mold (trigger retention, slide release,
ejection port, etc.) lives in its own folder under `web/features/`. Drop
a folder in, append one line to `index.ts`, and the UI and Python
pipeline both pick it up.

## Folder layout

```
web/features/
├── index.ts                        # barrel — defines registry order
├── <feature_id>/
│   ├── feature.ts                  # metadata + param schema (TS)
│   ├── overlay.tsx                 # R3F preview renderer (TS)
│   └── apply.py                    # voxel carver (Python)
└── ...
```

The folder name is the feature id. It must match `feature.id` inside
`feature.ts` — the Python loader keys `apply.py` by folder name and the
frontend keys state by `feature.id`, so a mismatch silently drops the
feature.

Marker-only features (collect a coord, no geometry) omit `overlay.tsx`
and `apply.py`. `ejection_port` is the current example.

## The three files

### `feature.ts` — metadata

Exports a default `FeatureDef` (see `web/lib/features.ts`):

```ts
import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "my_feature",            // must match folder name
  label: "My Feature",
  description: "One-line description shown in the UI.",
  color: "#22D3EE",            // overlay + marker color
  published: true,             // false hides it from the workflow
  enabledByDefault: true,
  points: [
    { id: "anchor", label: "My Feature", hint: "Tag here." },
  ],
  params: [
    { id: "widthY", type: "number", label: "Width", code: "W",
      unit: "mm", min: 4, max: 30, step: 1, default: 12 },
    { id: "oneSide", type: "toggle", label: "One Side",
      default: false, hint: "..." },
  ],
  Overlay,                     // omit for marker-only features
};

export default feature;
```

Param types: `number`, `toggle`, `select`. The param `id` is the key the
param panel, the overlay, and `apply.py` all read from `state.values`.

### `overlay.tsx` — 3D preview

A React Three Fiber component. Gets `{def, state, flf}`:

- `state.values` — current slider/toggle values (keyed by param id)
- `state.points[0]` — tagged world coords, `[x, y, z]` in mm
- `flf` — Feature-Local Frame: `{origin, R}`. Origin is the first tagged
  point. `+X` points toward the holster entrance, `+Y` up, `+Z` gun's
  left. For single-point features `R` is identity — just translate by
  `flf.origin`.

Render a transparent wireframe mesh in `def.color` so the user sees
exactly what will be carved. See `slide_release/overlay.tsx` for a
working example.

### `apply.py` — voxel carver

Exports an `apply()` function called once per enabled, tagged feature:

```python
def apply(cavity_bin, origin, pitch, *, state, insertion_vox, context, console):
    v = state["values"]
    coords = state["points"][0]   # [x, y, z] in aligned-gun mm
    # ... mutate a float32 copy of cavity_bin ...
    return cavity_f, origin
```

Arguments:

| name           | meaning                                                     |
| -------------- | ----------------------------------------------------------- |
| `cavity_bin`   | `(nx, ny, nz)` bool/float32 voxel grid of the mold cavity   |
| `origin`       | `(3,)` world mm coords of voxel `[0,0,0]`                   |
| `pitch`        | voxel edge length in mm                                     |
| `state`        | `{enabled, points, values}` — same shape as the TS state    |
| `insertion_vox`| index 0 is the holster entrance, this is the insertion depth in voxels |
| `context`      | shared extras (`context["tg"]` is the auto-detected trigger guard, or `None`) |
| `console`      | `rich.console.Console` — use `console.print(...)` for logs  |

Return `(cavity_f, origin)`. Writing floats < 1.0 into the grid gives
sub-voxel precision at the carve boundary (see `slide_release/apply.py`).

Coordinate convention matches the frontend FLF: +X is the holster
entrance. Index 0 of `cavity_bin[:, j, k]` is the entrance, so channels
that carve "forward to the entrance" run from the tagged point toward
`i = 0`.

## How the pieces connect

### Frontend

- `web/features/index.ts` imports every plugin folder and exports an
  ordered `FEATURES` array. **Registry order lives here** — both the UI
  and the Python pipeline iterate in this order.
- `web/lib/features.ts` defines the shared types (`FeatureDef`,
  `FeatureState`, `FeatureOverlayProps`, ...) and re-exports `FEATURES`
  so the rest of the app keeps importing from `@/lib/features`.
- `Scene.tsx` maps over `FEATURES` and renders `<def.Overlay />` for any
  feature that is enabled, tagged, and ships one. No per-feature code in
  Scene.
- The Tagger and ParamPanel drive off `def.points` / `def.params` — no
  edits needed when you add a new feature.

### Backend

- `python-proto/features_loader.py` does an `importlib` walk over
  `../web/features/*/apply.py` at pipeline startup and returns
  `{feature_id: apply_fn}`.
- `prototype_v11_mabr.py` reads `features_state.json` (written by
  `api.py` from the `features_state` form field), then for each enabled
  entry with a tagged point, calls `appliers[fid](...)` once. Marker-only
  features (no `apply.py`) are skipped automatically.
- JSON dict iteration preserves insertion order, and the frontend
  serializes in registry order, so backend apply order matches the
  frontend barrel.

## Adding a new feature

1. Copy an existing folder (e.g. `trigger_retention/`) and rename it to
   your feature id.
2. Edit `feature.ts` — new id, label, color, points, params.
3. Rewrite `overlay.tsx` — build a `THREE.BufferGeometry` that matches
   what your `apply.py` will carve.
4. Rewrite `apply.py` — mutate the voxel grid using `state["values"]`
   and `state["points"]`.
5. Add one line to `web/features/index.ts`:
   ```ts
   import myFeature from "./my_feature/feature";
   export const FEATURES = [..., myFeature];
   ```
6. Restart the FastAPI server (it loads appliers once at startup) and
   refresh the Next.js dev server.

## Shared convention: the FLF

The Feature-Local Frame is the handshake between `overlay.tsx` and
`apply.py`. If both sides honor it, the wireframe preview and the carved
cavity line up exactly.

- origin = first tagged point, in aligned-gun mm
- +X = holster entrance
- +Y = up (away from grip)
- +Z = gun's left

The detailed spec and helper functions (`flfFromPoints`, `flfToWorld`)
live in `web/lib/featuresFrame.ts`.
