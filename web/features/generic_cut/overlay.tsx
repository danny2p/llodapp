"use client";

import React, { useMemo } from "react";
import * as THREE from "three";
import { type FeatureOverlayProps } from "@/lib/features";

export default function GenericCutOverlay({ def, state, color, flf, globalParams, muzzleX }: FeatureOverlayProps) {
  const w = Number(state.values.width ?? 7);
  const h = Number(state.values.height ?? 7);
  const d = Number(state.values.depth ?? 5);
  const rz = Number(state.values.rotateZ ?? 0);
  const c = Number(state.values.chamfer ?? 1);
  const ox = Number(state.values.offsetX ?? 0);
  const oy = Number(state.values.offsetY ?? 0);

  // Box center calculation:
  // Handle (0,0) is towards the muzzle. 
  // Box is towards the rear (local +X).
  // Handle is 10mm to the right (muzzle-ward) of the box's top-front corner.
  // In local space, muzzle is -X. So handle is at local -X relative to the box.
  // Or Box is at local +X relative to handle.
  const baseX = 10 + w / 2;
  const baseY = -h / 2;
  const boxPos = new THREE.Vector3(baseX + ox, baseY + oy, 0);
  
  const localRotation = new THREE.Euler(0, 0, (rz * Math.PI) / 180);

  const matrix = new THREE.Matrix4();
  matrix.set(
    flf.R[0][0], flf.R[0][1], flf.R[0][2], 0,
    flf.R[1][0], flf.R[1][1], flf.R[1][2], 0,
    flf.R[2][0], flf.R[2][1], flf.R[2][2], 0,
    0, 0, 0, 1
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);

  // Construct a wireframe that shows the interior chamfers at front/rear X walls
  const geo = useMemo(() => {
    const halfW = w / 2;
    const halfH = h / 2;
    const halfD = d / 2;
    
    const verts: number[] = [];
    const addSeg = (a: [number, number, number], b: [number, number, number]) => {
      verts.push(...a, ...b);
    };

    // Top Ring (proud/surface)
    const t0 = [-halfW,  halfH, halfD] as [number, number, number];
    const t1 = [ halfW,  halfH, halfD] as [number, number, number];
    const t2 = [ halfW, -halfH, halfD] as [number, number, number];
    const t3 = [-halfW, -halfH, halfD] as [number, number, number];
    
    addSeg(t0, t1); addSeg(t1, t2); addSeg(t2, t3); addSeg(t3, t0);

    // Bottom Ring (deep/interior) with chamfers at X ends
    const b0 = [-halfW,      halfH, -halfD + c] as [number, number, number];
    const b0i = [-halfW + c,  halfH, -halfD]     as [number, number, number];
    const b1i = [ halfW - c,  halfH, -halfD]     as [number, number, number];
    const b1 = [ halfW,      halfH, -halfD + c] as [number, number, number];

    const b2 = [ halfW,     -halfH, -halfD + c] as [number, number, number];
    const b2i = [ halfW - c, -halfH, -halfD]     as [number, number, number];
    const b3i = [-halfW + c, -halfH, -halfD]     as [number, number, number];
    const b3 = [-halfW,     -halfH, -halfD + c] as [number, number, number];

    // Bottom floor outline
    addSeg(b0, b0i); addSeg(b0i, b1i); addSeg(b1i, b1);
    addSeg(b1, b2);
    addSeg(b2, b2i); addSeg(b2i, b3i); addSeg(b3i, b3);
    addSeg(b3, b0);

    // Vertical segments
    addSeg(t0, b0); addSeg(t1, b1); addSeg(t2, b2); addSeg(t3, b3);

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    return buffer;
  }, [w, h, d, c]);

  // Visual stalk geometry: connects handle [0,0,0] to the box center
  const stalkGeo = useMemo(() => {
    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, boxPos.x, boxPos.y, 0], 3));
    return buffer;
  }, [boxPos.x, boxPos.y]);

  return (
    <group position={flf.origin} quaternion={quaternion}>
      {/* Visual stalk */}
      <lineSegments geometry={stalkGeo}>
        <lineBasicMaterial color={color} transparent opacity={0.4} />
      </lineSegments>

      <group position={[boxPos.x, boxPos.y, 0]} rotation={localRotation}>
        <lineSegments geometry={geo}>
          <lineBasicMaterial color={color} transparent opacity={0.6} />
        </lineSegments>
        
        {/* Box Center indicator */}
        <mesh>
          <sphereGeometry args={[0.3, 8, 8]} />
          <meshBasicMaterial color={color} transparent opacity={0.5} />
        </mesh>
      </group>
    </group>
  );
}
