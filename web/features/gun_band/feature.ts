import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "gun_band",
  label: "Gun Band",
  description: "Additive parallelogram band defined by two anchor points forming the leading diagonal edge. Typically runs from the top rear of the slide down to the front base of the grip, following the gun's grip angle.",
  color: "#5EEAD4",
  published: true,
  enabledByDefault: false,
  intent: "additive",
  points: [
    { id: "p0", label: "Band Top",    hint: "Start of the leading edge — typically near the top of the slide at the rear of the ejection port." },
    { id: "p1", label: "Band Bottom", hint: "End of the leading edge — typically near the base of the grip at the front edge." },
  ],
  params: [
    { id: "width",        type: "number", label: "Width",          code: "W",  unit: "mm", default: 20, min: 5,   max: 80, step: 0.5, hint: "Band extent along the X axis (insertion direction)." },
    { id: "depthZ",       type: "number", label: "Depth Z",        code: "D",  unit: "mm", default: 10, min: 1,   max: 40, step: 0.5, hint: "Z stand-off proud of the gun surface." },
    { id: "extendTop",    type: "number", label: "Extend Top",     code: "ET", unit: "mm", default: 12, min: 0,   max: 50, step: 0.5, hint: "Extend the band past the Band Top point (p0) along the edge direction." },
    { id: "extendBottom", type: "number", label: "Extend Bottom",  code: "EB", unit: "mm", default: 0,  min: 0,   max: 50, step: 0.5, hint: "Extend the band past the Band Bottom point (p1) along the edge direction." },
    { id: "offsetX",      type: "number", label: "Offset X",       code: "Δx", unit: "mm", default: 0,  min: -20, max: 20, step: 0.5, hint: "Shift the band along the X axis." },
    { id: "offsetY",      type: "number", label: "Offset Y",       code: "Δy", unit: "mm", default: 0,  min: -20, max: 20, step: 0.5, hint: "Shift the band along the Y axis." },
    { id: "chamfer",      type: "number", label: "Chamfer Length", code: "CL", unit: "mm", default: 1,  min: 0,   max: 50, step: 0.5, hint: "Length along the edge over which the chamfer ramp runs." },
    { id: "chamferDepth", type: "number", label: "Chamfer Depth",  code: "CD", unit: "mm", default: 10, min: 0,   max: 40, step: 0.5, hint: "How far back in Z the chamfer drops from the proud face. Match Depth Z for a full diagonal to the midplane." },
  ],
  Overlay,
};

export default feature;
