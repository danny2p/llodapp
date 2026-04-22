import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "slide_circles",
  label: "Slide Circles",
  description: "Set of 3 nested additive cylinders. Inner pins protrude 1mm above the outer bosses.",
  color: "#5eead4", // Teal (additive)
  published: true,
  enabledByDefault: true,
  allowMultiple: true,
  intent: "additive",
  points: [
    { id: "start", label: "Starting Point" },
  ],
  params: [
    { id: "outerDia",  type: "number", label: "Outer Diameter", unit: "mm", default: 10, min: 2,   max: 50,  step: 1,   hint: "Diameter of the larger cylinder" },
    { id: "innerDia",  type: "number", label: "Inner Diameter", unit: "mm", default: 2,  min: 0,   max: 20,  step: 0.5, hint: "Diameter of the smaller center hole" },
    { id: "spacing",   type: "number", label: "Spacing",        unit: "mm", default: 15, min: 5,   max: 100, step: 1,   hint: "Center-to-center distance" },
    { id: "height",    type: "number", label: "Height",         unit: "mm", default: 6,  min: 1,   max: 30,  step: 0.5, hint: "Extrusion height from surface" },
    { id: "rotateZ",   type: "number", label: "Rotate Z",       unit: "deg",default: 0,  min: -180,max: 180, step: 1,   hint: "Rotation on the surface" },
  ],
  Overlay,
};

export default feature;
