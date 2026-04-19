"use client";

import * as THREE from "three";
import type { FeatureOverlayProps } from "@/lib/features";

export default function Overlay({ def, state, flf }: FeatureOverlayProps) {
  const v = state.values as Record<string, number | boolean>;
  const widthY = v.widthY as number;
  const depthZ = v.depthZ as number;
  const yOffset = v.yOffset as number;
  const chamfer = v.chamfer as number;

  const anchor = state.points[0];
  if (!anchor) return null;

  const channelLength = 200;
  const w = widthY;
  const d = depthZ;
  const c = chamfer;
  const isPos = anchor[2] > 0;
  const zSign = isPos ? 1 : -1;

  const profile = [
    { y: -w / 2, z: 0 },
    { y: w / 2, z: 0 },
    { y: w / 2, z: Math.max(0, d - c) * zSign },
    { y: Math.max(0, w / 2 - c), z: d * zSign },
    { y: -Math.max(0, w / 2 - c), z: d * zSign },
    { y: -w / 2, z: Math.max(0, d - c) * zSign },
  ];

  const vertices: number[] = [];
  profile.forEach((p) => {
    let py = p.y;
    let pz = p.z;
    if (c > 0 && pz !== 0) {
      const ySign = Math.sign(py);
      py = Math.abs(py) > c ? (Math.abs(py) - c) * ySign : 0;
      pz = Math.abs(pz) > c ? (Math.abs(pz) - c) * zSign : 0;
    }
    vertices.push(0, py, pz);
  });
  vertices.push(...profile.flatMap((p) => [c, p.y, p.z]));
  vertices.push(...profile.flatMap((p) => [channelLength, p.y, p.z]));

  const indices = [
    0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 5, 4,
    0, 6, 7, 0, 7, 1, 1, 7, 8, 1, 8, 2, 2, 8, 9, 2, 9, 3,
    3, 9, 10, 3, 10, 4, 4, 10, 11, 4, 11, 5, 5, 11, 6, 5, 6, 0,
    6, 12, 13, 6, 13, 7, 7, 13, 14, 7, 14, 8, 8, 14, 15, 8, 15, 9,
    9, 15, 16, 9, 16, 10, 10, 16, 17, 10, 17, 11, 11, 17, 12, 11, 12, 6,
    12, 13, 14, 12, 14, 15, 12, 15, 16, 12, 16, 17,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return (
    <group position={[flf.origin[0], flf.origin[1] + yOffset, flf.origin[2]]}>
      <mesh geometry={geometry}>
        <meshBasicMaterial color={def.color} transparent opacity={0.3} wireframe />
      </mesh>
    </group>
  );
}
