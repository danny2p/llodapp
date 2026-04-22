"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { FeatureOverlayProps } from "@/lib/features";

export default function Overlay({ def, state, color, flf, globalParams, muzzleX }: FeatureOverlayProps) {
  const v = state.values as Record<string, number | boolean>;
  const frontOffset = v.frontOffset as number;
  const length = v.length as number;
  const widthY = v.widthY as number;
  const depthZ = v.depthZ as number;
  const yOffset = v.yOffset as number;
  const rotateZDeg = v.rotateZDeg as number;
  const cornerRadius = v.cornerRadius as number;
  const oneSide = v.oneSide as boolean;

  const l = length;
  const w = widthY;
  const d = depthZ;
  const r = Math.min(cornerRadius, w * 0.45, l * 0.45);

  const shape = new THREE.Shape();
  if (r <= 0) {
    shape.moveTo(0, -w / 2);
    shape.lineTo(0, w / 2);
    shape.lineTo(l, 0);
    shape.closePath();
  } else {
    const alpha = Math.atan2(w / 2, l);
    const cosA = Math.cos(alpha);
    const sinA = Math.sin(alpha);
    const dc = r / sinA;

    shape.moveTo(0, -w / 2 + r);
    shape.lineTo(0, w / 2 - r);
    shape.absarc(r, w / 2 - r, r, Math.PI, Math.PI / 2 + alpha, true);
    shape.lineTo(l - dc * cosA + r * sinA, r * cosA);
    shape.absarc(l - dc * cosA, 0, r, alpha, -alpha, true);
    shape.lineTo(r * sinA, -w / 2 + r * (1 - cosA));
    shape.absarc(r, -w / 2 + r, r, -Math.PI / 2 - alpha, -Math.PI, true);
  }

  const points = shape.getPoints(24);
  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];
  points.forEach((p) => {
    const f = Math.max(0, 1 - p.x / l);
    vertices.push(p.x, p.y, d * f);
    vertices.push(p.x, p.y, -d * f);
    vertices.push(p.x, p.y, 0);
  });
  const n = points.length;
  for (let i = 0; i < n - 1; i++) {
    indices.push(i * 3, (i + 1) * 3, i * 3 + 2);
    indices.push((i + 1) * 3, (i + 1) * 3 + 2, i * 3 + 2);
    if (!oneSide) {
      indices.push(i * 3 + 1, (i + 1) * 3 + 1, i * 3 + 2);
      indices.push((i + 1) * 3 + 1, (i + 1) * 3 + 2, i * 3 + 2);
    }
  }
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(vertices), 3)
  );
  geometry.setIndex(indices);

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
      <group
        position={[frontOffset, yOffset, 0]}
        rotation={[0, 0, (rotateZDeg * Math.PI) / 180]}
      >
        <mesh geometry={geometry}>
          <meshBasicMaterial color={color} transparent opacity={0.3} wireframe />
        </mesh>
      </group>
    </group>
  );
}
