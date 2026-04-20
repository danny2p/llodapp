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
import { Suspense, useMemo, useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";
import {
  FEATURES,
  type FeatureStates,
  type GlobalParams,
} from "@/lib/features";
import { flfFromPoints, type Vec3 } from "@/lib/featuresFrame";

export type Step = 1 | 1.5 | 2 | 3;
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
};

export type ActiveTag = { featureId: string; pointIndex: number } | null;

type SceneProps = {
  step: Step;
  viewMode: ViewMode;
  assets: SceneAssets | null;
  alignedGunUrl?: string | null;
  featureStates: FeatureStates;
  activeTag: ActiveTag;
  onTagPoint: (featureId: string, pointIndex: number, coords: Vec3) => void;
  placedAccessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  onUpdateAccessory: (id: string, updates: Partial<PlacedAccessory>) => void;
  onSetActiveAccessory: (id: string | null) => void;
  globalParams: GlobalParams;
  progress: number;
};

// Feature overlays — iterate the registry and render each feature's own
// Overlay component (defined in `web/features/<id>/overlay.tsx`).
// Marker-only features omit Overlay and render nothing here.

function FeatureOverlays({
  featureStates,
  globalParams,
}: {
  featureStates: FeatureStates;
  globalParams: GlobalParams;
}) {
  return (
    <group>
      {FEATURES.filter((def) => def.published).map((def) => {
        if (!def.Overlay) return null;
        const state = featureStates[def.id];
        if (!state?.enabled) return null;

        // For automatic features (0 points), use identity frame at world origin.
        // For tagged features, derive frame from points.
        let flf = flfFromPoints(state.points);
        if (!flf && def.points.length === 0) {
          flf = {
            origin: [0, 0, 0],
            R: [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ],
          };
        }

        if (!flf) return null;
        const Overlay = def.Overlay;
        return (
          <Overlay
            key={def.id}
            def={def}
            state={state}
            flf={flf}
            globalParams={globalParams}
          />
        );
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
}: {
  url: string;
  activeTag: ActiveTag;
  onTagPoint: (featureId: string, pointIndex: number, coords: Vec3) => void;
  gunColor: string;
  meshRef: React.RefObject<THREE.Mesh | null>;
}) {
  const geometry = useLoader(STLLoader, url);
  const mesh = useMemo(() => {
    const g = geometry.clone();
    g.computeVertexNormals();
    return g;
  }, [geometry]);

  return (
    <mesh
      ref={meshRef}
      geometry={mesh}
      onPointerDown={(e) => {
        if (activeTag) {
          e.stopPropagation();
          const p = e.point;
          onTagPoint(activeTag.featureId, activeTag.pointIndex, [p.x, p.y, p.z]);
        }
      }}
    >
      <meshStandardMaterial color={gunColor} roughness={0.4} />
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
}: {
  assets: SceneAssets;
  step: Step;
  viewMode: ViewMode;
  placedAccessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  onUpdateAccessory: (id: string, updates: Partial<PlacedAccessory>) => void;
  onSetActiveAccessory: (id: string | null) => void;
  globalParams: GlobalParams;
}) {
  const [full, left, right, gun] = useLoader(STLLoader, [
    assets.fullUrl,
    assets.leftUrl,
    assets.rightUrl,
    assets.gunUrl,
  ]);

  const plug = useMemo((): PlugData => {
    // Shift to match backend centroid centering
    const gunBB = gun.clone();
    gunBB.computeBoundingBox();
    const gunCenter = new THREE.Vector3();
    gunBB.boundingBox!.getCenter(gunCenter);
    
    const shift: [number, number, number] = [-gunCenter.x, -gunCenter.y, -gunCenter.z];

    const fullPrepared = full.clone();
    fullPrepared.translate(...shift);
    fullPrepared.computeVertexNormals();

    const leftPrepared = left.clone();
    leftPrepared.translate(...shift);
    leftPrepared.computeVertexNormals();

    const rightPrepared = right.clone();
    rightPrepared.translate(...shift);
    rightPrepared.computeVertexNormals();

    const gunPrepared = gun.clone();
    gunPrepared.translate(...shift);
    gunPrepared.rotateY(Math.PI);
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
        visible={step === 2}
        sizeHint={plug.size}
        totalLength={globalParams.totalLength}
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
  onUpdate: (id: string, updates: Partial<PlacedAccessory>) => void;
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
}: {
  step: Step;
  viewMode: ViewMode;
  plug: PlugData;
  accessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  onUpdateAccessory: (id: string, updates: Partial<PlacedAccessory>) => void;
  onSelectAccessory: (id: string | null) => void;
  globalParams: GlobalParams;
}) {
  const plugMeshRef = useRef<THREE.Mesh>(null);
  const gunRef = useRef<THREE.Mesh>(null);
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
        opacity: 1,
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
      }),
    [globalParams.moldColor]
  );

  useFrame(({ clock }, delta) => {
    const modeChanged = lastViewModeRef.current !== viewMode;
    const stepChanged = lastStepRef.current !== step;

    if (stepChanged || modeChanged) {
      progressRef.current = 0;
      lastStepRef.current = step;
      lastViewModeRef.current = viewMode;
    }

    const duration = step === 2 ? 3.0 : 1.5;
    progressRef.current = Math.min(1, progressRef.current + delta / duration);
    const t = easeOutCubic(progressRef.current);

    if (plugMeshRef.current) plugMeshRef.current.visible = step === 2;
    if (gunRef.current) gunRef.current.visible = step === 2;
    if (scanPlaneRef.current) scanPlaneRef.current.visible = step === 2;

    const showLeft = step === 3 && (viewMode === "unified" || viewMode === "left");
    const showRight = step === 3 && (viewMode === "unified" || viewMode === "right");
    if (leftGroupRef.current) leftGroupRef.current.visible = showLeft;
    if (rightGroupRef.current) rightGroupRef.current.visible = showRight;

    if (step === 2) {
      const moldFrontX = plug.size.x / 2 + 0.5;
      const startX = -globalParams.totalLength * 1.1;
      const endX = moldFrontX - plug.gunLeadingX;
      const gunX = THREE.MathUtils.lerp(startX, endX, t);
      if (gunRef.current) gunRef.current.position.x = gunX;

      const muzzleWorldX = gunX + plug.gunLeadingX;
      plugClipPlane.constant = muzzleWorldX;

      if (scanPlaneRef.current) {
        scanPlaneRef.current.position.x = muzzleWorldX;
      }

      phaseRef.current += delta * 10;
      const pulse = (Math.sin(phaseRef.current) + 1) / 2;
      plugMaterial.emissiveIntensity = 0.1 + pulse * 0.5;

      const fadeStart = 0.75;
      gunMaterial.opacity =
        t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / (1 - fadeStart));
    }

    if (step === 3) {
      plugClipPlane.constant = 1e6;
      const sep = plug.size.z * 1.1;

      if (viewMode === "unified") {
        if (leftGroupRef.current) {
          leftGroupRef.current.position.set(0, 0, -sep * t);
          leftGroupRef.current.rotation.set(0, 0, 0);
        }
        if (rightGroupRef.current) {
          rightGroupRef.current.position.set(0, 0, sep * t);
          rightGroupRef.current.rotation.set(0, 0, 0);
        }
      } else if (viewMode === "left") {
        if (leftGroupRef.current) {
          leftGroupRef.current.position.set(0, 0, 0);
          leftGroupRef.current.rotation.x = THREE.MathUtils.lerp(0, Math.PI / 2, t);
        }
      } else if (viewMode === "right") {
        if (rightGroupRef.current) {
          rightGroupRef.current.position.set(0, 0, 0);
          rightGroupRef.current.rotation.x = THREE.MathUtils.lerp(0, -Math.PI / 2, t);
        }
      }
    }
  });

  return (
    <group>
      <mesh
        ref={plugMeshRef}
        geometry={plug.full}
        material={plugMaterial}
        castShadow
        receiveShadow
      />
      <mesh ref={gunRef} geometry={plug.gun} material={gunMaterial} castShadow />

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
              onUpdate={onUpdateAccessory}
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
              onUpdate={onUpdateAccessory}
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
}: {
  visible: boolean;
  sizeHint: THREE.Vector3;
  totalLength: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const phaseRef = useRef(0);

  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.MeshStandardMaterial;
    const target = visible ? 0.3 : 0;
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
    <group position={[0, 0, 0]}>
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
  pointIndex: number;
  onTagPoint: (featureId: string, pointIndex: number, coords: Vec3) => void;
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
        onTagPoint(featureId, pointIndex, [p.x, p.y, p.z]);
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

  return (
    <group 
      position={coords} 
      {...(bind() as any)} 
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      {showLockedHint && !active && (
        <Html position={[0, 15, 0]} center distanceFactor={80}>
          <div className="bg-[var(--hud-panel)] border-[3px] border-[var(--hud-amber)] px-5 py-3 whitespace-nowrap shadow-[0_0_30px_rgba(245,158,11,0.6)] animate-hud-fade-up pointer-events-none">
            <span className="text-[24px] font-mono font-black text-[var(--hud-amber-bright)] uppercase tracking-widest leading-none block text-center">
              [ LOCKED ]
            </span>
            <div className="text-[18px] font-mono text-white/95 lowercase mt-2 border-t border-[var(--hud-amber)]/40 pt-2 text-center">
              select in sidebar to move
            </div>
          </div>
        </Html>
      )}
      <mesh>
        <sphereGeometry args={[1.8, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 1 : 0.3} />
      </mesh>
      <mesh ref={pulseRef}>
        <sphereGeometry args={[2.8, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 0.5 : 0.15} />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.2, 3.7, 32]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 1 : 0.25} side={THREE.DoubleSide} />
      </mesh>
      {active && (
        <>
          <mesh rotation={[0, 0, 0]}>
            <ringGeometry args={[5.2, 5.5, 48, 1, 0, Math.PI / 3]} />
            <meshBasicMaterial color={color} transparent opacity={1} side={THREE.DoubleSide} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI]}>
            <ringGeometry args={[5.2, 5.5, 48, 1, 0, Math.PI / 3]} />
            <meshBasicMaterial color={color} transparent opacity={1} side={THREE.DoubleSide} />
          </mesh>
        </>
      )}
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
}: {
  gunUrl: string;
  globalParams: GlobalParams;
  realtimeProgress: number;
}) {
  const gun = useLoader(STLLoader, gunUrl);
  const [gunSize, setGunSize] = useState<THREE.Vector3>(
    new THREE.Vector3(160, 40, 30)
  );
  const gunRef = useRef<THREE.Mesh>(null);
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

    const mat = gunRef.current.material as THREE.MeshStandardMaterial;
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

      <mesh ref={gunRef} geometry={centeredGun} rotation={[0, Math.PI, 0]}>
        <meshStandardMaterial
          color={globalParams.gunColor}
          metalness={0.6}
          roughness={0.3}
          emissive={globalParams.gunColor}
          emissiveIntensity={0.2}
          clippingPlanes={[plugClipPlane]}
        />
      </mesh>

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
    featureStates,
    activeTag,
    onTagPoint,
    placedAccessories,
    activeAccessoryId,
    onUpdateAccessory,
    onSetActiveAccessory,
    globalParams,
    progress,
    onDraggingChanged,
  } = props;

  const gunMeshRef = useRef<THREE.Mesh>(null);

  const markers = useMemo(() => {
    const out: Array<{
      key: string;
      coords: [number, number, number];
      color: string;
      active: boolean;
      featureId: string;
      pointIndex: number;
    }> = [];
    for (const def of FEATURES) {
      if (!def.published) continue;
      const state = featureStates[def.id];
      if (!state?.enabled) continue;
      state.points.forEach((pt, i) => {
        if (!pt) return;
        out.push({
          key: `${def.id}.${i}`,
          coords: pt,
          color: def.color,
          active:
            activeTag?.featureId === def.id && activeTag.pointIndex === i,
          featureId: def.id,
          pointIndex: i,
        });
      });
    }
    return out;
  }, [featureStates, activeTag]);

  return (
    <>
      {step === 1.5 && alignedGunUrl && (
        <>
          <PickingGun
            url={alignedGunUrl}
            activeTag={activeTag}
            onTagPoint={onTagPoint}
            gunColor={globalParams.gunColor}
            meshRef={gunMeshRef}
          />
          <FeatureOverlays
            featureStates={featureStates}
            globalParams={globalParams}
          />
        </>
      )}

      {step === 2 && !assets && alignedGunUrl && (
        <ProcessingSimulation
          gunUrl={alignedGunUrl}
          globalParams={globalParams}
          realtimeProgress={progress}
        />
      )}

      {step === 1.5 &&
        markers.map((m) => (
          <FeatureMarker 
            key={m.key} 
            coords={m.coords} 
            color={m.color} 
            active={m.active}
            featureId={m.featureId}
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
