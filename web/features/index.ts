// Feature registry — append one line per plugin folder. The order here
// defines iteration order on both sides (frontend UI and Python carver).
// Python walks the same folders via features_loader.py.

import type { FeatureDef } from "@/lib/features";
import triggerRetention from "./trigger_retention/feature";
import slideRelease from "./slide_release/feature";
import ejectionPort from "./ejection_port/feature";
import genericCut from "./generic_cut/feature";
import triggerPlaten from "./trigger_platen/feature";
import slideCircles from "./slide_circles/feature";
import sightChannel from "./sight_channel/feature";
import gunBand from "./gun_band/feature";
import muzzleCut from "./muzzle_cut/feature";
import nub from "./nub/feature";

export const FEATURES: FeatureDef[] = [
  triggerRetention,
  slideRelease,
  ejectionPort,
  genericCut,
  triggerPlaten,
  slideCircles,
  sightChannel,
  gunBand,
  muzzleCut,
  nub,
];
