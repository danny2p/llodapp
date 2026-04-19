"""Feature-Local Frame (FLF) — shared geometric convention with the frontend.

Mirrors web/lib/featuresFrame.ts. Keep the conventions in lockstep:

    origin = first tagged point (aligned gun world coords, mm)
    +X     = toward holster entrance (muzzle side)
    +Y     = up (away from grip)
    +Z     = gun's left side

For a single-point feature, FLF is a pure translation (R = identity). For
multi-point features (e.g., start/end), origin = points[0] and +X is
oriented toward points[1] projected onto the XZ plane (preserving +Y).
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

import numpy as np

Vec3 = Tuple[float, float, float]

IDENTITY = np.eye(3)


class FLF:
    __slots__ = ("origin", "R")

    def __init__(self, origin: Sequence[float], R: Optional[np.ndarray] = None) -> None:
        self.origin = np.asarray(origin, dtype=float)
        self.R = IDENTITY if R is None else np.asarray(R, dtype=float)

    def to_world(self, local: Sequence[float]) -> np.ndarray:
        return self.origin + self.R @ np.asarray(local, dtype=float)

    def to_world_many(self, locals_: np.ndarray) -> np.ndarray:
        return self.origin + locals_ @ self.R.T


def flf_from_points(points: List[Optional[Sequence[float]]]) -> Optional[FLF]:
    if not points or points[0] is None:
        return None
    p0 = np.asarray(points[0], dtype=float)
    if len(points) < 2 or points[1] is None:
        return FLF(p0)

    p1 = np.asarray(points[1], dtype=float)
    dx, dz = p1[0] - p0[0], p1[2] - p0[2]
    length = float(np.hypot(dx, dz))
    if length < 1e-6:
        return FLF(p0)

    xh = np.array([dx / length, 0.0, dz / length])
    yh = np.array([0.0, 1.0, 0.0])
    zh = np.cross(xh, yh)
    R = np.column_stack([xh, yh, zh])
    return FLF(p0, R)


def rot_z(rad: float) -> np.ndarray:
    c, s = np.cos(rad), np.sin(rad)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])
