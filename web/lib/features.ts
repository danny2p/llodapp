// Feature registry types and helpers.
//
// The actual list of features lives in `web/features/index.ts` (a barrel that
// imports each plugin folder under `web/features/<id>/`). Each plugin folder
// owns its TS metadata (`feature.ts`), its R3F overlay (`overlay.tsx`), and
// its Python carver (`apply.py`). This file just defines the shared shapes
// and helpers, then re-exports `FEATURES` so existing call sites keep working.

import type { ComponentType } from "react";
import type { FLF, Vec3 } from "./featuresFrame";

export type NumberParam = {
  id: string;
  type: "number";
  label: string;
  code?: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  default: number;
  hint?: string;
};

export type ToggleParam = {
  id: string;
  type: "toggle";
  label: string;
  code?: string;
  default: boolean;
  hint?: string;
};

export type SelectParam = {
  id: string;
  type: "select";
  label: string;
  code?: string;
  options: number[];
  default: number;
};

export type FeatureParam = NumberParam | ToggleParam | SelectParam;

export type FeaturePointSlot = {
  id: string;
  label: string;
  hint?: string;
};

export type FeatureValue = number | boolean | string;

export type FeatureIntent = "additive" | "subtractive" | "marker";

export type FeatureState = {
  enabled: boolean;
  points: (Vec3 | null)[];
  values: Record<string, FeatureValue>;
};

export type FeatureStates = Record<string, FeatureState>;

// Global pipeline parameters — not tied to any one feature.
export type GlobalParams = {
  voxelPitch: number;
  smoothSigma: number;
  smoothIter: number;
  plugDecimTarget: number;
  gunDecimTarget: number;
  mirror: boolean;
  rotateZDeg: number;
  gunColor: string;
  moldColor: string;
  totalLength: number;
};

// Props passed to a feature's R3F overlay component.
export type FeatureOverlayProps = {
  def: FeatureDef;
  state: FeatureState;
  flf: FLF;
};

export type FeatureDef = {
  id: string;
  label: string;
  description?: string;
  color: string;
  published: boolean;
  enabledByDefault: boolean;
  points: FeaturePointSlot[];
  params: FeatureParam[];
  intent: FeatureIntent;
  // Optional R3F renderer. Marker-only features (no preview geometry) omit it.
  Overlay?: ComponentType<FeatureOverlayProps>;
};

// Re-export the registry from the plugin barrel so `@/lib/features` stays the
// single import path everything else uses.
import { FEATURES } from "@/features";
export { FEATURES };

export const FEATURES_BY_ID: Record<string, FeatureDef> = Object.fromEntries(
  FEATURES.map((f) => [f.id, f]),
);

export function publishedFeatures(): FeatureDef[] {
  return FEATURES.filter((f) => f.published);
}

// Build the initial FeatureStates map from the registry.
export function initialFeatureStates(): FeatureStates {
  const out: FeatureStates = {};
  for (const def of FEATURES) {
    const values: Record<string, FeatureValue> = {};
    for (const p of def.params) values[p.id] = p.default;
    out[def.id] = {
      enabled: def.enabledByDefault,
      points: def.points.map(() => null),
      values,
    };
  }
  return out;
}

// Count of tagged / required points for an enabled feature, for progress UI.
export function featureProgress(def: FeatureDef, state: FeatureState) {
  const required = def.points.length;
  const tagged = state.points.filter((p) => p !== null).length;
  return { tagged, required, complete: tagged === required };
}

// Published + enabled features with all their points tagged.
export function areAllFeaturesReady(states: FeatureStates): boolean {
  for (const def of FEATURES) {
    if (!def.published) continue;
    const s = states[def.id];
    if (!s || !s.enabled) continue;
    if (!featureProgress(def, s).complete) return false;
  }
  return true;
}
