"use client";

import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import {
  Line,
  OrbitControls,
  MapControls,
  PerspectiveCamera,
  OrthographicCamera,
  useCursor,
} from "@react-three/drei";
import { Suspense, useMemo, useRef, useEffect, useState } from "react";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";

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

export type FeaturePoint = {
  name: string;
  label: string;
  color: string;
  coords: [number, number, number] | null;
};

type SceneProps = {
  step: Step;
  viewMode: ViewMode;
  assets: SceneAssets | null;
  alignedGunUrl?: string | null;
  featurePoints: FeaturePoint[];
  activeFeatureIndex: number | null;
  onTagFeature: (index: number, coords: [number, number, number]) => void;
  placedAccessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  onUpdateAccessory: (id: string, updates: Partial<PlacedAccessory>) => void;
  onSetActiveAccessory: (id: string | null) => void;
  params?: any; // To pass dimensions for overlays
};

function FeatureOverlays({
  featurePoints,
  params,
}: {
  featurePoints: FeaturePoint[];
  params: any;
}) {
  const tgPoint = featurePoints.find((f) => f.name === "tg_front")?.coords;
  const srPoint = featurePoints.find((f) => f.name === "slide_release")?.coords;

  return (
    <group>
      {/* 
          COORDINATE SYSTEM REFERENCE:
          - X Axis: Length of gun.
          - Negative X (-X): Toward Muzzle (closed end of holster).
          - Positive X (+X): Toward Grip / Entrance (where gun exits).
          
          CLEARANCE CHANNEL DIRECTION: 
          Must extend toward the ENTRANCE (+X) so the feature can slide out.
      */}
      {/* Trigger Retention Overlay */}
      {tgPoint && params.retention && (
        <group
          position={[
            tgPoint[0] + params.retentionFrontOffset,
            tgPoint[1] + params.retentionYOffset,
            tgPoint[2],
          ]}
          rotation={[0, 0, (params.retentionRotateDeg * Math.PI) / 180]}
        >
          {(() => {
            const l = params.retentionLength;
            const w = params.retentionWidthY;
            const d = params.retentionDepthZ;
            const r = Math.min(params.retentionCornerRadius, w * 0.45, l * 0.45);

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
              if (!params.retentionOneSide) {
                indices.push(i * 3 + 1, (i + 1) * 3 + 1, i * 3 + 2);
                indices.push((i + 1) * 3 + 1, (i + 1) * 3 + 2, i * 3 + 2);
              }
            }
            geometry.setAttribute(
              "position",
              new THREE.BufferAttribute(new Float32Array(vertices), 3)
            );
            geometry.setIndex(indices);

            return (
              <mesh geometry={geometry}>
                <meshBasicMaterial
                  color="#fbbf24"
                  transparent
                  opacity={0.3}
                  wireframe
                />
              </mesh>
            );
          })()}
        </group>
      )}

      {/* Slide Release Channel Overlay */}
      {srPoint && params.srEnabled && (
        <group
          position={[
            srPoint[0], 
            srPoint[1] + params.srYOffset,
            srPoint[2],
          ]}
        >
          {(() => {
            const channelLength = 200; 
            const w = params.srWidthY;
            const d = params.srDepthZ;
            const c = params.srChamfer;
            const isPos = srPoint[2] > 0;
            const zSign = isPos ? 1 : -1;
            const geometry = new THREE.BufferGeometry();
            
            const profile = [
              {y: -w/2, z: 0}, {y: w/2, z: 0},
              {y: w/2, z: Math.max(0, d - c) * zSign},
              {y: Math.max(0, w/2 - c), z: d * zSign},
              {y: -Math.max(0, w/2 - c), z: d * zSign},
              {y: -w/2, z: Math.max(0, d - c) * zSign},
            ];

            const vertices: number[] = [];
            // Slice 0: BUTTON face (X=0)
            profile.forEach(p => {
              let py = p.y; let pz = p.z;
              if (c > 0 && pz !== 0) {
                const ySign = Math.sign(py);
                py = (Math.abs(py) > c) ? (Math.abs(py) - c) * ySign : 0;
                pz = (Math.abs(pz) > c) ? (Math.abs(pz) - c) * zSign : 0;
              }
              vertices.push(0, py, pz);
            });
            // Slice 1: CHAMFER transition (X = +c) - Toward muzzle/grip?
            // Direction is +X in world space for holster entrance (rear of gun).
            vertices.push(...profile.flatMap(p => [c, p.y, p.z]));
            vertices.push(...profile.flatMap(p => [channelLength, p.y, p.z]));

            const indices = [
              0, 2, 1, 0, 3, 2, 0, 4, 3, 0, 5, 4,
              0, 6, 7, 0, 7, 1, 1, 7, 8, 1, 8, 2, 2, 8, 9, 2, 9, 3, 3, 9, 10, 3, 10, 4, 4, 10, 11, 4, 11, 5, 5, 11, 6, 5, 6, 0,
              6, 12, 13, 6, 13, 7, 7, 13, 14, 7, 14, 8, 8, 14, 15, 8, 15, 9, 9, 15, 16, 9, 16, 10, 10, 16, 17, 10, 17, 11, 11, 17, 12, 11, 12, 6,
              12, 13, 14, 12, 14, 15, 12, 15, 16, 12, 16, 17
            ];

            geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices), 3));
            geometry.setIndex(indices);
            geometry.computeVertexNormals();
            return (
              <mesh geometry={geometry}>
                <meshBasicMaterial color="#60a5fa" transparent opacity={0.3} wireframe />
              </mesh>
            );
          })()}
        </group>
      )}
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
  activeFeatureIndex,
  onTagFeature,
}: {
  url: string;
  activeFeatureIndex: number | null;
  onTagFeature: (index: number, coords: [number, number, number]) => void;
}) {
  const geometry = useLoader(STLLoader, url);
  const mesh = useMemo(() => {
    const g = geometry.clone();
    g.computeVertexNormals();
    return g;
  }, [geometry]);

  return (
    <mesh
      geometry={mesh}
      onPointerDown={(e) => {
        if (activeFeatureIndex !== null) {
          e.stopPropagation();
          const p = e.point;
          onTagFeature(activeFeatureIndex, [p.x, p.y, p.z]);
        }
      }}
    >
      <meshStandardMaterial color="#6e7480" roughness={0.4} />
    </mesh>
  );
}

function MoldAssets({
  assets,
  step,
  viewMode,
  placedAccessories,
  activeAccessoryId,
  onSetActiveAccessory,
}: {
  assets: SceneAssets;
  step: Step;
  viewMode: ViewMode;
  placedAccessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  onSetActiveAccessory: (id: string | null) => void;
}) {
  const [full, left, right, gun] = useLoader(STLLoader, [
    assets.fullUrl,
    assets.leftUrl,
    assets.rightUrl,
    assets.gunUrl,
  ]);

  const plug = useMemo((): PlugData => {
    const fullCopy = full.clone();
    fullCopy.computeBoundingBox();
    const bb = fullCopy.boundingBox!;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bb.getCenter(center);
    bb.getSize(size);

    const shift: [number, number, number] = [-center.x, -center.y, -center.z];

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

    return {
      full: fullPrepared,
      left: leftPrepared,
      right: rightPrepared,
      gun: gunPrepared,
      size,
      center: center.clone(),
      gunLeadingX,
    };
  }, [full, left, right, gun]);

  return (
    <>
      <ClayBlock visible={step === 2} sizeHint={plug.size} />
      {step >= 2 && (
        <Plug
          step={step}
          viewMode={viewMode}
          plug={plug}
          accessories={placedAccessories}
          activeAccessoryId={activeAccessoryId}
          onUpdateAccessory={onUpdateAccessory}
          onSelectAccessory={onSetActiveAccessory}
        />
      )}
    </>
  );
}

function Accessory({
  data,
  isActive,
  onSelect,
  onUpdate,
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
        color={isActive ? "#10b981" : hovered ? "#34d399" : "#6366f1"}
        metalness={0.6}
        roughness={0.2}
        emissive={isActive ? "#064e3b" : "#000000"}
        emissiveIntensity={isActive ? 0.5 : 0}
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
}: {
  step: Step;
  viewMode: ViewMode;
  plug: PlugData;
  accessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  onUpdateAccessory: (id: string, updates: Partial<PlacedAccessory>) => void;
  onSelectAccessory: (id: string | null) => void;
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
        color: "#1a2b45",
        metalness: 0.3,
        roughness: 0.4,
        clippingPlanes: [plugClipPlane],
      }),
    [plugClipPlane]
  );
  const gunMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#6e7480",
        metalness: 0.55,
        roughness: 0.35,
        transparent: true,
        opacity: 1,
      }),
    []
  );
  const halfMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: "#f2f6fa",
        metalness: 0.2,
        roughness: 0.35,
        clearcoat: 1.0,
        clearcoatRoughness: 0.08,
        sheen: 0.5,
        sheenColor: new THREE.Color("#dbe7f2"),
        sheenRoughness: 0.25,
        side: THREE.DoubleSide,
        flatShading: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    []
  );

  useFrame((_, delta) => {
    const modeChanged = lastViewModeRef.current !== viewMode;
    const stepChanged = lastStepRef.current !== step;

    if (stepChanged || modeChanged) {
      progressRef.current = 0;
      lastStepRef.current = step;
      lastViewModeRef.current = viewMode;
    }

    progressRef.current = Math.min(1, progressRef.current + delta / 1.5);
    const t = easeOutCubic(progressRef.current);

    if (plugMeshRef.current) plugMeshRef.current.visible = step === 2;
    if (gunRef.current) gunRef.current.visible = step === 2;

    const showLeft = step === 3 && (viewMode === "unified" || viewMode === "left");
    const showRight = step === 3 && (viewMode === "unified" || viewMode === "right");
    if (leftGroupRef.current) leftGroupRef.current.visible = showLeft;
    if (rightGroupRef.current) rightGroupRef.current.visible = showRight;

    if (step === 2) {
      const startX = -plug.size.x * 1.1;
      const endX = 0;
      const gunX = THREE.MathUtils.lerp(startX, endX, t);
      if (gunRef.current) gunRef.current.position.x = gunX;
      const muzzleWorldX = gunX + plug.gunLeadingX;
      plugClipPlane.constant = muzzleWorldX;
      const fadeStart = 0.75;
      gunMaterial.opacity = t < fadeStart ? 1 : Math.max(0, 1 - (t - fadeStart) / (1 - fadeStart));
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
          // Left half detail is at -Z. Rotate +90 around X to face UP (+Y).
          leftGroupRef.current.rotation.x = THREE.MathUtils.lerp(0, Math.PI / 2, t);
        }
      } else if (viewMode === "right") {
        if (rightGroupRef.current) {
          rightGroupRef.current.position.set(0, 0, 0);
          // Right half detail is at +Z. Rotate -90 around X to face UP (+Y).
          rightGroupRef.current.rotation.x = THREE.MathUtils.lerp(0, -Math.PI / 2, t);
        }
      }
    }
  });

  return (
    <group>
      <mesh ref={plugMeshRef} geometry={plug.full} material={plugMaterial} castShadow receiveShadow />
      <mesh ref={gunRef} geometry={plug.gun} material={gunMaterial} castShadow />
      
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
}: {
  visible: boolean;
  sizeHint: THREE.Vector3;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.MeshStandardMaterial;
    // Reduced target opacity for better internal visibility
    const target = visible ? 0.35 : 0;
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, target, delta * 3);
    ref.current.visible = mat.opacity > 0.01;
  });
  // Use exact sizeHint.x to ensure mold ends are flush with block faces.
  // We keep a small buffer in Y and Z for visual clarity of the carving.
  const w = sizeHint.x;
  const h = sizeHint.y * 1.4;
  const d = sizeHint.z * 2.2;
  return (
    <mesh ref={ref} position={[0, 0, 0]}>
      <boxGeometry args={[w, h, d]} />
      {/* Lighter color and slight emissive to make it pop against the void background */}
      <meshStandardMaterial
        color="#e5e0d8"
        transparent
        opacity={0}
        roughness={0.8}
        metalness={0.1}
        emissive="#1a1a1a"
      />
    </mesh>
  );
}

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

function FeatureMarker({
  coords,
  color,
}: {
  coords: [number, number, number];
  color: string;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
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
    <group position={coords}>
      <mesh>
        <sphereGeometry args={[1.4, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh ref={pulseRef}>
        <sphereGeometry args={[2.2, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.35} />
      </mesh>
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[3.2, 3.7, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[0, 0, 0]}>
        <ringGeometry args={[5.2, 5.35, 48, 1, 0, Math.PI / 3]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI]}>
        <ringGeometry args={[5.2, 5.35, 48, 1, 0, Math.PI / 3]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} />
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
        (controls as any).target.set(0, 0, 0);
        (controls as any).update();
      }
      lastIsFlat.current = isFlat;
    }
  }, [isFlat, camera, controls]);

  return null;
}

function LoadedScene(props: SceneProps) {
  const {
    step,
    viewMode,
    assets,
    alignedGunUrl,
    featurePoints,
    activeFeatureIndex,
    onTagFeature,
    placedAccessories,
    activeAccessoryId,
    onUpdateAccessory,
    onSetActiveAccessory,
    params,
  } = props;

  return (
    <>
      {step === 1.5 && alignedGunUrl && (
        <>
          <PickingGun url={alignedGunUrl} activeFeatureIndex={activeFeatureIndex} onTagFeature={onTagFeature} />
          {params && <FeatureOverlays featurePoints={featurePoints} params={params} />}
        </>
      )}

      {step === 1.5 &&
        featurePoints.map(
          (fp) =>
            fp.coords && <FeatureMarker key={fp.name} coords={fp.coords} color={fp.color} />
        )}

      {assets && (
        <MoldAssets
          assets={assets}
          step={step}
          viewMode={viewMode}
          placedAccessories={props.placedAccessories}
          activeAccessoryId={props.activeAccessoryId}
          onSetActiveAccessory={props.onSetActiveAccessory}
        />
      )}
    </>
  );
}

export function Scene(props: SceneProps) {
  const isFlat = props.viewMode === "left" || props.viewMode === "right";

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
        <LoadedScene {...props} />
      </Suspense>

      <gridHelper args={[400, 20, "#3be0c9", "#0a2a3a"]} position={[0, -40, 0]} />
      <gridHelper args={[800, 4, "#0e4a5c", "#072030"]} position={[0, -40.1, 0]} />

      {isFlat ? (
        <MapControls target={[0, 0, 0]} enableRotate={false} screenSpacePanning={true} />
      ) : (
        <OrbitControls target={[0, 0, 0]} minDistance={100} maxDistance={800} />
      )}
    </Canvas>
  );
}
