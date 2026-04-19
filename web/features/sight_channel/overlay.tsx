"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function SightChannelOverlay({ def, state, globalParams, flf }: FeatureOverlayProps) {
  const h = Number(state.values.height ?? 10);
  const w = Number(state.values.width ?? 4);
  const ox = Number(state.values.offsetX ?? -19);
  const oy = Number(state.values.offsetY ?? 50);
  const rz = Number(state.values.rotateZ ?? 0);
  const totalLength = Number(globalParams?.totalLength ?? 160);

  // CONVENTION (Viewer Space):
  // X axis: Muzzle is +X, Grip is -X.
  // Y axis: UP is +Y.
  
  // The Sight Channel should span the whole length and be centered.
  const geometry = useMemo(() => {
    return new THREE.BoxGeometry(totalLength, h, w);
  }, [totalLength, h, w]);

  // VERTICAL POSITIONING:
  // Use manual offsets directly.
  const position = new THREE.Vector3(ox, oy, 0);

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
