"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function NubOverlay({ state, color, flf }: FeatureOverlayProps) {
  const dia = Number(state.values.diameter ?? 5);
  const height = Number(state.values.height ?? 3);

  const geometry = useMemo(() => {
    // Basic cylinder centered on the point
    // flf.origin is the center of the base.
    const geo = new THREE.CylinderGeometry(dia / 2, dia / 2, height, 32);
    geo.rotateX(Math.PI / 2); // Align with Z axis
    
    // Extrude outward from surface
    // If we are on +Z side, we need to extrude towards more +Z (away from 0).
    // If we are on -Z side, we need to extrude towards more -Z (away from 0).
    // In local space of HAS_DEFAULT_R, the Z axis is already inverted relative to world.
    const zSign = flf.origin[2] >= 0 ? -1 : 1;
    geo.translate(0, 0, (height / 2) * zSign); 
    
    return geo;
  }, [dia, height, flf.origin]);

  const matrix = new THREE.Matrix4();
  matrix.set(
    flf.R[0][0], flf.R[0][1], flf.R[0][2], 0,
    flf.R[1][0], flf.R[1][1], flf.R[1][2], 0,
    flf.R[2][0], flf.R[2][1], flf.R[2][2], 0,
    0, 0, 0, 1
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

  return (
    <mesh position={flf.origin} quaternion={quaternion} geometry={geometry}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.6}
        wireframe
      />
    </mesh>
  );
}
