"use client";

import React from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function SightChannelOverlay({ def, state, flf }: FeatureOverlayProps) {
  const h = Number(state.values.height ?? 10);
  const d = Number(state.values.depth ?? 6);
  const l = Number(state.values.length ?? 160);
  const rz = Number(state.values.rotateZ ?? 0);
  const bothSides = Boolean(state.values.bothSides ?? true);

  // CONVENTION:
  // FLF +X is toward Muzzle (Right in viewer).
  // FLF +Y is UP.
  // Click is "Front Bottom Edge".
  // Channel must extend from Click (X=0) toward ENTRANCE (-X).
  // Channel must extend from Click (Y=0) UPWARD (+Y).
  
  // Box center in local FLF:
  // X: move by -l/2
  // Y: move by h/2
  // Z: if bothSides, center on Z=0. If not, grow in +Z.
  const pos = new THREE.Vector3(-l / 2, h / 2, 0);
  
  // If not both sides, we might want to offset Z so it only covers one half.
  // But usually sight channels are centered.
  const zSize = bothSides ? d * 2 : d;
  if (!bothSides) {
      pos.z = d / 2;
  }

  const localRotation = new THREE.Euler(0, 0, (rz * Math.PI) / 180);

  const matrix = new THREE.Matrix4();
  matrix.set(
    flf.R[0][0], flf.R[0][1], flf.R[0][2], 0,
    flf.R[1][0], flf.R[1][1], flf.R[1][2], 0,
    flf.R[2][0], flf.R[2][1], flf.R[2][2], 0,
    0, 0, 0, 1
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

  return (
    <group position={flf.origin} quaternion={quaternion}>
      <group rotation={localRotation}>
        <mesh position={pos}>
          <boxGeometry args={[l, h, zSize]} />
          <meshBasicMaterial
            color={def.color}
            transparent
            opacity={0.3}
            wireframe
          />
        </mesh>
        
        {/* Origin indicator (Front Bottom Edge) */}
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color={def.color} />
        </mesh>
      </group>
    </group>
  );
}
