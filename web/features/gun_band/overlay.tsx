"use client";

import * as THREE from "three";
import type { FeatureOverlayProps } from "@/lib/features";

/**
 * Gun Band overlay.
 *
 * Renders the parallelogram prism wireframe. The chamfer on the short ends
 * is shown as a diagonal cut on the top-Z face at p0 and p1, matching the
 * sliding-depth approach in apply.py.
 */
export default function Overlay({ def, state, flf }: FeatureOverlayProps) {
  const v = state.values as Record<string, number>;
  const width        = v.width        ?? 20;
  const depthZ       = v.depthZ       ?? 10;
  const extendTop    = v.extendTop    ?? 0;
  const extendBottom = v.extendBottom ?? 0;
  const offsetX      = v.offsetX      ?? 0;
  const offsetY      = v.offsetY      ?? 0;
  const chamfer      = Math.min(v.chamfer ?? 1, depthZ, width / 2);

  const p0raw = state.points[0];
  const p1raw = state.points[1];
  if (!p0raw || !p1raw) return null;

  // Base anchors + offset
  const p0base = new THREE.Vector3(p0raw[0] + offsetX, p0raw[1] + offsetY, p0raw[2]);
  const p1base = new THREE.Vector3(p1raw[0] + offsetX, p1raw[1] + offsetY, p1raw[2]);

  const edgeVec = p1base.clone().sub(p0base);
  const edgeLen = edgeVec.length();
  if (edgeLen < 1e-6) return null;
  const edgeDir = edgeVec.clone().normalize();

  // Apply extensions
  const A = p0base.clone().addScaledVector(edgeDir, -extendTop);
  const B = p1base.clone().addScaledVector(edgeDir,  extendBottom);
  const totalEdgeLen = A.distanceTo(B);

  // Trailing edge: +width along X
  const xShift = new THREE.Vector3(width, 0, 0);
  const C = B.clone().add(xShift); // trailing-bottom
  const D = A.clone().add(xShift); // trailing-top

  // Z outward
  const midZ  = (p0raw[2] + p1raw[2]) / 2;
  const zSign = midZ >= (flf.origin[2] ?? 0) ? 1 : -1;
  const dzVec = new THREE.Vector3(0, 0, zSign * depthZ);

  // Full-height top corners (no chamfer)
  const A2 = A.clone().add(dzVec);
  const B2 = B.clone().add(dzVec);
  const C2 = C.clone().add(dzVec);
  const D2 = D.clone().add(dzVec);

  const segs: number[] = [];
  const addSeg = (a: THREE.Vector3, b: THREE.Vector3) =>
    segs.push(...a.toArray(), ...b.toArray());

  // ── Bottom parallelogram (on-surface) ──
  addSeg(A, B); addSeg(B, C); addSeg(C, D); addSeg(D, A);

  // ── Four vertical pillars ──
  addSeg(A, A2); addSeg(B, B2); addSeg(C, C2); addSeg(D, D2);

  // ── Top face — with chamfer cuts on the short ends ──
  // The chamfer reduces Z depth linearly over `chamfer` mm from each end.
  // We approximate this in the overlay by stepping along the top edge and
  // sampling the reduced height, then drawing the resulting ridge line.

  if (chamfer > 0 && totalEdgeLen > 0) {
    const steps = 32;
    // Build the ridge line along the leading edge (top of the band, after chamfer)
    const leadRidge: THREE.Vector3[] = [];
    const trailRidge: THREE.Vector3[] = [];

    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const distFromEnd = Math.min(t, 1 - t) * totalEdgeLen;
      const localDepth = chamfer > 0 && distFromEnd < chamfer
        ? depthZ * (distFromEnd / chamfer)
        : depthZ;

      // Leading edge point at parameter t
      const lp = A.clone().lerp(B, t);
      lp.z += zSign * localDepth;
      leadRidge.push(lp);

      // Trailing edge point at parameter t
      const tp = D.clone().lerp(C, t);
      tp.z += zSign * localDepth;
      trailRidge.push(tp);
    }

    // Draw the two ridge lines
    for (let i = 0; i < leadRidge.length - 1; i++) {
      addSeg(leadRidge[i], leadRidge[i + 1]);
      addSeg(trailRidge[i], trailRidge[i + 1]);
    }

    // Cross-connects at each step for the top face grid
    for (let i = 0; i <= steps; i++) {
      addSeg(leadRidge[i], trailRidge[i]);
    }

    // End caps connecting bottom to top ridge at p0 and p1 ends
    addSeg(A, leadRidge[0]);
    addSeg(D, trailRidge[0]);
    addSeg(B, leadRidge[steps]);
    addSeg(C, trailRidge[steps]);

  } else {
    // No chamfer — simple flat top
    addSeg(A2, B2); addSeg(B2, C2); addSeg(C2, D2); addSeg(D2, A2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(segs), 3));

  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={def.color} transparent opacity={0.75} />
    </lineSegments>
  );
}
