"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function SightChannelOverlay({ def, state, flf }: FeatureOverlayProps) {
  const h = Number(state.values.height ?? 10);
  const w = Number(state.values.width ?? 4);
  const channelLength = Number(state.values.length ?? 160);
  const ox = Number(state.values.offsetX ?? -19);
  const oy = Number(state.values.offsetY ?? 0);
  const rz = Number(state.values.rotateZ ?? 0);

  // flf.origin.y is the gun's top Y (auto-anchored). Anchor the channel's
  // BOTTOM edge at origin.y + oy so height grows upward from the slide top.
  const localY = h / 2 + oy;

  // FLF origin is the muzzle (HAS +X end). Local +X points toward the
  // entrance, so the channel extends in local +X. offsetX keeps the legacy
  // world-space sign (negative = shift toward entrance), converted to local.
  const geometry = useMemo(() => new THREE.BoxGeometry(channelLength, h, w), [
    channelLength,
    h,
    w,
  ]);

  const quaternion = useMemo(() => {
    const m = new THREE.Matrix4();
    m.set(
      flf.R[0][0], flf.R[0][1], flf.R[0][2], 0,
      flf.R[1][0], flf.R[1][1], flf.R[1][2], 0,
      flf.R[2][0], flf.R[2][1], flf.R[2][2], 0,
      0, 0, 0, 1,
    );
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [flf.R]);

  const localX = channelLength / 2 - ox;

  return (
    <group position={flf.origin} quaternion={quaternion}>
      <group rotation={[0, 0, (rz * Math.PI) / 180]}>
        <mesh geometry={geometry} position={[localX, localY, 0]}>
          <meshBasicMaterial
            color={def.color}
            transparent
            opacity={0.3}
            wireframe
          />
        </mesh>
      </group>
    </group>
  );
}
