import type { FeatureDef } from "@/lib/features";

const feature: FeatureDef = {
  id: "ejection_port",
  label: "Ejection Port",
  description: "Reference marker for the ejection port (no geometry yet).",
  color: "#F87171",
  published: false,
  enabledByDefault: false,
  points: [{ id: "anchor", label: "Ejection Port" }],
  params: [],
};

export default feature;
