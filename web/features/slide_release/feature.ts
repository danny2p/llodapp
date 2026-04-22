import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "slide_release",
  label: "Slide Release",
  description: "Clearance channel so the slide release can clear the mold.",
  color: "#5EEAD4",
  published: true,
  enabledByDefault: true,
  allowMultiple: true,
  intent: "additive",
  points: [
    {
      id: "anchor",
      label: "Slide Release",
      hint: "Top of the slide release button, on the side the shooter pushes.",
    },
  ],
  params: [
    { id: "widthY",  type: "number", label: "Width Y",  code: "W",  unit: "mm", min: 4, max: 30, step: 1,   default: 12 },
    { id: "depthZ",  type: "number", label: "Depth Z",  code: "D",  unit: "mm", min: 2, max: 15, step: 0.5, default: 6 },
    { id: "yOffset", type: "number", label: "Y Offset", code: "Δy", unit: "mm", min: -10, max: 10, step: 0.5, default: 0 },
    { id: "chamfer", type: "number", label: "Chamfer",  code: "c",  unit: "mm", min: 0, max: 10, step: 0.5, default: 2, hint: "45° cut on outer corners." },
  ],
  Overlay,
};

export default feature;
