"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function TriggerPlatenOverlay({ 
  state, 
  color, 
  globalParams, 
  muzzleX, 
  gunBounds,
  activeTag,
  onTagPoint,
}: FeatureOverlayProps & {
  activeTag?: { featureId: string; instanceIndex: number; pointIndex: number } | null;
  onTagPoint?: (featureId: string, instanceIndex: number, pointIndex: number, coords: [number, number, number]) => void;
}) {
  const thickness = Number(state.values.thickness ?? 4);

  // Check for muzzle extension
  const mcState = globalParams.featureStates?.["muzzle_cut"]?.[0];
  const mcExt = (mcState?.enabled && mcState?.values?.extension) ? Number(mcState.values.extension) : 0;

  const geometry = useMemo(() => {
    if (!gunBounds) return null;

    const { size, center } = gunBounds;
    const bboxMinY = center.y - size.y / 2;
    const bboxMaxY = center.y + size.y / 2;

    // Dimensions:
    // X length: (totalLength - 30mm) + mcExt
    const w = Math.max(1, (globalParams.totalLength - 30) + mcExt);

    // Y height: bottom of BB up to (top of BB - 15mm)
    const h = Math.max(1, (bboxMaxY - 15) - bboxMinY);
    const d = thickness;

    const geo = new THREE.BoxGeometry(w, h, d);

    // Position calculation:
    // Muzzle is at muzzleX. Box extends back from muzzleX.
    // Center is muzzleX - w/2
    const posX = muzzleX - w / 2;

    // Y: Starts at bboxMinY, height is h.
    const posY = bboxMinY + h / 2;
    // Z: Back side aligns with midpoint (Z=0).
    // Box grows away from midplane. Since THREE.BoxGeometry is centered, 
    // we shift it by half thickness.
    // In HAS, +Z is towards the shooter/right side.
    const posZ = d / 2;

    return { geo, pos: [posX, posY, posZ] as [number, number, number] };
  }, [gunBounds, globalParams.totalLength, thickness, muzzleX]);

  if (!geometry) return null;

  return (
    <mesh 
      position={geometry.pos} 
      geometry={geometry.geo}
      onPointerDown={(e) => {
        if (activeTag && onTagPoint) {
          e.stopPropagation();
          const p = e.point;
          onTagPoint(activeTag.featureId, activeTag.instanceIndex, activeTag.pointIndex, [p.x, p.y, p.z]);
        }
      }}
    >
      <meshStandardMaterial
        color="#d1d5db"
        transparent
        opacity={0.8}
      />
    </mesh>
  );
}
