"use client";

import React from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function GenericCutOverlay({ def, state, flf }: FeatureOverlayProps) {
  const w = Number(state.values.width ?? 100);
  const h = Number(state.values.height ?? 100);
  const d = Number(state.values.depth ?? 50);
  const rz = Number(state.values.rotateZ ?? 0);
  const ox = Number(state.values.offsetX ?? 0);
  const oy = Number(state.values.offsetY ?? 0);

  // We want to anchor the box such that the click is the "top corner".
  // Assuming "top-left" relative to the viewer:
  // X extends forward (right), Y extends downward.
  
  // Center of the box in FLF space:
  // X: move by half width + offset
  // Y: move by -half height + offset (Y is UP in Three.js)
  // Z: 0 (centered on surface)
  const pos = new THREE.Vector3(w / 2 + ox, -h / 2 + oy, 0);
  
  // Rotation matrix for local Z rotation
  const rotation = new THREE.Euler(0, 0, (rz * Math.PI) / 180);

  return (
    <group
      position={new THREE.Vector3().fromArray(flf.origin)}
      quaternion={new THREE.Quaternion().fromArray(flf.quaternion)}
    >
      <group rotation={rotation}>
        <mesh position={pos}>
          <boxGeometry args={[w, h, d]} />
          <meshBasicMaterial
            color={def.color}
            transparent
            opacity={0.3}
            wireframe
          />
        </mesh>
        
        {/* Origin indicator */}
        <mesh position={[ox, oy, 0]}>
          <sphereGeometry args={[1.5, 16, 16]} />
          <meshBasicMaterial color={def.color} />
        </mesh>
      </group>
    </group>
  );
}
