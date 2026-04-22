import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "nub",
  label: "Nub",
  description: "A small cylindrical protrusion that can be placed on the gun or platen surface.",
  color: "#5EEAD4", // Teal (additive)
  published: true,
  enabledByDefault: false,
  allowMultiple: true,
  intent: "additive",
  points: [
    { id: "origin", label: "Center Point" },
  ],
  params: [
    { id: "diameter", type: "number", label: "Diameter", unit: "mm", default: 2, min: 1, max: 20, step: 0.5 },
    { id: "height",   type: "number", label: "Height",   unit: "mm", default: 2, min: 0.5, max: 20, step: 0.5, hint: "Protrusion height from surface." },
  ],
  Overlay,
};

export default feature;
