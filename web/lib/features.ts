// Feature registry types and helpers.
//
// The actual list of features lives in `web/features/index.ts` (a barrel that
// imports each plugin folder under `web/features/<id>/`). Each plugin folder
// owns its TS metadata (`feature.ts`), its R3F overlay (`overlay.tsx`), and
// its Python carver (`apply.py`). This file just defines the shared shapes
// and helpers, then re-exports `FEATURES` so existing call sites keep working.

import type { ComponentType } from "react";
import type { FLF, Vec3 } from "./featuresFrame";
import * as THREE from "three";

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

export type FeatureStates = Record<string, FeatureState[]>;

// Global pipeline parameters — not tied to any one feature.
export type GlobalParams = {
  voxelPitch: number;
  mcStepSize: number;
  smoothSigma: number;
  smoothIter: number;
  plugDecimTarget: number;
  gunDecimTarget: number;
  mirror: boolean;
  rotateZDeg: number;
  gunColor: string;
  moldColor: string;
  totalLength: number;
  featureStates?: FeatureStates;
};

// Props passed to a feature's R3F overlay component.
export type FeatureOverlayProps = {
  def: FeatureDef;
  state: FeatureState;
  color: string;
  flf: FLF;
  globalParams: GlobalParams;
  muzzleX: number;
  gunBounds: {
    size: THREE.Vector3;
    center: THREE.Vector3;
    slideTopY: number;
  } | null;
  activeTag?: { featureId: string; instanceIndex: number; pointIndex: number } | null;
  onTagPoint?: (featureId: string, instanceIndex: number, pointIndex: number, coords: Vec3) => void;
};

export type FeatureDef = {
  id: string;
  label: string;
  description?: string;
  color: string;
  published: boolean;
  enabledByDefault: boolean;
  allowMultiple?: boolean;
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

/**
 * Generate a deterministic color for a feature instance based on its base color
 * and index. 
 */
export function getInstanceColor(baseColor: string, index: number): string {
  // First instance always respects the feature's defined base color
  if (index === 0) return baseColor;
  
  // High-contrast secondary colors for common features
  const upperBase = baseColor.toUpperCase();
  
  // If base is Teal (#5EEAD4), secondary is Electric Lime (#BFFF00)
  if (upperBase === "#5EEAD4") return "#BFFF00";
  
  // If base is Red (#EF4444) or similar, secondary could be Orange or Yellow
  if (upperBase === "#EF4444") return "#F59E0B"; // Amber/Orange

  // Fallback: Deterministic shift based on base color
  const color = new THREE.Color(baseColor);
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  
  // Shift hue and lightness for contrast
  hsl.h = (hsl.h + (index * 0.15)) % 1;
  hsl.l = hsl.l > 0.5 ? hsl.l - 0.2 : hsl.l + 0.2;
  
  return "#" + color.setHSL(hsl.h, hsl.s, hsl.l).getHexString();
}

// Build the initial FeatureStates map from the registry.
export function initialFeatureStates(): FeatureStates {
  const out: FeatureStates = {};
  for (const def of FEATURES) {
    const values: Record<string, FeatureValue> = {};
    for (const p of def.params) values[p.id] = p.default;
    out[def.id] = [
      {
        enabled: def.enabledByDefault,
        points: def.points.map(() => null),
        values,
      },
    ];
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
    const instances = states[def.id];
    if (!instances) continue;
    
    for (const s of instances) {
      if (!s.enabled) continue;
      if (!featureProgress(def, s).complete) return false;
    }
  }
  return true;
}

// Published + enabled features with all their points tagged.
export function isAnyFeatureReady(states: FeatureStates): boolean {
  for (const def of FEATURES) {
    if (!def.published) continue;
    const instances = states[def.id];
    if (!instances) continue;
    
    for (const s of instances) {
      if (s.enabled && featureProgress(def, s).complete) return true;
    }
  }
  return false;
}
