"""Feature-Local Frame (FLF) — shared geometric convention with the frontend.

Mirrors web/lib/featuresFrame.ts. Keep the conventions in lockstep.

HAS (Holster-Aligned System):
    World +X = muzzle, World -X = entrance, World +Y = up.

For a single-point feature, the default FLF rotation is rotY(180):
    local +X -> world -X (toward entrance)
    local +Y -> world +Y (up, unchanged)
    local +Z -> world -Z

For a multi-point feature, local +X points from points[0] toward points[1]
in full 3D. World +Y is projected to be orthogonal so local +Y stays "upright."
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

import numpy as np

Vec3 = Tuple[float, float, float]

IDENTITY = np.eye(3)

# HAS default — identity rotated 180 degrees around world +Y. Columns are
# basis vectors expressed in world coords: R @ local = world.
HAS_DEFAULT_R = np.array([
    [-1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, -1.0],
])


class FLF:
    __slots__ = ("origin", "R")

    def __init__(self, origin: Sequence[float], R: Optional[np.ndarray] = None) -> None:
        self.origin = np.asarray(origin, dtype=float)
        self.R = HAS_DEFAULT_R if R is None else np.asarray(R, dtype=float)

    def to_world(self, local: Sequence[float]) -> np.ndarray:
        return self.origin + self.R @ np.asarray(local, dtype=float)

    def to_world_many(self, locals_: np.ndarray) -> np.ndarray:
        return self.origin + locals_ @ self.R.T

    def to_local(self, world: Sequence[float]) -> np.ndarray:
        return self.R.T @ (np.asarray(world, dtype=float) - self.origin)


def flf_from_points(points: List[Optional[Sequence[float]]]) -> Optional[FLF]:
    if not points or points[0] is None:
        return None
    p0 = np.asarray(points[0], dtype=float)
    if len(points) < 2 or points[1] is None:
        return FLF(p0, HAS_DEFAULT_R)

    p1 = np.asarray(points[1], dtype=float)
    edge = p1 - p0
    length = float(np.linalg.norm(edge))
    if length < 1e-6:
        return FLF(p0, HAS_DEFAULT_R)

    xh = edge / length
    up = np.array([0.0, 1.0, 0.0])
    yh = up - xh * float(np.dot(xh, up))
    yn = float(np.linalg.norm(yh))
    if yn < 1e-6:
        # xh is parallel to world up — use world +Z as fallback "up".
        yh = np.array([0.0, 0.0, 1.0])
    else:
        yh = yh / yn
    zh = np.cross(xh, yh)
    R = np.column_stack([xh, yh, zh])
    return FLF(p0, R)


def rot_z(rad: float) -> np.ndarray:
    c, s = np.cos(rad), np.sin(rad)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])
