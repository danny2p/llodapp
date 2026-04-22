import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "trigger_platen",
  label: "Trigger Platen",
  description: "Automatic internal wall centered on the gun midplane, providing a flat mounting surface.",
  color: "#5EEAD4", // Teal (additive)
  published: true,
  enabledByDefault: true,
  intent: "additive",
  points: [], // Automatic
  params: [
    { id: "thickness", type: "number", label: "Thickness", code: "Z", unit: "mm", default: 4, min: 1, max: 20, step: 0.5, hint: "Width of the plate (Z-depth)." },
  ],
  Overlay,
};

export default feature;
