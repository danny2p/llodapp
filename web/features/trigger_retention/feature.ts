import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "trigger_retention",
  label: "Trigger Retention",
  description: "Triangle indent behind trigger-guard front edge.",
  color: "#FBBF24",
  published: true,
  enabledByDefault: true,
  points: [
    {
      id: "anchor",
      label: "Trigger Guard Front",
      hint: "Front edge of the trigger guard.",
    },
  ],
  params: [
    { id: "frontOffset",  type: "number", label: "Front Offset",  code: "Δx", unit: "mm",  min: 0,    max: 20,  step: 0.5, default: 4,  hint: "Offset along +X from tagged anchor to the wedge's flat face." },
    { id: "length",       type: "number", label: "Length",        code: "L",  unit: "mm",  min: 4,    max: 40,  step: 1,   default: 16 },
    { id: "widthY",       type: "number", label: "Width Y",       code: "W",  unit: "mm",  min: 4,    max: 30,  step: 1,   default: 14 },
    { id: "depthZ",       type: "number", label: "Depth Z",       code: "D",  unit: "mm",  min: 0.5,  max: 10,  step: 0.1, default: 4 },
    { id: "yOffset",      type: "number", label: "Y Offset",      code: "Δy", unit: "mm",  min: -15,  max: 15,  step: 0.5, default: 0 },
    { id: "rotateZDeg",   type: "number", label: "Rotate Z",      code: "θ",  unit: "deg", min: -90,  max: 90,  step: 1,   default: 0 },
    { id: "cornerRadius", type: "number", label: "Radius",        code: "r",  unit: "mm",  min: 0,    max: 10,  step: 0.5, default: 2, hint: "Round the triangle's sharp corners." },
    { id: "oneSide",      type: "toggle", label: "One Side",      code: "±",  default: false, hint: "Default carves both +Z and -Z; enable to carve +Z only." },
  ],
  Overlay,
};

export default feature;
