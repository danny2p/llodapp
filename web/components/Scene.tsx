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

            // Create a custom BufferGeometry for the ramped triangle
            // The "flat" side is at X=0, the "point" is at X=l
            // Depth ramps from d at X=0 to 0 at X=l
            const geometry = new THREE.BufferGeometry();
            const vertices = new Float32Array([
              // Top side (+Z)
              0, -w / 2, 0, // Flat bottom
              0, w / 2, 0,  // Flat top
              0, 0, d,      // Flat peak
              l, 0, 0,      // The point

              // Bottom side (-Z)
              0, -w / 2, 0,
              0, w / 2, 0,
              0, 0, -d,
              l, 0, 0,
            ]);

            const indices = [
              // +Z half
              0, 2, 1, // Flat face
              0, 3, 2, // Bottom slope
              1, 2, 3, // Top slope
              0, 1, 3, // Back face (base)
            ];

            if (!params.retentionOneSide) {
              // Add -Z half
              indices.push(
                4, 5, 6, // Flat face
                4, 6, 7, // Bottom slope
                5, 7, 6, // Top slope
                4, 7, 5  // Back face
              );
            }

            geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
            geometry.setIndex(indices);
            geometry.computeVertexNormals();

            return (
              <mesh geometry={geometry}>
                <meshBasicMaterial color="#fbbf24" transparent opacity={0.3} wireframe />
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
            srPoint[2] + (srPoint[2] > 0 ? params.srZOffset : -params.srZOffset),
          ]}
        >
          {(() => {
            const channelLength = 300; 
            return (
              <mesh position={[channelLength / 2, 0, 0]}>
                <boxGeometry args={[channelLength, params.srWidthY, params.srDepthZ]} />
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

    const rightPrepared = right.clone();
    rightPrepared.translate(...shift);

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
  onSelectAccessory,
}: {
  step: Step;
  viewMode: ViewMode;
  plug: PlugData;
  accessories: PlacedAccessory[];
  activeAccessoryId: string | null;
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
        color: "#c9c2b4",
        metalness: 0.15,
        roughness: 0.55,
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
      new THREE.MeshStandardMaterial({
        color: "#c9c2b4",
        metalness: 0.15,
        roughness: 0.55,
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
}: {
  visible: boolean;
  sizeHint: THREE.Vector3;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, delta) => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.MeshStandardMaterial;
    const target = visible ? 0.55 : 0;
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, target, delta * 3);
    ref.current.visible = mat.opacity > 0.01;
  });
  const w = sizeHint.x * 1.1;
  const h = sizeHint.y * 1.4;
  const d = sizeHint.z * 2.2;
  return (
    <mesh ref={ref} position={[0, 0, 0]}>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color="#c7a57b" transparent opacity={0} roughness={0.95} metalness={0} />
    </mesh>
  );
}

function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
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
  const { step, viewMode, assets, alignedGunUrl, featurePoints, activeFeatureIndex, onTagFeature, params } = props;

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
            fp.coords && (
              <mesh key={fp.name} position={fp.coords}>
                <sphereGeometry args={[2, 16, 16]} />
                <meshBasicMaterial color={fp.color} />
              </mesh>
            )
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
      <color attach="background" args={["#0f1012"]} />

      {isFlat ? (
        <OrthographicCamera makeDefault position={[0, 400, 0]} zoom={2.5} near={1} far={2000} />
      ) : (
        <PerspectiveCamera makeDefault position={[140, 120, 220]} fov={35} near={1} far={2000} />
      )}

      <CameraController isFlat={isFlat} />
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[120, 200, 120]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <directionalLight position={[-100, 60, -80]} intensity={0.35} />

      <Suspense fallback={null}>
        <LoadedScene {...props} />
      </Suspense>

      <gridHelper args={[400, 20, "#333", "#222"]} position={[0, -40, 0]} />

      {isFlat ? (
        <MapControls target={[0, 0, 0]} enableRotate={false} screenSpacePanning={true} />
      ) : (
        <OrbitControls target={[0, 0, 0]} minDistance={100} maxDistance={800} />
      )}
    </Canvas>
  );
}
