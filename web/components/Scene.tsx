"use client";

import { Canvas, useFrame, useLoader, useThree, ThreeEvent } from "@react-three/fiber";
import {
  OrbitControls,
  MapControls,
  PerspectiveCamera,
  OrthographicCamera,
  useCursor,
  Html,
} from "@react-three/drei";
import { useDrag } from "@use-gesture/react";
import { Suspense, useMemo, useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import {
  FEATURES,
  getInstanceColor,
  type FeatureState,
  type FeatureStates,
  type GlobalParams,
} from "@/lib/features";
import { flfFromPoints, HAS_DEFAULT_R, type Vec3 } from "@/lib/featuresFrame";

export type Step = 1 | 1.5 | 1.75 | 2 | 3;
export type ViewMode = "unified" | "left" | "right";

export type PlacedAccessory = {
  id: string;
  name: string;
  side: "left" | "right";
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

export type TgAnchor = {
  center: [number, number, number];
  bbox_min: [number, number, number];
  bbox_max: [number, number, number];
  area_mm2: number;
};

export type SceneAssets = {
  gunUrl: string;
  fullUrl: string;
  leftUrl: string;
  rightUrl: string;
  muzzleX: number;
  scanMuzzleX: number;
  muzzleExtension: number;
};

export type ActiveTag = { featureId: string; instanceIndex: number; pointIndex: number } | null;

type SceneProps = {
  step: Step;
  viewMode: ViewMode;
  assets: SceneAssets | null;
  alignedGunUrl?: string | null;
  cavityUrl?: string | null;
  featureStates: FeatureStates;
  activeTag: ActiveTag;
  onTagPoint: (featureId: string, instanceIndex: number, pointIndex: number, coords: Vec3) => void;
  placedAccessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  onUpdateAccessory: (id: string, updates: Partial<PlacedAccessory>) => void;
  onSetActiveAccessory: (id: string | null) => void;
  globalParams: GlobalParams;
  progress: number;
  isProcessing: boolean;
};

// Feature overlays — iterate the registry and render each feature's own
// Overlay component (defined in `web/features/<id>/overlay.tsx`).
// Marker-only features omit Overlay and render nothing here.

function FeatureOverlays({
  featureStates,
  globalParams,
  muzzleX = 0,
  gunTopY = 0,
  gunBounds,
  activeTag,
  onTagPoint,
}: {
  featureStates: FeatureStates;
  globalParams: GlobalParams;
  muzzleX?: number;
  gunTopY?: number;
  gunBounds: { size: THREE.Vector3; center: THREE.Vector3; slideTopY: number } | null;
  activeTag: ActiveTag;
  onTagPoint: (featureId: string, instanceIndex: number, pointIndex: number, coords: Vec3) => void;
}) {
  return (
    <group>
      {FEATURES.filter((def) => def.published).map((def) => {
        const Overlay = def.Overlay;
        if (!Overlay) return null;
        const instances = featureStates[def.id] || [];
        
        return instances.map((state, idx) => {
          if (!state.enabled) return null;

          // For automatic features (0 points), anchor at the provided muzzle position.
          // For tagged features, derive frame from points.
          let flf = flfFromPoints(state.points);
          if (!flf && def.points.length === 0) {
            // Additive features like sight_channel auto-anchor to the gun's top Y
            // so their top edge lands on the slide. Non-additive automatic features
            // stay at Y=0 and can offset as needed.
            const anchorY = def.intent === "additive" ? gunTopY : 0;
            flf = {
              origin: [muzzleX, anchorY, 0],
              R: HAS_DEFAULT_R,
            };
          }

          if (!flf) return null;
          const color = getInstanceColor(def.color, idx);
          const paramsWithStates = { ...globalParams, featureStates };
          
          return (
            <Overlay
              key={`${def.id}-${idx}`}
              def={def}
              state={state}
              color={color}
              flf={flf}
              globalParams={paramsWithStates}
              muzzleX={muzzleX}
              gunBounds={gunBounds}
              activeTag={activeTag}
              onTagPoint={onTagPoint}
            />
          );
        });
      })}
    </group>
  );
}

type PlugData = {
  full: THREE.BufferGeometry;
  left: THREE.BufferGeometry;
  right: THREE.BufferGeometry;
  gun: THREE.BufferGeometry;
  size: THREE.Vector3;
  center: THREE.Vector3;
  gunLeadingX: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

function PickingGun({
  url,
  activeTag,
  onTagPoint,
  gunColor,
  meshRef,
  onLoad,
  scanMuzzleX,
  isProcessing,
  visible,
}: {
  url: string;
  activeTag: ActiveTag;
  onTagPoint: (featureId: string, instanceIndex: number, pointIndex: number, coords: Vec3) => void;
  gunColor: string;
  meshRef: React.RefObject<THREE.Mesh | null>;
  onLoad?: (size: THREE.Vector3, center: THREE.Vector3, slideTopY: number) => void;
  scanMuzzleX?: number;
  isProcessing: boolean;
  visible: boolean;
}) {
  const geometry = useLoader(STLLoader, url);
  const meshData = useMemo(() => {
    const g = geometry.clone();
    g.computeVertexNormals();
    g.computeBoundingBox();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    g.boundingBox!.getSize(size);
    g.boundingBox!.getCenter(center);

    // Robust slide top detection: bin all vertex Y values and pick the
    // highest bin that still contains a meaningful chunk of the mesh.
    // Iron sights rise above the slide but contain only a tiny vertex share,
    // so a simple count threshold excludes them.
    const pos = g.attributes.position as THREE.BufferAttribute;
    const count = pos.count;
    const bin = 1.0; // 1mm bins
    const bins = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const y = pos.getY(i);
      const b = Math.floor(y / bin);
      bins.set(b, (bins.get(b) ?? 0) + 1);
    }
    const threshold = count * 0.01; // 1% of vertices must share this band
    let slideTopBin = -Infinity;
    for (const [b, c] of bins) {
      if (c >= threshold && b > slideTopBin) slideTopBin = b;
    }
    const slideTopY = Number.isFinite(slideTopBin)
      ? (slideTopBin + 1) * bin
      : center.y + size.y / 2;

    return { geometry: g, size, center, slideTopY };
  }, [geometry]);

  useEffect(() => {
    if (onLoad) onLoad(meshData.size, meshData.center, meshData.slideTopY);
  }, [meshData, onLoad]);

  return (
    <group visible={visible}>
      <mesh
        ref={meshRef}
        geometry={meshData.geometry}
        onPointerDown={(e) => {
          if (activeTag) {
            e.stopPropagation();
            const p = e.point;
            onTagPoint(activeTag.featureId, activeTag.instanceIndex, activeTag.pointIndex, [p.x, p.y, p.z]);
          }
        }}
      >
        <meshStandardMaterial 
          color={gunColor} 
          roughness={0.4} 
          transparent 
          opacity={isProcessing ? 1.0 : 0.5} 
        />
      </mesh>
      <mesh geometry={meshData.geometry}>
        <meshBasicMaterial color="#ffffff" wireframe transparent opacity={isProcessing ? 0.05 : 0.1} />
      </mesh>
    </group>
  );
}

function GhostGun({ url, color }: { url: string; color: string }) {
  const geometry = useLoader(STLLoader, url);
  const g = useMemo(() => {
    const cloned = geometry.clone();
    cloned.computeVertexNormals();
    return cloned;
  }, [geometry]);
  return (
    <mesh geometry={g}>
      <meshStandardMaterial color={color} transparent opacity={0.18} depthWrite={false} />
    </mesh>
  );
}

function MoldAssets({
  assets,
  step,
  viewMode,
  placedAccessories,
  activeAccessoryId,
  onUpdateAccessory,
  onSetActiveAccessory,
  globalParams,
  featureStates,
  muzzleX,
  gunTopY,
  gunBounds,
  activeTag,
  onTagPoint,
  progress,
}: {
  assets: SceneAssets;
  step: Step;
  viewMode: ViewMode;
  placedAccessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  onUpdateAccessory: (id: string, updates: Partial<PlacedAccessory>) => void;
  onSetActiveAccessory: (id: string | null) => void;
  globalParams: GlobalParams;
  featureStates: FeatureStates;
  muzzleX: number;
  gunTopY: number;
  gunBounds: { size: THREE.Vector3; center: THREE.Vector3; slideTopY: number } | null;
  activeTag: ActiveTag;
  onTagPoint: (featureId: string, instanceIndex: number, pointIndex: number, coords: Vec3) => void;
  progress: number;
}) {
  const [full, left, right, gun] = useLoader(STLLoader, [
    assets.fullUrl,
    assets.leftUrl,
    assets.rightUrl,
    assets.gunUrl,
  ]);

  const plug = useMemo((): PlugData => {
    // HAS: backend delivers gun centered at origin with muzzle at +X; no reshaping needed.
    const fullPrepared = full.clone();
    fullPrepared.computeVertexNormals();

    const leftPrepared = left.clone();
    leftPrepared.computeVertexNormals();

    const rightPrepared = right.clone();
    rightPrepared.computeVertexNormals();

    const gunPrepared = gun.clone();
    gunPrepared.computeVertexNormals();
    gunPrepared.computeBoundingBox();
    const gunLeadingX = gunPrepared.boundingBox!.max.x;

    fullPrepared.computeBoundingBox();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    fullPrepared.boundingBox!.getSize(size);
    fullPrepared.boundingBox!.getCenter(center);

    return {
      full: fullPrepared,
      left: leftPrepared,
      right: rightPrepared,
      gun: gunPrepared,
      size,
      center,
      gunLeadingX,
    };
  }, [full, left, right, gun]);

  return (
    <>
      <ClayBlock
        visible={step === 2 || (step === 3 && progress < (2.5 + 1.0) / (2.5 + 1.0 + 1.5))}
        sizeHint={plug.size}
        totalLength={plug.size.x}
        centerX={plug.center.x}
      />
      {step >= 2 && (
        <Plug
          step={step}
          viewMode={viewMode}
          plug={plug}
          accessories={placedAccessories}
          activeAccessoryId={activeAccessoryId}
          onUpdateAccessory={onUpdateAccessory}
          onSelectAccessory={onSetActiveAccessory}
          globalParams={globalParams}
          scanMuzzleX={assets?.scanMuzzleX ?? 0}
          featureStates={featureStates}
          muzzleX={muzzleX}
          gunTopY={gunTopY}
          gunBounds={gunBounds}
          activeTag={activeTag}
          onTagPoint={onTagPoint}
        />
      )}
    </>
  );
}

function Accessory({
  data,
  isActive,
  onSelect,
}: {
  data: PlacedAccessory;
  isActive: boolean;
  onSelect: () => void;
}) {
  const stl = useLoader(STLLoader, `${API_BASE}/accessories/${data.name}`);
  const [hovered, setHovered] = useState(false);
  useCursor(hovered);

  const geometry = useMemo(() => {
    const g = stl.clone();
    g.center();
    g.computeVertexNormals();
    return g;
  }, [stl]);

  return (
    <mesh
      geometry={geometry}
      position={data.position}
      rotation={[
        ((data.rotation[0] + 90) * Math.PI) / 180,
        (data.rotation[1] * Math.PI) / 180,
        (data.rotation[2] * Math.PI) / 180,
      ]}
      scale={data.scale}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <meshStandardMaterial
        color={isActive ? "#5EEAD4" : hovered ? "#34D399" : "#2DD4BF"}
        metalness={0.55}
        roughness={0.25}
        emissive={isActive ? "#064e3b" : "#000000"}
        emissiveIntensity={isActive ? 0.4 : 0}
      />
    </mesh>
  );
}

function Plug({
  step,
  viewMode,
  plug,
  accessories,
  activeAccessoryId,
  onUpdateAccessory,
  onSelectAccessory,
  globalParams,
  scanMuzzleX,
  featureStates,
  muzzleX,
  gunTopY,
  gunBounds,
  activeTag,
  onTagPoint,
}: {
  step: Step;
  viewMode: ViewMode;
  plug: PlugData;
  accessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  onUpdateAccessory: (id: string, updates: Partial<PlacedAccessory>) => void;
  onSelectAccessory: (id: string | null) => void;
  globalParams: GlobalParams;
  scanMuzzleX: number;
  featureStates: FeatureStates;
  muzzleX: number;
  gunTopY: number;
  gunBounds: { size: THREE.Vector3; center: THREE.Vector3; slideTopY: number } | null;
  activeTag: ActiveTag;
  onTagPoint: (featureId: string, instanceIndex: number, pointIndex: number, coords: Vec3) => void;
}) {
  const plugMeshRef = useRef<THREE.Mesh>(null);
  const containerRef = useRef<THREE.Group>(null);
  const gunRef = useRef<THREE.Group>(null);
  const leftGroupRef = useRef<THREE.Group>(null);
  const rightGroupRef = useRef<THREE.Group>(null);
  const progressRef = useRef(0);
  const lastStepRef = useRef<Step | null>(null);
  const lastViewModeRef = useRef<ViewMode | null>(null);

  const plugClipPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6),
    []
  );
  const plugMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: globalParams.moldColor,
        metalness: 0.45,
        roughness: 0.35,
        clippingPlanes: [plugClipPlane],
        emissive: globalParams.moldColor,
        emissiveIntensity: 0,
        transparent: true,
        opacity: 0.65,
      }),
    [plugClipPlane, globalParams.moldColor]
  );
  const scanPlaneRef = useRef<THREE.Mesh>(null);
  const phaseRef = useRef(0);
  const gunMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: globalParams.gunColor,
        metalness: 0.55,
        roughness: 0.35,
        transparent: true,
        opacity: 1.0,
      }),
    [globalParams.gunColor]
  );
  const halfMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: globalParams.moldColor,
        metalness: 0.2,
        roughness: 0.35,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        sheen: 0.5,
        sheenColor: new THREE.Color("#5EEAD4"),
        sheenRoughness: 0.3,
        side: THREE.DoubleSide,
        flatShading: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        transparent: true,
        opacity: 0.65,
      }),
    [globalParams.moldColor]
  );

  useFrame(({ clock }, delta) => {
    const modeChanged = lastViewModeRef.current !== viewMode;
    const stepChanged = lastStepRef.current !== step;

    if (stepChanged) {
      progressRef.current = 0;
      lastStepRef.current = step;
    }
    
    if (modeChanged) {
      lastViewModeRef.current = viewMode;
    }

    // Step 2 is the "processing" simulation.
    // Step 3 is the final results view.
    const isResults = step === 3;
    
    // Durations in seconds
    const insertDuration = 2.5;
    const pauseDuration = 1.0;
    const splitDuration = 1.5;
    
    // Total duration for Step 3
    const totalStep3Duration = insertDuration + pauseDuration + splitDuration;
    const duration = isResults ? totalStep3Duration : 3.0;

    progressRef.current = Math.min(1, progressRef.current + delta / duration);
    const tGlobal = progressRef.current; // Global 0..1 progress for this step

    // Calculate sub-progresses for Step 3 phases
    let tInsert = 1;
    let tSplit = 0;
    
    if (isResults) {
      const currentTime = tGlobal * totalStep3Duration;
      
      // Phase 1: Insertion
      tInsert = easeOutCubic(Math.min(1, currentTime / insertDuration));
      
      // Phase 2: Pause (no-op, tSplit remains 0)
      
      // Phase 3: Split
      if (currentTime > insertDuration + pauseDuration) {
        const splitStartTime = insertDuration + pauseDuration;
        tSplit = easeOutCubic(Math.min(1, (currentTime - splitStartTime) / splitDuration));
      }
    } else {
      // Step 2: Keep everything stationary at X=0 while laser scanning pulses.
      // Entry animation only plays once in Step 3.
      tInsert = 1;
    }

    if (plugMeshRef.current) {
      plugMeshRef.current.visible = step === 2;
      // Make mold opaque during processing simulation, semi-transparent in results
      (plugMeshRef.current.material as THREE.MeshStandardMaterial).opacity = step === 2 ? 1.0 : 0.65;
    }
    if (gunRef.current) gunRef.current.visible = globalParams.showGun; // Respect persistent showGun toggle
    if (scanPlaneRef.current) scanPlaneRef.current.visible = step === 2;

    const showLeft = isResults && (viewMode === "unified" || viewMode === "left");
    const showRight = isResults && (viewMode === "unified" || viewMode === "right");
    if (leftGroupRef.current) leftGroupRef.current.visible = showLeft;
    if (rightGroupRef.current) rightGroupRef.current.visible = showRight;

    // --- GUN INSERTION LOGIC ---
    // (Used by Step 3 intro to animate gun into the stationary mold)
    const startX = -globalParams.totalLength * 1.1;
    const endX = 0;
    
    // Use tInsert for smooth movement of the gun scan only
    const gunX = THREE.MathUtils.lerp(startX, endX, tInsert);
    if (gunRef.current) {
      gunRef.current.position.x = gunX;
      gunMaterial.opacity = 1.0;
    }
    // Assembly container remains centered
    if (containerRef.current) {
      containerRef.current.position.x = 0;
    }

    if (step === 2) {
      // For Step 2, the laser plane moves across the stationary unit
      const muzzleWorldX = plug.gunLeadingX;
      plugClipPlane.constant = 1e6; // Don't clip during generation pulse
      if (scanPlaneRef.current) {
        phaseRef.current += delta * 1.2;
        const scanT = (Math.sin(phaseRef.current) + 1) / 2;
        scanPlaneRef.current.position.x = THREE.MathUtils.lerp(-globalParams.totalLength/2, globalParams.totalLength/2, scanT);
      }

      const pulse = (Math.sin(phaseRef.current * 8) + 1) / 2;
      plugMaterial.emissiveIntensity = 0.1 + pulse * 0.5;
    }

    // --- MOLD SPLITTING LOGIC (Step 3 only) ---
    if (isResults) {
      plugClipPlane.constant = 1e6; // Show full plug during split
      const sep = plug.size.z * 1.1;

      if (viewMode === "unified") {
        if (leftGroupRef.current) {
          leftGroupRef.current.position.set(0, 0, -sep * tSplit);
          leftGroupRef.current.rotation.set(0, 0, 0);
        }
        if (rightGroupRef.current) {
          rightGroupRef.current.position.set(0, 0, sep * tSplit);
          rightGroupRef.current.rotation.set(0, 0, 0);
        }
        if (gunRef.current) {
          gunRef.current.rotation.set(0, 0, 0);
          gunRef.current.position.z = 0;
        }
      } else if (viewMode === "left") {
        const rotX = THREE.MathUtils.lerp(0, Math.PI / 2, tSplit);
        if (leftGroupRef.current) {
          leftGroupRef.current.position.set(0, 0, 0);
          leftGroupRef.current.rotation.x = rotX;
        }
        if (gunRef.current) {
          gunRef.current.rotation.x = rotX;
          gunRef.current.position.z = 0;
        }
      } else if (viewMode === "right") {
        const rotX = THREE.MathUtils.lerp(0, -Math.PI / 2, tSplit);
        if (rightGroupRef.current) {
          rightGroupRef.current.position.set(0, 0, 0);
          rightGroupRef.current.rotation.x = rotX;
        }
        if (gunRef.current) {
          gunRef.current.rotation.x = rotX;
          gunRef.current.position.z = 0;
        }
      }
    }
  });

  return (
    <group ref={containerRef}>
      <mesh
        ref={plugMeshRef}
        geometry={plug.full}
        material={plugMaterial}
        castShadow
        receiveShadow
      />
      <group ref={gunRef}>
        <mesh geometry={plug.gun} material={gunMaterial} castShadow />
        <mesh geometry={plug.gun}>
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.1} />
        </mesh>
        {globalParams.showFeatures && (
          <FeatureOverlays
            featureStates={featureStates}
            globalParams={globalParams}
            muzzleX={muzzleX}
            gunTopY={gunTopY}
            gunBounds={gunBounds}
            activeTag={activeTag}
            onTagPoint={onTagPoint}
          />
        )}
      </group>

      {/* Laser Scanning Plane */}
      <mesh ref={scanPlaneRef} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[plug.size.z * 2.5, plug.size.y * 1.5]} />
        <meshBasicMaterial
          color="#5EEAD4"
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>

      <group ref={leftGroupRef}>
        <mesh geometry={plug.left} material={halfMaterial} castShadow receiveShadow />
        {accessories
          .filter((a) => a.side === "left")
          .map((acc) => (
            <Accessory
              key={acc.id}
              data={acc}
              isActive={activeAccessoryId === acc.id}
              onSelect={() => onSelectAccessory(acc.id)}
            />
          ))}
      </group>

      <group ref={rightGroupRef}>
        <mesh geometry={plug.right} material={halfMaterial} castShadow receiveShadow />
        {accessories
          .filter((a) => a.side === "right")
          .map((acc) => (
            <Accessory
              key={acc.id}
              data={acc}
              isActive={activeAccessoryId === acc.id}
              onSelect={() => onSelectAccessory(acc.id)}
            />
          ))}
      </group>
    </group>
  );
}

function ClayBlock({
  visible,
  sizeHint,
  totalLength,
  centerX = 0,
}: {
  visible: boolean;
  sizeHint: THREE.Vector3;
  totalLength: number;
  centerX?: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const phaseRef = useRef(0);

  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.MeshStandardMaterial;
    const target = visible ? 1.0 : 0;
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, target, delta * 3);
    ref.current.visible = mat.opacity > 0.01;

    if (visible) {
      phaseRef.current += delta * 4;
      const pulse = (Math.sin(phaseRef.current) + 1) / 2;
      mat.emissiveIntensity = 0.2 + pulse * 0.4;
      if (lightRef.current) {
        lightRef.current.intensity = 0.5 + pulse * 1.5;
      }
    }
  });

  const w = totalLength;
  const h = sizeHint.y * 1.4;
  const d = sizeHint.z * 2.2;

  return (
    <group position={[centerX, 0, 0]}>
      <mesh ref={ref}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color="#d1d5db"
          transparent
          opacity={0}
          roughness={0.8}
          metalness={0.1}
          emissive="#5eead4"
          emissiveIntensity={0}
          depthWrite={false}
        />
      </mesh>
      {visible && (
        <pointLight
          ref={lightRef}
          position={[0, 0, 0]}
          color="#5eead4"
          distance={w}
          intensity={0}
        />
      )}
    </group>
  );
}

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

// HUD-style marker pulsing at a tagged feature point.
function FeatureMarker({
  coords,
  color,
  active,
  featureId,
  instanceIndex,
  pointIndex,
  onTagPoint,
  targetMesh,
  onDragStart,
  onDragEnd,
}: {
  coords: [number, number, number];
  color: string;
  active: boolean;
  featureId: string;
  instanceIndex: number;
  pointIndex: number;
  onTagPoint: (featureId: string, instanceIndex: number, pointIndex: number, coords: Vec3) => void;
  targetMesh: THREE.Mesh | null;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const [showLockedHint, setShowLockedHint] = useState(false);
  const { camera, raycaster } = useThree();

  useCursor(hovered && active);

  useEffect(() => {
    if (showLockedHint) {
      const timer = setTimeout(() => setShowLockedHint(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showLockedHint]);

  const bind = useDrag(({ active: dragging, event }) => {
    // ALWAYS stop propagation to prevent camera movement and model clicks
    const e = event as unknown as ThreeEvent<PointerEvent>;
    if (e.stopPropagation) e.stopPropagation();

    if (!targetMesh || !active) {
      if (dragging) setShowLockedHint(true);
      return;
    }
    
    if (dragging) {
      const intersects = raycaster.intersectObject(targetMesh);
      if (intersects.length > 0) {
        const p = intersects[0].point;
        onTagPoint(featureId, instanceIndex, pointIndex, [p.x, p.y, p.z]);
      }
      onDragStart();
    } else {
      onDragEnd();
    }
  });

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.6;
    }
    if (pulseRef.current) {
      const s = 1 + Math.sin(t * 2.2) * 0.25;
      pulseRef.current.scale.setScalar(s);
      const mat = pulseRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.55 - Math.sin(t * 2.2) * 0.25;
    }
  });

  const isSmallFeature = featureId === "nub";
  const s = isSmallFeature ? 0.35 : 1.0;

  return (
    <group 
      position={coords} 
      {...(bind() as any)} 
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {showLockedHint && !active && (
        <Html position={[0, 15 * s, 0]} center distanceFactor={80}>
          <div className="bg-[var(--hud-panel)] border-[3px] border-[var(--hud-amber)] px-5 py-3 whitespace-nowrap shadow-[0_0_30px_rgba(245,158,11,0.6)] animate-hud-fade-up pointer-events-none scale-75">
            <span className="text-[24px] font-mono font-black text-[var(--hud-amber-bright)] uppercase tracking-widest leading-none block text-center">
              [ LOCKED ]
            </span>
          </div>
        </Html>
      )}
      <mesh>
        <sphereGeometry args={[1.8 * s, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 1 : 0.3} />
      </mesh>
      <mesh ref={pulseRef}>
        <sphereGeometry args={[2.8 * s, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 0.5 : 0.15} />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.2 * s, 3.7 * s, 32]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 1 : 0.25} side={THREE.DoubleSide} />
      </mesh>
      {active && (
        <>
          <mesh rotation={[0, 0, 0]}>
            <ringGeometry args={[5.2 * s, 5.5 * s, 48, 1, 0, Math.PI / 3]} />
            <meshBasicMaterial color={color} transparent opacity={1} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI]}>
            <ringGeometry args={[5.2 * s, 5.5 * s, 48, 1, 0, Math.PI / 3]} />
            <meshBasicMaterial color={color} transparent opacity={1} side={THREE.DoubleSide} />
          </mesh>
        </>
      )}
    </group>
  );
}

function MuzzleCutPlane({
  featureId,
  state,
  muzzleX,
  gunBounds,
  onTagPoint,
  active,
}: {
  featureId: string;
  state: FeatureState;
  muzzleX: number;
  gunBounds: { center: THREE.Vector3; size: THREE.Vector3; slideTopY: number } | null;
  onTagPoint: (featureId: string, instanceIndex: number, pointIndex: number, coords: Vec3) => void;
  active: boolean;
}) {
  const p0 = state.points[0];
  const cutX = p0 ? p0[0] : muzzleX - 5;
  const centerY = gunBounds ? gunBounds.center.y : 0;
  const { raycaster } = useThree();

  const bind = useDrag(({ active: dragging, event }) => {
    const e = event as unknown as ThreeEvent<PointerEvent>;
    if (e.stopPropagation) e.stopPropagation();

    if (dragging) {
      // Find intersection with the gun's center plane in X
      const p = new THREE.Vector3();
      raycaster.ray.at(10, p); // Approximation fallback

      // Project the ray's mouse position onto the X axis at centerY
      // This is a simple vertical plane intersection
      // Ray: origin + t*dir. Intersection with Z=0 plane:
      const t = -raycaster.ray.origin.z / raycaster.ray.direction.z;
      raycaster.ray.at(t, p);

      onTagPoint(featureId, 0, 0, [p.x, centerY, 0]);
    }
  });

  return (
    <group position={[cutX, centerY, 0]}>
      <mesh {...(bind() as any)} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[300, 300]} />
        <meshBasicMaterial 
          color="#4ADE80" 
          transparent 
          opacity={active ? 0.1 : 0.04} 
          side={THREE.DoubleSide} 
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function BboxDebugLabels
({ bounds }: { bounds: { size: THREE.Vector3; center: THREE.Vector3; slideTopY: number } }) {
  const { size, center, slideTopY } = bounds;
  const frontX = center.x + size.x / 2;
  const rearX  = center.x - size.x / 2;
  const bboxTopY = center.y + size.y / 2;
  const topY   = slideTopY;
  const midY   = center.y;
  const midX   = center.x;

  const labelClass =
    "px-1.5 py-0.5 whitespace-nowrap font-mono text-[8px] uppercase tracking-wider bg-black/50 text-white pointer-events-none rounded-sm";

  return (
    <group>
      <mesh position={[frontX, topY, 0]}>
        <sphereGeometry args={[2.5, 16, 16]} />
        <meshBasicMaterial color="#f59e0b" />
        <Html position={[0, 6, 0]} center distanceFactor={160}>
          <div className={`${labelClass} text-amber-200`}>
            FRONT (+X) {frontX.toFixed(1)}
          </div>
        </Html>
      </mesh>

      <mesh position={[rearX, topY, 0]}>
        <sphereGeometry args={[2.5, 16, 16]} />
        <meshBasicMaterial color="#ef4444" />
        <Html position={[0, 6, 0]} center distanceFactor={160}>
          <div className={`${labelClass} text-red-200`}>
            REAR (-X) {rearX.toFixed(1)}
          </div>
        </Html>
      </mesh>

      <mesh position={[midX, topY, 0]}>
        <sphereGeometry args={[2.5, 16, 16]} />
        <meshBasicMaterial color="#5eead4" />
        <Html position={[0, 6, 0]} center distanceFactor={160}>
          <div className={`${labelClass} text-teal-200`}>
            SLIDE TOP {topY.toFixed(1)}
          </div>
        </Html>
      </mesh>

      <mesh position={[midX, bboxTopY, 0]}>
        <sphereGeometry args={[2.0, 16, 16]} />
        <meshBasicMaterial color="#a78bfa" />
        <Html position={[0, 6, 0]} center distanceFactor={160}>
          <div className={`${labelClass} text-violet-200`}>
            BBOX TOP {bboxTopY.toFixed(1)}
          </div>
        </Html>
      </mesh>
    </group>
  );
}

function CameraController({ isFlat }: { isFlat: boolean }) {
  const { camera, controls } = useThree();
  const lastIsFlat = useRef(isFlat);

  useEffect(() => {
    if (isFlat !== lastIsFlat.current) {
      if (isFlat) {
        camera.position.set(0, 400, 0);
        camera.lookAt(0, 0, 0);
      } else {
        camera.position.set(140, 120, 220);
        camera.lookAt(0, 0, 0);
      }
      if (controls) {
        const c = controls as unknown as { target: THREE.Vector3; update: () => void };
        c.target.set(0, 0, 0);
        c.update();
      }
      lastIsFlat.current = isFlat;
    }
  }, [isFlat, camera, controls]);

  return null;
}

function ProcessingSimulation({
  gunUrl,
  globalParams,
  realtimeProgress,
  featureStates,
  muzzleX,
  gunTopY,
  gunBounds,
  activeTag,
  onTagPoint,
  isProcessing,
}: {
  gunUrl: string;
  globalParams: GlobalParams;
  realtimeProgress: number;
  featureStates: FeatureStates;
  muzzleX: number;
  gunTopY: number;
  gunBounds: { size: THREE.Vector3; center: THREE.Vector3; slideTopY: number } | null;
  activeTag: ActiveTag;
  onTagPoint: (featureId: string, instanceIndex: number, pointIndex: number, coords: Vec3) => void;
  isProcessing: boolean;
}) {
  const gun = useLoader(STLLoader, gunUrl);
  const [gunSize, setGunSize] = useState<THREE.Vector3>(
    new THREE.Vector3(160, 40, 30)
  );
  const gunRef = useRef<THREE.Group>(null);
  const scanPlaneRef = useRef<THREE.Mesh>(null);

  const plugClipPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6),
    []
  );

  const centeredGun = useMemo(() => {
    const g = gun.clone();
    g.center();
    g.computeBoundingBox();
    const s = new THREE.Vector3();
    g.boundingBox?.getSize(s);
    setGunSize(s);
    return g;
  }, [gun]);

  const effectiveBlockWidth = Math.max(globalParams.totalLength, gunSize.x);

  const phaseRef = useRef(0);
  const pulsePhaseRef = useRef(0);

  useFrame(({ clock }, delta) => {
    if (!gunRef.current) return;

    const speed = 0.6 + realtimeProgress * 1.5;
    phaseRef.current += delta * speed;

    const pulseSpeed = 6 + realtimeProgress * 12;
    pulsePhaseRef.current += delta * pulseSpeed;

    const t = (Math.sin(phaseRef.current) + 1) / 2;
    const halfW = effectiveBlockWidth / 2;
    const scanX = THREE.MathUtils.lerp(-halfW, halfW, t);

    gunRef.current.position.x = (gunSize.x - effectiveBlockWidth) / 2;

    plugClipPlane.constant = 1e6;

    if (scanPlaneRef.current) {
      scanPlaneRef.current.position.x = scanX;
      scanPlaneRef.current.rotation.set(0, Math.PI / 2, 0);
      const fade = Math.sin(t * Math.PI);
      (scanPlaneRef.current.material as THREE.MeshBasicMaterial).opacity = 0.2 + fade * 0.5;

      (scanPlaneRef.current.material as THREE.MeshBasicMaterial).color.setHSL(
        (170 - realtimeProgress * 50) / 360,
        0.7,
        0.6
      );
    }

    const mesh = gunRef.current.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const pulse = (Math.sin(pulsePhaseRef.current) + 1) / 2;
    mat.emissiveIntensity = 0.2 + pulse * 0.6;
  });

  return (
    <group>
      <ClayBlock
        visible={true}
        sizeHint={gunSize}
        totalLength={effectiveBlockWidth}
      />

      <group ref={gunRef} visible={globalParams.showGun}>
        <mesh geometry={centeredGun} renderOrder={100}>
          <meshStandardMaterial
            color={globalParams.gunColor}
            metalness={0.6}
            roughness={0.3}
            emissive={globalParams.gunColor}
            emissiveIntensity={1.0}
            depthTest={false}
          />
        </mesh>
        <mesh geometry={centeredGun} renderOrder={101}>
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.15} depthTest={false} />
        </mesh>
        {gunBounds && globalParams.showFeatures && (
          <group position={[-gunBounds.center.x, -gunBounds.center.y, -gunBounds.center.z]}>
            <FeatureOverlays
              featureStates={featureStates}
              globalParams={globalParams}
              muzzleX={muzzleX}
              gunTopY={gunTopY}
              gunBounds={gunBounds}
              activeTag={activeTag}
              onTagPoint={onTagPoint}
            />
          </group>
        )}
      </group>
      <mesh ref={scanPlaneRef} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[gunSize.z * 2.5, gunSize.y * 1.5]} />
        <meshBasicMaterial
          color="#5EEAD4"
          transparent
          opacity={0.6}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function LoadedScene(props: SceneProps & { onDraggingChanged: (d: boolean) => void }) {
  const {
    step,
    viewMode,
    assets,
    alignedGunUrl,
    cavityUrl,
    featureStates,
    activeTag,
    onTagPoint,
    placedAccessories,
    activeAccessoryId,
    onUpdateAccessory,
    onSetActiveAccessory,
    globalParams,
    progress,
    isProcessing,
    onDraggingChanged,
  } = props;

  const gunMeshRef = useRef<THREE.Mesh>(null);
  const [gunBounds, setGunBounds] = useState<{ size: THREE.Vector3, center: THREE.Vector3, slideTopY: number } | null>(null);

  const handleGunLoad = useCallback((size: THREE.Vector3, center: THREE.Vector3, slideTopY: number) => {
    setGunBounds((prev) => {
      if (
        prev &&
        prev.size.equals(size) &&
        prev.center.equals(center) &&
        prev.slideTopY === slideTopY
      ) return prev;
      return { size, center, slideTopY };
    });
  }, []);

  const markers = useMemo(() => {
    const out: Array<{
      key: string;
      coords: [number, number, number];
      color: string;
      active: boolean;
      featureId: string;
      instanceIndex: number;
      pointIndex: number;
    }> = [];
    for (const def of FEATURES) {
      if (!def.published) continue;
      const instances = featureStates[def.id] || [];
      instances.forEach((state, idx) => {
        if (!state.enabled) return;
        const color = getInstanceColor(def.color, idx);
        state.points.forEach((pt, i) => {
          if (!pt) return;
          out.push({
            key: `${def.id}.${idx}.${i}`,
            coords: pt,
            color,
            active:
              activeTag?.featureId === def.id && 
              activeTag.instanceIndex === idx && 
              activeTag.pointIndex === i,
            featureId: def.id,
            instanceIndex: idx,
            pointIndex: i,
          });
        });
      });
    }
    return out;
  }, [featureStates, activeTag]);

  const gunMuzzleX = useMemo(() => {
    if (gunBounds) {
      // HAS: muzzle is at +X (bounding box max).
      return gunBounds.center.x + gunBounds.size.x / 2;
    }
    return 80;
  }, [gunBounds]);

  const gunTopY = useMemo(() => {
    if (gunBounds) return gunBounds.slideTopY;
    return 0;
  }, [gunBounds]);

  return (
    <>
      {step === 1.5 && alignedGunUrl && (
        <>
          <PickingGun
            url={alignedGunUrl}
            activeTag={null}
            onTagPoint={onTagPoint}
            gunColor={globalParams.gunColor}
            meshRef={gunMeshRef}
            onLoad={handleGunLoad}
            scanMuzzleX={assets?.scanMuzzleX ?? 0}
            isProcessing={isProcessing}
            visible={true}
          />

          {/* Visual indicator for Total Length (Insertion Depth) — entrance plane at -X side of the cavity. */}
          <group position={[gunMuzzleX - globalParams.totalLength, gunBounds?.center.y ?? 0, 0]}>
            <mesh rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[100, 100]} />
              <meshBasicMaterial color="#ef4444" transparent opacity={0.2} side={THREE.DoubleSide} />
            </mesh>
            <Html position={[0, 52, 0]} center distanceFactor={160}>
              <div className="px-2 py-0.5 whitespace-nowrap font-mono text-[9px] font-bold uppercase tracking-widest bg-[#ef4444] text-[#030710] pointer-events-none rounded-sm shadow-[0_0_10px_rgba(239,68,68,0.3)]">
                TOTAL LENGTH OF MOLD: {globalParams.totalLength}mm
              </div>
            </Html>
          </group>
        </>
      )}

      {step === 1.75 && cavityUrl && (
        <>
          <PickingGun
            url={cavityUrl}
            activeTag={activeTag}
            onTagPoint={onTagPoint}
            gunColor={globalParams.moldColor}
            meshRef={gunMeshRef}
            onLoad={handleGunLoad}
            scanMuzzleX={assets?.scanMuzzleX ?? 0}
            isProcessing={isProcessing}
            visible={true}
          />
          {globalParams.showGun && alignedGunUrl && (
            <GhostGun url={alignedGunUrl} color={globalParams.gunColor} />
          )}
          {globalParams.showFeatures && (
            <FeatureOverlays
              featureStates={featureStates}
              globalParams={globalParams}
              muzzleX={gunMuzzleX}
              gunTopY={gunTopY}
              gunBounds={gunBounds}
              activeTag={activeTag}
              onTagPoint={onTagPoint}
            />
          )}

          {gunBounds && <BboxDebugLabels bounds={gunBounds} />}

          {/* Draggable Muzzle Cut Plane */}
          {globalParams.showFeatures && FEATURES.filter(d => d.id === "muzzle_cut").map(def => {
            const instances = featureStates[def.id] || [];
            return instances.map((state, idx) => {
              if (!state.enabled) return null;
              return (
                <MuzzleCutPlane
                  key={`${def.id}-${idx}`}
                  featureId={def.id}
                  state={state}
                  muzzleX={gunMuzzleX}
                  gunBounds={gunBounds}
                  onTagPoint={onTagPoint}
                  active={activeTag?.featureId === def.id}
                />
              );
            });
          })}
        </>
      )}

      {step === 2 && !assets && alignedGunUrl && (
        <ProcessingSimulation
          gunUrl={alignedGunUrl}
          globalParams={globalParams}
          realtimeProgress={progress}
          featureStates={featureStates}
          muzzleX={gunMuzzleX}
          gunTopY={gunTopY}
          gunBounds={gunBounds}
          activeTag={activeTag}
          onTagPoint={onTagPoint}
          isProcessing={isProcessing}
        />
      )}

      {step === 1.75 &&
        markers.map((m) => (
          <FeatureMarker
            key={m.key}
            coords={m.coords}
            color={m.color}
            active={m.active}
            featureId={m.featureId}
            instanceIndex={m.instanceIndex}
            pointIndex={m.pointIndex}
            onTagPoint={onTagPoint}
            targetMesh={gunMeshRef.current}
            onDragStart={() => onDraggingChanged(true)}
            onDragEnd={() => onDraggingChanged(false)}
          />
        ))}

      {assets && (
        <MoldAssets
          assets={assets}
          step={step}
          viewMode={viewMode}
          placedAccessories={placedAccessories}
          activeAccessoryId={activeAccessoryId}
          onUpdateAccessory={onUpdateAccessory}
          onSetActiveAccessory={onSetActiveAccessory}
          globalParams={globalParams}
          featureStates={featureStates}
          muzzleX={gunMuzzleX}
          gunTopY={gunTopY}
          gunBounds={gunBounds}
          activeTag={activeTag}
          onTagPoint={onTagPoint}
          progress={progress}
        />
      )}
    </>
  );
}

export function Scene(props: SceneProps) {
  const isFlat = props.viewMode === "left" || props.viewMode === "right";
  const [isDragging, setIsDragging] = useState(false);

  return (
    <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, localClippingEnabled: true }}>
      <color attach="background" args={["#030710"]} />
      <fog attach="fog" args={["#030710", 420, 1100]} />

      {isFlat ? (
        <OrthographicCamera makeDefault position={[0, 400, 0]} zoom={2.5} near={1} far={2000} />
      ) : (
        <PerspectiveCamera makeDefault position={[140, 120, 220]} fov={35} near={1} far={2000} />
      )}

      <CameraController isFlat={isFlat} />
      <ambientLight intensity={0.35} color="#a8d8e8" />
      <directionalLight
        position={[120, 200, 120]}
        intensity={1.05}
        color="#dff2ff"
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-100, 60, -80]} intensity={0.4} color="#3be0c9" />
      <pointLight position={[0, -200, 0]} intensity={0.25} color="#0c5c7a" />

      <Suspense fallback={null}>
        <LoadedScene {...props} onDraggingChanged={setIsDragging} />
      </Suspense>

      <gridHelper args={[400, 20, "#3be0c9", "#0a2a3a"]} position={[0, -40, 0]} />
      <gridHelper args={[800, 4, "#0e4a5c", "#072030"]} position={[0, -40.1, 0]} />

      {isFlat ? (
        <MapControls 
          target={[0, 0, 0]} 
          enableRotate={false} 
          screenSpacePanning={true} 
          enabled={!isDragging}
        />
      ) : (
        <OrbitControls 
          target={[0, 0, 0]} 
          minDistance={100} 
          maxDistance={800} 
          enabled={!isDragging}
        />
      )}
    </Canvas>
  );
}
