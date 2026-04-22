"use client";

import * as THREE from "three";
import type { FeatureOverlayProps } from "@/lib/features";

/**
 * Gun Band overlay.
 *
 * chamfer      — length along edge the ramp runs.
 * chamferDepth — how far back in Z the front face drops at the tip.
 *   0        = no drop, square end cap.
 *   = depthZ = full diagonal from proud face to midplane.
 */
export default function Overlay({ def, state, color, flf, globalParams, muzzleX }: FeatureOverlayProps) {
  const v = state.values as Record<string, number>;
  const width        = v.width        ?? 20;
  const depthZ       = v.depthZ       ?? 10;
  const extendTop    = v.extendTop    ?? 12;
  const extendBottom = v.extendBottom ?? 0;
  const offsetX      = v.offsetX      ?? 0;
  const offsetY      = v.offsetY      ?? 0;
  const chamfer      = v.chamfer      ?? 1;
  const chamferDepth = v.chamferDepth ?? 10;

  const p0raw = state.points[0];
  const p1raw = state.points[1];
  if (!p0raw || !p1raw) return null;

  const p0base = new THREE.Vector3(p0raw[0] + offsetX, p0raw[1] + offsetY, p0raw[2]);
  const p1base = new THREE.Vector3(p1raw[0] + offsetX, p1raw[1] + offsetY, p1raw[2]);

  const edgeVec = p1base.clone().sub(p0base);
  const edgeLen = edgeVec.length();
  if (edgeLen < 1e-6) return null;
  const edgeDir = edgeVec.clone().normalize();

  const A = p0base.clone().addScaledVector(edgeDir, -extendTop);
  const B = p1base.clone().addScaledVector(edgeDir,  extendBottom);
  const totalEdgeLen = A.distanceTo(B);

  const midZ  = (p0raw[2] + p1raw[2]) / 2;
  const zSign = midZ >= 0 ? 1 : -1;
  const zBack = 0;

  // Flat front face plane
  const zMean       = (p0raw[2] + p1raw[2]) / 2;
  const zFrontPlane = zMean + zSign * depthZ;

  // Z at the very tip of the chamfer: drop back by chamferDepth
  const zTipPlane = zFrontPlane - zSign * chamferDepth;

  const steps = 48;

  type StripPt = {
    leadBack: THREE.Vector3; leadFront: THREE.Vector3;
    trailBack: THREE.Vector3; trailFront: THREE.Vector3;
  };
  const strip: StripPt[] = [];

  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const distFromEnd = Math.min(t, 1 - t) * totalEdgeLen;
    const surfPt = A.clone().lerp(B, t);

    let zFrontLocal: number;
    if (chamfer > 0 && distFromEnd < chamfer) {
      const tc = distFromEnd / chamfer; // 0 at tip → 1 at full
      zFrontLocal = zTipPlane + tc * (zFrontPlane - zTipPlane);
    } else {
      zFrontLocal = zFrontPlane;
    }

    const mk = (x: number, z: number) =>
      new THREE.Vector3(surfPt.x + x, surfPt.y, z);

    strip.push({
      leadBack:   mk(0,      zBack),
      leadFront:  mk(0,      zFrontLocal),
      trailBack:  mk(-width, zBack),
      trailFront: mk(-width, zFrontLocal),
    });
  }

  const segs: number[] = [];
  const addSeg = (a: THREE.Vector3, b: THREE.Vector3) =>
    segs.push(...a.toArray(), ...b.toArray());

  for (let i = 0; i < steps; i++) {
    const cur = strip[i], nxt = strip[i + 1];
    addSeg(cur.leadBack,   nxt.leadBack);
    addSeg(cur.leadFront,  nxt.leadFront);
    addSeg(cur.trailBack,  nxt.trailBack);
    addSeg(cur.trailFront, nxt.trailFront);
  }

  for (let i = 0; i <= steps; i++) {
    const { leadBack, leadFront, trailBack, trailFront } = strip[i];
    addSeg(leadBack,  leadFront);
    addSeg(trailBack, trailFront);
    addSeg(leadBack,  trailBack);
    addSeg(leadFront, trailFront);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs), 3));

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={color} transparent opacity={0.75} />
    </lineSegments>
  );
}
