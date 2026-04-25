"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function MuzzleCutOverlay({ state, color, muzzleX, gunBounds, globalParams }: FeatureOverlayProps) {
  const extension = Number(state.values.extension ?? 30);
  
  // Point 0 is the cut location
  const p0 = state.points[0];
  
  // If not tagged, we don't have a specific X, but for visual feedback 
  // we could default to muzzleX - 5mm.
  const cutX = p0 ? p0[0] : muzzleX - 5;
  const centerY = gunBounds ? gunBounds.center.y : 0;

  const boxGeo = useMemo(() => {
    // Visualize the 30mm extrusion area
    // Width (X): extension
    // Height/Depth: enough to cover muzzle
    const h = gunBounds ? gunBounds.size.y * 1.5 : 100;
    const d = gunBounds ? gunBounds.size.z * 2.5 : 60;
    const geo = new THREE.BoxGeometry(extension, h, d);
    // Position: starts at cutX, extends muzzleX-ward (+X)
    return { geo, posX: cutX + extension / 2, h, d };
  }, [extension, cutX, gunBounds]);

  return (
    <group>
      {/* The "Cut Plane" (Green) */}
      <group position={[cutX, centerY, 0]}>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[100, 100]} />
          <meshBasicMaterial color="#4ADE80" transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
        
        {/* Label */}
        <mesh rotation={[0, Math.PI / 2, 0]} position={[0, 55, 0]}>
          <planeGeometry args={[25, 6]} />
          <meshBasicMaterial color="#4ADE80" />
        </mesh>
        {/* We can't use Html here easily because it's already in Scene.tsx for Bbox, 
            but for now let's just use the colored plane as a marker. */}
      </group>

      {/* The "Extension" volume (Translucent Solid) */}
      <mesh position={[boxGeo.posX, centerY, 0]} geometry={boxGeo.geo}>
        <meshBasicMaterial color="#4ADE80" transparent opacity={0.1} />
      </mesh>
      <mesh position={[boxGeo.posX, centerY, 0]} geometry={boxGeo.geo}>
        <meshBasicMaterial color="#4ADE80" transparent opacity={0.3} wireframe />
      </mesh>
    </group>
  );
}
