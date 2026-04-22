import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "generic_cut",
  label: "Generic Cut",
  description: "Rectangular extrusion to cut away mold geometry. Ideal for angled rear cuts.",
  color: "#EF4444", // Red (subtractive)
  published: true,
  enabledByDefault: false,
  allowMultiple: true,
  intent: "subtractive",
  points: [
    { id: "origin", label: "Top Corner" },
  ],
  params: [
    { id: "width",  type: "number", label: "Width",   unit: "mm", default: 100, min: 10,  max: 300, step: 1,   hint: "Length along X axis" },
    { id: "height", type: "number", label: "Height",  unit: "mm", default: 100, min: 10,  max: 300, step: 1,   hint: "Length along Y axis" },
    { id: "depth",  type: "number", label: "Depth",   unit: "mm", default: 50,  min: 1,   max: 200, step: 1,   hint: "Extrusion depth (Z)" },
    { id: "rotateZ",type: "number", label: "Rotate Z",unit: "deg",default: 0,   min: -180,max: 180, step: 1,   hint: "Rotation on the surface" },
    { id: "offsetX",type: "number", label: "Offset X",unit: "mm", default: 0,   min: -100,max: 100, step: 0.5, hint: "Move relative to click" },
    { id: "offsetY",type: "number", label: "Offset Y",unit: "mm", default: 0,   min: -100,max: 100, step: 0.5, hint: "Move relative to click" },
  ],
  Overlay,
};

export default feature;
