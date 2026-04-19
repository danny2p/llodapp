import type { FeatureDef } from "@/lib/features";
import Overlay from "./overlay";

const feature: FeatureDef = {
  id: "sight_channel",
  label: "Sight Channel",
  description: "Additive rectangular ridge to clear iron sights during draw.",
  color: "#5eead4", // Teal (additive)
  published: true,
  enabledByDefault: false,
  intent: "additive",
  points: [
    { id: "origin", label: "Front Bottom Edge", hint: "The point where the channel starts (nearest the muzzle)." },
  ],
  params: [
    { id: "height",    type: "number", label: "Height (Y)",  unit: "mm",  default: 10,  min: 2,   max: 50,  step: 1,   hint: "Vertical extension from the slide." },
    { id: "depth",     type: "number", label: "Depth (Z)",   unit: "mm",  default: 6,   min: 1,   max: 30,  step: 1,   hint: "Thickness of the ridge." },
    { id: "length",    type: "number", label: "Length (X)",  unit: "mm",  default: 160, min: 20,  max: 300, step: 1,   hint: "Distance from click toward the grip." },
    { id: "rotateZ",   type: "number", label: "Rotate Z",    unit: "deg", default: 0,   min: -90, max: 90,  step: 1,   hint: "Angle alignment on the slide." },
    { id: "bothSides", type: "toggle", label: "Both Sides",  code: "±",   default: true, hint: "Mirror onto both mold halves." },
  ],
  Overlay,
};

export default feature;
