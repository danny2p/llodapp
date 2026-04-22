"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function SlideCirclesOverlay({ def, state, color, flf }: FeatureOverlayProps) {
  const outerDia = Number(state.values.outerDia ?? 10);
  const innerDia = Number(state.values.innerDia ?? 2);
  const spacing = Number(state.values.spacing ?? 15);
  const height = Number(state.values.height ?? 6);
  const rz = Number(state.values.rotateZ ?? 0);

  const anchor = state.points[0];
  if (!anchor) return null;

  // In HAS, local +Z maps to world -Z via HAS_DEFAULT_R, so flip zSign from
  // the anchor's world-side hint to push cylinders outward from the gun.
  const worldZSign = anchor[2] > 0 ? 1 : -1;
  const zSign = -worldZSign;

  const circlePositions = [0, spacing, 2 * spacing];

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

  return (
    <group position={flf.origin} quaternion={quaternion}>
      <group rotation={[0, 0, (rz * Math.PI) / 180]}>
        {circlePositions.map((x, idx) => (
          <group key={idx} position={[x, 0, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, (height / 2) * zSign]}>
              <cylinderGeometry args={[outerDia / 2, outerDia / 2, height, 32]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.3}
                wireframe
              />
            </mesh>

            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, ((height + 1) / 2) * zSign]}>
              <cylinderGeometry args={[innerDia / 2, innerDia / 2, height + 1, 32]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.6}
                wireframe
              />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}
