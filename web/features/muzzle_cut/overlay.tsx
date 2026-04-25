"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function MuzzleCutOverlay({ state, color, muzzleX, gunBounds, globalParams }: FeatureOverlayProps) {
  const extension = Number(state.values.extension ?? 30);
  
  // Point 0 is the cut location
  const p0 = state.points[0];
  const cutX = p0 ? p0[0] : muzzleX - 5;
  const centerY = gunBounds ? gunBounds.center.y : 0;

  const boxGeo = useMemo(() => {
    // Visualize the 30mm extrusion area
    const h = gunBounds ? gunBounds.size.y * 1.5 : 100;
    const d = gunBounds ? gunBounds.size.z * 2.5 : 60;
    const geo = new THREE.BoxGeometry(extension, h, d);
    // Position: starts at cutX, extends muzzleX-ward (+X)
    return { geo, posX: cutX + extension / 2, h, d };
  }, [extension, cutX, gunBounds]);

  return (
    <group>
      {/* The "Extension" volume (Translucent Solid) */}
      <mesh position={[boxGeo.posX, centerY, 0]} geometry={boxGeo.geo}>
        <meshBasicMaterial color="#4ADE80" transparent opacity={0.05} depthWrite={false} />
      </mesh>
      <mesh position={[boxGeo.posX, centerY, 0]} geometry={boxGeo.geo}>
        <meshBasicMaterial color="#4ADE80" transparent opacity={0.15} wireframe />
      </mesh>
    </group>
  );
}
