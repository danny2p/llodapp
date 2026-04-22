import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "generic_cut",
  label: "Generic Cut",
  description: "Centered rectangular carve-out with adjustable front/rear interior chamfers.",
  color: "#EF4444", // Red (subtractive)
  published: true,
  enabledByDefault: false,
  allowMultiple: true,
  intent: "subtractive",
  points: [
    { id: "anchor", label: "Anchor Point" },
  ],
  params: [
    { id: "width",    type: "number", label: "Width (X)",  unit: "mm", default: 7, min: 1,   max: 100, step: 0.5 },
    { id: "height",   type: "number", label: "Height (Y)", unit: "mm", default: 7, min: 1,   max: 100, step: 0.5 },
    { id: "depth",    type: "number", label: "Depth (Z)",  unit: "mm", default: 5, min: 1,   max: 50,  step: 0.5 },
    { id: "rotateZ",  type: "number", label: "Rotation",   unit: "deg",default: 0, min: -180,max: 180, step: 1 },
    { id: "offsetX",  type: "number", label: "Offset X",   unit: "mm", default: 0, min: -50, max: 50,  step: 0.5, hint: "Move box relative to handle." },
    { id: "offsetY",  type: "number", label: "Offset Y",   unit: "mm", default: 0, min: -50, max: 50,  step: 0.5, hint: "Move box relative to handle." },
    { id: "chamfer",  type: "number", label: "Chamfer",    unit: "mm", default: 1, min: 0,   max: 10,  step: 0.1, hint: "Slope at front/rear interior walls." },
  ],
  Overlay,
};

export default feature;
