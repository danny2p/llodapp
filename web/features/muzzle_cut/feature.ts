import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "muzzle_cut",
  label: "Muzzle Normalization",
  description: "Extrude a cross-section of the muzzle forward for extra clearance. Drag the green plane to select the profile.",
  color: "#4ADE80", // Green
  published: true,
  enabledByDefault: false,
  allowMultiple: false,
  intent: "additive",
  points: [
    { id: "cut", label: "Cut Location" },
  ],
  params: [
    { id: "extension", type: "number", label: "Extension", unit: "mm", default: 30, min: 1, max: 100, step: 1, hint: "Distance to extrude the profile forward." },
  ],
  Overlay,
};

export default feature;
