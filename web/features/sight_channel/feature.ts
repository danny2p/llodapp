import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "sight_channel",
  label: "Sight Channel",
  description: "Automatic rectangular ridge centered on the slide to clear iron sights.",
  color: "#5eead4", // Teal (additive)
  published: true,
  enabledByDefault: true,
  intent: "additive",
  points: [], // No manual tagging required
  params: [
    { id: "length",    type: "number", label: "Length (X)",  unit: "mm",  default: 160, min: 10, max: 300, step: 5,   hint: "Total length of the sight channel." },
    { id: "height",    type: "number", label: "Height (Y)",  unit: "mm",  default: 10, min: 2,   max: 50,  step: 1,   hint: "Total vertical size (default: 5mm exposed, 5mm buried)." },
    { id: "width",     type: "number", label: "Width (Z)",   unit: "mm",  default: 6,  min: 1,   max: 30,  step: 1,   hint: "Ridge thickness centered on slide." },
    { id: "offsetX",   type: "number", label: "Offset X",   unit: "mm",  default: 0, min: -100,max: 100, step: 1,   hint: "Shift forward/backward along the slide." },
    { id: "offsetY",   type: "number", label: "Offset Y",   unit: "mm",  default: 50,  min: -50, max: 100, step: 0.5, hint: "Shift up/down relative to slide top." },
    { id: "rotateZ",   type: "number", label: "Rotate Z",    unit: "deg", default: 0,  min: -10, max: 10,  step: 0.5, hint: "Fine angle adjustment." },
  ],
  Overlay,
};

export default feature;
