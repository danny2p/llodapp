"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function SightChannelOverlay({ def, state, globalParams, flf }: FeatureOverlayProps) {
  const h = Number(state.values.height ?? 10);
  const w = Number(state.values.width ?? 4);
  const channelLength = Number(state.values.length ?? 160);
  const ox = Number(state.values.offsetX ?? -19);
  const oy = Number(state.values.offsetY ?? 50);
  const rz = Number(state.values.rotateZ ?? 0);

  // CONVENTION (Viewer Space):
  // X axis: Muzzle is +X, Grip is -X (or vice versa depending on step).
  // flf.origin[0] is the detected muzzle X coordinate.
  
  // The Sight Channel should be a fixed length and anchored at the front (muzzle).
  const geometry = useMemo(() => {
    return new THREE.BoxGeometry(channelLength, h, w);
  }, [channelLength, h, w]);

  const muzzleX = flf.origin[0];
  // If muzzleX is negative (Tagging view), it grows positive. 
  // If muzzleX is positive (Processing view), it grows negative.
  const dir = Math.sign(muzzleX) < 0 ? 1 : -1; 
  const position = new THREE.Vector3(muzzleX + (dir * channelLength / 2) + ox, oy, 0);

  return (
    <group position={position} rotation={[0, 0, (rz * Math.PI) / 180]}>
      <mesh geometry={geometry}>
        <meshBasicMaterial
          color={def.color}
          transparent
          opacity={0.3}
          wireframe
        />
      </mesh>
    </group>
  );
}
