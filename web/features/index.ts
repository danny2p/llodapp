// Feature registry — append one line per plugin folder. The order here
// defines iteration order on both sides (frontend UI and Python carver).
// Python walks the same folders via features_loader.py.

import type { FeatureDef } from "@/lib/features";
import triggerRetention from "./trigger_retention/feature";
import slideRelease from "./slide_release/feature";
import ejectionPort from "./ejection_port/feature";

export const FEATURES: FeatureDef[] = [
  triggerRetention,
  slideRelease,
  ejectionPort,
];
