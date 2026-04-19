"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function SlideCirclesOverlay({ def, state, flf }: FeatureOverlayProps) {
  const outerDia = Number(state.values.outerDia ?? 10);
  const innerDia = Number(state.values.innerDia ?? 2);
  const spacing = Number(state.values.spacing ?? 15);
  const height = Number(state.values.height ?? 6);
  const rz = Number(state.values.rotateZ ?? 0);

  const anchor = state.points[0];
  if (!anchor) return null;

  const isPos = anchor[2] > 0;
  const zSign = isPos ? 1 : -1;

  // We'll create 3 pairs of nested cylinders
  const circlePositions = [0, spacing, 2 * spacing];

  return (
    <group
      position={flf.origin}
      rotation={[0, 0, (rz * Math.PI) / 180]}
    >
      {circlePositions.map((x, idx) => (
        <group key={idx} position={[x, 0, 0]}>
          {/* Outer Boss Cylinder */}
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, (height / 2) * zSign]}>
            <cylinderGeometry args={[outerDia / 2, outerDia / 2, height, 32]} />
            <meshBasicMaterial
              color={def.color}
              transparent
              opacity={0.3}
              wireframe
            />
          </mesh>
          
          {/* Inner Protruding Pin (1mm taller) */}
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, ((height + 1) / 2) * zSign]}>
            <cylinderGeometry args={[innerDia / 2, innerDia / 2, height + 1, 32]} />
            <meshBasicMaterial
              color={def.color}
              transparent
              opacity={0.6}
              wireframe
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}
