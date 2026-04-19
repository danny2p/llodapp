"use client";

import { useCallback, useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import type { SceneAssets, TgAnchor } from "@/components/Scene";
import {
  Upload,
  Crosshair,
  Cpu,
  Scissors,
  Download,
  RotateCcw,
  RefreshCw,
  Zap,
  FileUp,
  AlertTriangle,
  Target,
  PackageOpen,
  Layers,
  LayoutGrid,
  Square,
  X,
  Plus,
  GripVertical,
  MoveHorizontal,
  MoveVertical,
  MoveDiagonal,
  RotateCw,
  Sparkles,
  Radio,
} from "lucide-react";
import {
  Panel,
  Group,
  Slider,
  Toggle,
  Select,
  Button,
  LED,
  Pill,
  TerminalLine,
  LiveClock,
  ScanReticle,
  TypingLines,
} from "@/components/hud";

const Scene = dynamic(() => import("@/components/Scene").then((m) => m.Scene), {
  ssr: false,
});

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

type ProcessResponse = SceneAssets & {
  jobId: string;
  tgAnchor: TgAnchor | null;
};

type Params = {
  voxelPitch: number;
  smoothSigma: number;
  smoothIter: number;
  plugDecimTarget: number;
  gunDecimTarget: number;
  mirror: boolean;
  rotateZDeg: number;
  retention: boolean;
  retentionFrontOffset: number;
  retentionLength: number;
  retentionWidthY: number;
  retentionDepthZ: number;
  retentionYOffset: number;
  retentionRotateDeg: number;
  retentionCornerRadius: number;
  retentionOneSide: boolean;
  srEnabled: boolean;
  srWidthY: number;
  srDepthZ: number;
  srYOffset: number;
  srChamfer: number;
};

const DEFAULT_PARAMS: Params = {
  voxelPitch: 0.25,
  smoothSigma: 0.8,
  smoothIter: 10,
  plugDecimTarget: 60000,
  gunDecimTarget: 60000,
  mirror: false,
  rotateZDeg: 0,
  retention: true,
  retentionFrontOffset: 4,
  retentionLength: 16,
  retentionWidthY: 14,
  retentionDepthZ: 4,
  retentionYOffset: 0,
  retentionRotateDeg: 0,
  retentionCornerRadius: 2.0,
  retentionOneSide: false,
  srEnabled: true,
  srWidthY: 12,
  srDepthZ: 6,
  srYOffset: 0,
  srChamfer: 2.0,
};

const CAMEL_TO_SNAKE = (s: string) =>
  s.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());

export type ViewMode = "unified" | "left" | "right";

export type PlacedAccessory = {
  id: string;
  name: string;
  side: "left" | "right";
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

export type Step = 1 | 1.5 | 2 | 3;

const STEP_META: Record<
  number,
  { id: string; title: string; subtitle: string; icon: React.ReactNode }
> = {
  1: {
    id: "01",
    title: "UPLOAD",
    subtitle: "Ingest 3D Scan",
    icon: <Upload size={14} />,
  },
  1.5: {
    id: "02",
    title: "ALIGN",
    subtitle: "Tag feature anchors",
    icon: <Crosshair size={14} />,
  },
  2: {
    id: "03",
    title: "PROCESS",
    subtitle: "Sweep + voxelize",
    icon: <Cpu size={14} />,
  },
  3: {
    id: "04",
    title: "EXPORT",
    subtitle: "Split + export halves",
    icon: <Scissors size={14} />,
  },
};

const STEP_ORDER: Step[] = [1, 1.5, 2, 3];

export type FeaturePoint = {
  name: string;
  label: string;
  color: string;
  coords: [number, number, number] | null;
};

const INITIAL_FEATURES: FeaturePoint[] = [
  { name: "tg_front", label: "TRIGGER GUARD", color: "#FBBF24", coords: null },
  { name: "slide_release", label: "SLIDE RELEASE", color: "#22D3EE", coords: null },
  { name: "ejection_port", label: "EJECTION PORT", color: "#F87171", coords: null },
];

export default function Page() {
  const [step, setStep] = useState<Step>(1);
  const [viewMode, setViewMode] = useState<ViewMode>("unified");
  const [accessories, setAccessories] = useState<string[]>([]);
  const [featurePoints, setFeaturePoints] =
    useState<FeaturePoint[]>(INITIAL_FEATURES);
  const [activeFeatureIndex, setActiveFeatureIndex] = useState<number | null>(
    null
  );
  const [alignedGunUrl, setAlignedGunUrl] = useState<string | null>(null);
  const [placedAccessories, setPlacedAccessories] = useState<PlacedAccessory[]>(
    []
  );
  const [activeAccessoryId, setActiveAccessoryId] = useState<string | null>(
    null
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [assets, setAssets] = useState<SceneAssets | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [generatedParams, setGeneratedParams] = useState<Params | null>(null);
  const [generatedFileName, setGeneratedFileName] = useState<string | null>(
    null
  );

  useEffect(() => {
    fetch(`${API_BASE}/api/accessories`)
      .then((res) => {
        if (!res.ok) throw new Error("failed to fetch accessories list");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setAccessories(data);
      })
      .catch((err) => console.error(err));
  }, []);

  const updateParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    setParams((p) => ({ ...p, [key]: value }));
  };

  const addAccessory = (name: string) => {
    if (viewMode === "unified") return;
    const id = Math.random().toString(36).slice(2, 9);
    setPlacedAccessories((prev) => [
      ...prev,
      {
        id,
        name,
        side: viewMode,
        position: [0, 5, 0],
        rotation: [0, 0, 0],
        scale: 1,
      },
    ]);
    setActiveAccessoryId(id);
  };

  const updateAccessory = (id: string, updates: Partial<PlacedAccessory>) => {
    setPlacedAccessories((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates } : a))
    );
  };

  const removeAccessory = (id: string) => {
    setPlacedAccessories((prev) => prev.filter((a) => a.id !== id));
    if (activeAccessoryId === id) setActiveAccessoryId(null);
  };

  const absolutize = (urls: ProcessResponse): SceneAssets => ({
    gunUrl: API_BASE + urls.gunUrl,
    fullUrl: API_BASE + urls.fullUrl,
    leftUrl: API_BASE + urls.leftUrl,
    rightUrl: API_BASE + urls.rightUrl,
  });

  const onTagFeature = (index: number, coords: [number, number, number]) => {
    setFeaturePoints((prev) =>
      prev.map((fp, i) => (i === index ? { ...fp, coords } : fp))
    );
    const nextEmpty = featurePoints.findIndex(
      (fp, i) => i > index && fp.coords === null
    );
    if (nextEmpty !== -1) {
      setActiveFeatureIndex(nextEmpty);
    }
  };

  const processFile = useCallback(
    async (file: File, withParams: Params) => {
      setError(null);
      setIsProcessing(true);
      setAssets(null);
      setStep(1);
      try {
        const form = new FormData();
        form.append("file", file);
        for (const [k, v] of Object.entries(withParams)) {
          form.append(CAMEL_TO_SNAKE(k), String(v));
        }
        const res = await fetch(`${API_BASE}/api/align`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          let errorMsg = `${res.status}`;
          try {
            const body = await res.json();
            if (body.detail && typeof body.detail === "object") {
              errorMsg +=
                ": " + (body.detail.stderr || JSON.stringify(body.detail));
            } else {
              errorMsg += ": " + (body.detail || JSON.stringify(body));
            }
          } catch {
            const text = await res.text();
            errorMsg += ": " + text.slice(0, 400);
          }
          throw new Error(errorMsg);
        }

        const data = await res.json();
        setAlignedGunUrl(API_BASE + data.alignedUrl);
        setStep(1.5);
        setActiveFeatureIndex(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

  const generateMold = useCallback(async () => {
    if (!uploadedFile) return;
    setError(null);
    setIsProcessing(true);
    setStep(2);
    try {
      const form = new FormData();
      form.append("file", uploadedFile);
      for (const [k, v] of Object.entries(params)) {
        form.append(CAMEL_TO_SNAKE(k), String(v));
      }
      form.append("feature_points", JSON.stringify(featurePoints));

      const res = await fetch(`${API_BASE}/api/process`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        let errorMsg = `${res.status}`;
        try {
          const body = await res.json();
          if (body.detail && typeof body.detail === "object") {
            errorMsg +=
              ": " + (body.detail.stderr || JSON.stringify(body.detail));
          } else {
            errorMsg += ": " + (body.detail || JSON.stringify(body));
          }
        } catch {
          const text = await res.text();
          errorMsg += ": " + text.slice(0, 400);
        }
        throw new Error(errorMsg);
      }
      const data = (await res.json()) as ProcessResponse;
      setJobId(data.jobId);
      setAssets(absolutize(data));
      setGeneratedParams(params);
      setGeneratedFileName(uploadedFile.name);
      window.setTimeout(() => setStep(3), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep(1.5);
    } finally {
      setIsProcessing(false);
    }
  }, [uploadedFile, params, featurePoints]);

  const downloadHalf = async (side: "left" | "right") => {
    if (!jobId || !assets) return;
    const sideAccessories = placedAccessories.filter((a) => a.side === side);

    if (sideAccessories.length === 0) {
      const url = side === "left" ? assets.leftUrl : assets.rightUrl;
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stem}-${side}.stl`;
      a.click();
      return;
    }

    setIsProcessing(true);
    try {
      const form = new FormData();
      form.append("job_id", jobId);
      form.append("side", side);
      form.append("accessories", JSON.stringify(sideAccessories));

      const res = await fetch(`${API_BASE}/api/download-merged`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Merge failed: ${body}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stem}-${side}-merged.stl`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (!f) return;
      setFileName(f.name);
      setUploadedFile(f);
      void processFile(f, params);
    },
    [params, processFile]
  );

  const rerun = useCallback(() => {
    if (!uploadedFile) return;
    const alignmentChanged =
      !generatedParams ||
      params.mirror !== generatedParams.mirror ||
      params.rotateZDeg !== generatedParams.rotateZDeg;

    if (alignmentChanged) {
      void processFile(uploadedFile, params);
    } else {
      void generateMold();
    }
  }, [uploadedFile, params, generatedParams, processFile, generateMold]);

  const reset = () => {
    setStep(1);
    setFileName(null);
    setUploadedFile(null);
    setAssets(null);
    setJobId(null);
    setAlignedGunUrl(null);
    setActiveFeatureIndex(null);
    setFeaturePoints(INITIAL_FEATURES.map((f) => ({ ...f, coords: null })));
    setPlacedAccessories([]);
    setError(null);
    setIsProcessing(false);
    setGeneratedParams(null);
    setGeneratedFileName(null);
  };

  const stem = fileName ? fileName.replace(/\.stl$/i, "") : "mold";

  const systemState: "on" | "warn" | "err" = error
    ? "err"
    : isProcessing
    ? "warn"
    : "on";

  const jobIdDisplay = jobId ? jobId.slice(0, 8).toUpperCase() : "—";

  return (
    <div className="h-screen flex flex-col overflow-hidden font-mono text-[var(--hud-text)]">
      {/* ─── TOP BAR ──────────────────────────────────────── */}
      <TopBar
        step={step}
        systemState={systemState}
        fileName={fileName}
        jobId={jobIdDisplay}
        onReset={reset}
        hasJob={!!jobId}
      />

      {/* ─── MAIN GRID ────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">
        {/* ─── LEFT RAIL ────────────────────────────────── */}
        <aside className="w-[360px] shrink-0 border-r border-[var(--hud-line)] bg-[var(--hud-panel)]/60 hud-grid overflow-y-auto hud-scroll animate-hud-slide-left">
          <div className="p-3 flex flex-col gap-3">
            {/* STEP CONTEXT */}
            <StepContext
              step={step}
              featurePoints={featurePoints}
              activeFeatureIndex={activeFeatureIndex}
              setActiveFeatureIndex={setActiveFeatureIndex}
              isProcessing={isProcessing}
              uploadedFile={uploadedFile}
              fileName={fileName}
              handleUpload={handleUpload}
              generateMold={generateMold}
              assets={assets}
              viewMode={viewMode}
              setViewMode={setViewMode}
              accessories={accessories}
              placedAccessories={placedAccessories}
              activeAccessoryId={activeAccessoryId}
              setActiveAccessoryId={setActiveAccessoryId}
              addAccessory={addAccessory}
              updateAccessory={updateAccessory}
              removeAccessory={removeAccessory}
              downloadHalf={downloadHalf}
              stem={stem}
              reset={reset}
            />

            {/* PARAMETERS */}
            <Panel title="Fabrication Parameters" id="§ FAB.PARAMS">
              <ParamPanel
                params={params}
                update={updateParam}
                disabled={isProcessing}
                canRerun={!!uploadedFile}
                onRerun={rerun}
              />
            </Panel>

            {/* ERROR PANEL */}
            {error && (
              <section className="hud-panel border-[rgba(239,68,68,0.45)]">
                <div className="p-3 flex items-start gap-2">
                  <AlertTriangle
                    size={14}
                    className="text-[var(--hud-red)] shrink-0 mt-0.5"
                  />
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-display text-[11px] uppercase tracking-wider text-[var(--hud-red)]">
                      System Fault
                    </span>
                    <pre className="text-[10px] text-[var(--hud-text-dim)] whitespace-pre-wrap break-words font-mono">
                      {error}
                    </pre>
                  </div>
                </div>
              </section>
            )}
          </div>
        </aside>

        {/* ─── VIEWPORT ─────────────────────────────────── */}
        <main className="flex-1 relative min-w-0 animate-hud-fade-up">
          <Scene
            step={step}
            viewMode={viewMode}
            assets={assets}
            alignedGunUrl={alignedGunUrl}
            featurePoints={featurePoints}
            activeFeatureIndex={activeFeatureIndex}
            onTagFeature={onTagFeature}
            placedAccessories={placedAccessories}
            activeAccessoryId={activeAccessoryId}
            onUpdateAccessory={updateAccessory}
            onSetActiveAccessory={setActiveAccessoryId}
            params={params}
          />

          {/* HUD overlay chrome */}
          <ViewportHUD
            step={step}
            viewMode={viewMode}
            isProcessing={isProcessing}
            featurePoints={featurePoints}
            activeFeatureIndex={activeFeatureIndex}
            generatedParams={generatedParams}
            generatedFileName={generatedFileName}
            jobId={jobIdDisplay}
          />
        </main>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// TOP BAR
// ──────────────────────────────────────────────────────────────────

function TopBar({
  step,
  systemState,
  fileName,
  jobId,
  onReset,
  hasJob,
}: {
  step: Step;
  systemState: "on" | "warn" | "err";
  fileName: string | null;
  jobId: string;
  onReset: () => void;
  hasJob: boolean;
}) {
  const sysLabel =
    systemState === "err" ? "FAULT" : systemState === "warn" ? "BUSY" : "NOMINAL";

  return (
    <header className="relative border-b border-[var(--hud-line)] bg-[var(--hud-void)]/80 backdrop-blur-md h-12 flex items-center px-4 shrink-0 z-10">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <Logo />
        <div className="flex flex-col leading-tight">
          <span className="font-display text-[14px] font-bold tracking-[0.2em] text-[var(--hud-teal-bright)] hud-glow-teal">
            HOLSTER WORKSHOP
          </span>
          <span className="font-mono text-[9px] tracking-[0.25em] text-[var(--hud-text-faint)]">
            LLOD · MOLD.SYS v0.4
          </span>
        </div>
      </div>

      <div className="h-6 w-px bg-[var(--hud-line-strong)] mx-5" />

      {/* Step rail */}
      <StepRail step={step} />

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-4">
        {fileName && (
          <div className="flex items-center gap-2 text-[10px] font-mono">
            <span className="text-[var(--hud-text-faint)]">FILE</span>
            <span className="text-[var(--hud-teal-bright)] max-w-[220px] truncate">
              {fileName}
            </span>
          </div>
        )}
        <LiveClock />
        {hasJob && (
          <button
            onClick={onReset}
            className="ml-1 p-1.5 border border-[var(--hud-line-strong)] hover:border-[var(--hud-amber)] hover:text-[var(--hud-amber-bright)] text-[var(--hud-text-dim)] transition-colors"
            title="Reset session"
          >
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div className="relative w-7 h-7 flex items-center justify-center">
      <svg viewBox="0 0 28 28" className="w-7 h-7">
        <polygon
          points="14,2 26,9 26,19 14,26 2,19 2,9"
          fill="none"
          stroke="var(--hud-teal-bright)"
          strokeWidth="1.2"
        />
        <polygon
          points="14,7 21,11 21,17 14,21 7,17 7,11"
          fill="rgba(45, 212, 191, 0.15)"
          stroke="var(--hud-teal)"
          strokeWidth="0.8"
        />
        <circle
          cx="14"
          cy="14"
          r="2"
          fill="var(--hud-teal-bright)"
        />
      </svg>
    </div>
  );
}

function StepRail({ step }: { step: Step }) {
  return (
    <nav className="flex items-center gap-0">
      {STEP_ORDER.map((s, i) => {
        const meta = STEP_META[s];
        const active = s === step;
        const done = s < step;
        return (
          <div key={s} className="flex items-center">
            <div
              className={`relative flex items-center gap-2 px-3 py-1 border ${
                active
                  ? "border-[var(--hud-teal-bright)] text-[var(--hud-teal-bright)] bg-[rgba(45,212,191,0.14)] shadow-[0_0_12px_rgba(45,212,191,0.25)]"
                  : done
                  ? "border-[var(--hud-teal)]/60 text-[var(--hud-teal)]"
                  : "border-[var(--hud-text-ghost)] text-[var(--hud-text-faint)]"
              }`}
              style={{
                clipPath:
                  "polygon(6px 0, 100% 0, calc(100% - 6px) 100%, 0 100%)",
              }}
            >
              <span className="font-mono text-[9px] tabular-nums opacity-70">
                {meta.id}
              </span>
              <span className="shrink-0">{meta.icon}</span>
              <span className="font-display text-[10px] uppercase tracking-[0.16em] font-medium">
                {meta.title}
              </span>
              {active && (
                <span className="absolute -top-[1px] left-[6px] right-[6px] h-[1px] bg-[var(--hud-teal-bright)] shadow-[0_0_6px_rgba(94,234,212,0.9)]" />
              )}
            </div>
            {i < STEP_ORDER.length - 1 && (
              <div
                className={`w-4 h-px ${
                  done
                    ? "bg-[var(--hud-teal)]"
                    : "bg-[var(--hud-text-ghost)]"
                }`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}

// ──────────────────────────────────────────────────────────────────
// STEP CONTEXT (LEFT RAIL SWITCH)
// ──────────────────────────────────────────────────────────────────

function StepContext(props: {
  step: Step;
  featurePoints: FeaturePoint[];
  activeFeatureIndex: number | null;
  setActiveFeatureIndex: (i: number | null) => void;
  isProcessing: boolean;
  uploadedFile: File | null;
  fileName: string | null;
  handleUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  generateMold: () => void;
  assets: SceneAssets | null;
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  accessories: string[];
  placedAccessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  setActiveAccessoryId: (id: string | null) => void;
  addAccessory: (name: string) => void;
  updateAccessory: (id: string, updates: Partial<PlacedAccessory>) => void;
  removeAccessory: (id: string) => void;
  downloadHalf: (side: "left" | "right") => void;
  stem: string;
  reset: () => void;
}) {
  const {
    step,
    featurePoints,
    activeFeatureIndex,
    setActiveFeatureIndex,
    isProcessing,
    uploadedFile,
    fileName,
    handleUpload,
    generateMold,
    assets,
    viewMode,
    setViewMode,
    accessories,
    placedAccessories,
    activeAccessoryId,
    setActiveAccessoryId,
    addAccessory,
    updateAccessory,
    removeAccessory,
    downloadHalf,
    stem,
    reset,
  } = props;

  const meta = STEP_META[step];
  const tone: "default" | "accent" | "warn" =
    step === 2 ? "warn" : "accent";

  return (
    <Panel
      title={meta.title}
      subtitle={meta.subtitle}
      id={`// STEP.${meta.id}`}
      tone={tone}
      right={
        isProcessing ? (
          <Pill tone="warn" className="animate-pulse">
            <Radio size={9} className="animate-hud-blink" />
            PROCESSING
          </Pill>
        ) : step === 3 ? (
          <Pill tone="accent">READY</Pill>
        ) : (
          <Pill tone="dim">STANDBY</Pill>
        )
      }
    >
      {step === 1 && !uploadedFile && !isProcessing && (
        <UploadDropzone handleUpload={handleUpload} />
      )}

      {step === 1 && isProcessing && (
        <ProcessingIndicator
          label={`Aligning 3D Scan`}
          fileName={fileName}
        />
      )}

      {step === 1.5 && (
        <FeatureTagger
          featurePoints={featurePoints}
          activeFeatureIndex={activeFeatureIndex}
          setActiveFeatureIndex={setActiveFeatureIndex}
          onGenerate={generateMold}
        />
      )}

      {step === 2 && <ProcessingStatus fileName={fileName} />}

      {step === 3 && assets && (
        <ExportPanel
          viewMode={viewMode}
          setViewMode={setViewMode}
          assets={assets}
          accessories={accessories}
          placedAccessories={placedAccessories}
          activeAccessoryId={activeAccessoryId}
          setActiveAccessoryId={setActiveAccessoryId}
          addAccessory={addAccessory}
          updateAccessory={updateAccessory}
          removeAccessory={removeAccessory}
          downloadHalf={downloadHalf}
          stem={stem}
          reset={reset}
        />
      )}
    </Panel>
  );
}

// ──────────────────────────────────────────────────────────────────
// STEP 1 — UPLOAD DROPZONE
// ──────────────────────────────────────────────────────────────────

function UploadDropzone({
  handleUpload,
}: {
  handleUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="group/drop relative cursor-pointer block">
        <input
          type="file"
          accept=".stl,model/stl,application/octet-stream"
          onChange={handleUpload}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
        <div className="hud-grid-fine border border-dashed border-[var(--hud-line-strong)] group-hover/drop:border-[var(--hud-teal-bright)] group-hover/drop:bg-[rgba(45,212,191,0.04)] transition-all p-6 flex flex-col items-center text-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-[var(--hud-teal)]/20 blur-md group-hover/drop:bg-[var(--hud-teal-bright)]/40 transition-colors" />
            <FileUp
              size={28}
              className="relative text-[var(--hud-teal-bright)]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-display text-[12px] uppercase tracking-[0.16em] text-[var(--hud-teal-bright)]">
              Drop 3D Scan
            </span>
            <span className="font-mono text-[10px] text-[var(--hud-text-faint)]">
              .stl · drag here or click to browse
            </span>
          </div>
        </div>
      </label>

      <div className="flex flex-col gap-1 text-[10px] font-mono text-[var(--hud-text-faint)]">
        <div className="flex justify-between">
          <span>AVG.PROCESS</span>
          <span className="text-[var(--hud-text-dim)]">15–30s</span>
        </div>
        <div className="flex justify-between">
          <span>PIPELINE</span>
          <span className="text-[var(--hud-text-dim)]">VOX → SWEEP → MC</span>
        </div>
        <div className="flex justify-between">
          <span>ALIGN</span>
          <span className="text-[var(--hud-text-dim)]">RANSAC + MABR</span>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// STEP 1.5 — FEATURE TAGGER
// ──────────────────────────────────────────────────────────────────

function FeatureTagger({
  featurePoints,
  activeFeatureIndex,
  setActiveFeatureIndex,
  onGenerate,
}: {
  featurePoints: FeaturePoint[];
  activeFeatureIndex: number | null;
  setActiveFeatureIndex: (i: number | null) => void;
  onGenerate: () => void;
}) {
  const allSet = featurePoints.every((fp) => fp.coords !== null);
  const progress = featurePoints.filter((fp) => fp.coords !== null).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-[var(--hud-text-dim)]">
          ALIGNMENT PROGRESS
        </span>
        <span className="text-[var(--hud-teal-bright)] tabular-nums">
          {progress}/{featurePoints.length}
        </span>
      </div>
      <div className="flex gap-1">
        {featurePoints.map((fp, i) => (
          <div
            key={fp.name}
            className={`flex-1 h-[3px] ${
              fp.coords
                ? "bg-[var(--hud-teal-bright)] shadow-[0_0_6px_rgba(94,234,212,0.6)]"
                : "bg-[var(--hud-text-ghost)]"
            }`}
          />
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        {featurePoints.map((fp, i) => (
          <FeatureButton
            key={fp.name}
            fp={fp}
            idx={i}
            active={activeFeatureIndex === i}
            onClick={() => setActiveFeatureIndex(i)}
          />
        ))}
      </div>

      <Button
        variant="primary"
        disabled={!allSet}
        onClick={onGenerate}
        icon={<Zap size={12} />}
      >
        Initiate Fabrication
      </Button>
    </div>
  );
}

function FeatureButton({
  fp,
  idx,
  active,
  onClick,
}: {
  fp: FeaturePoint;
  idx: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group/f relative text-left px-2.5 py-2 border transition-all ${
        active
          ? "border-[var(--hud-teal-bright)] bg-[rgba(45,212,191,0.08)] shadow-[inset_0_0_12px_rgba(45,212,191,0.06)]"
          : fp.coords
          ? "border-[var(--hud-line)] hover:border-[var(--hud-teal)] bg-[var(--hud-panel-2)]"
          : "border-[var(--hud-text-ghost)] hover:border-[var(--hud-line-strong)] bg-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <div className="relative flex items-center justify-center w-5 h-5">
          <div
            className="absolute inset-0 opacity-20"
            style={{ background: fp.color, filter: "blur(6px)" }}
          />
          <div
            className="relative w-2.5 h-2.5"
            style={{
              background: fp.coords ? fp.color : "transparent",
              border: `1px solid ${fp.color}`,
              boxShadow: fp.coords ? `0 0 6px ${fp.color}` : "none",
            }}
          />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[8.5px] text-[var(--hud-text-faint)]">
              T.{String(idx + 1).padStart(2, "0")}
            </span>
            <span className="font-display text-[11px] uppercase tracking-wider text-[var(--hud-text)] truncate">
              {fp.label}
            </span>
          </div>
          {fp.coords ? (
            <span className="font-mono text-[9.5px] text-[var(--hud-text-dim)] tabular-nums mt-0.5">
              X {fp.coords[0].toFixed(1)}
              <span className="text-[var(--hud-text-ghost)]">·</span>
              Y {fp.coords[1].toFixed(1)}
              <span className="text-[var(--hud-text-ghost)]">·</span>
              Z {fp.coords[2].toFixed(1)}
            </span>
          ) : (
            <span className="font-mono text-[9.5px] text-[var(--hud-text-faint)] italic mt-0.5">
              {active ? "AWAITING CLICK ON MODEL" : "UNSET"}
            </span>
          )}
        </div>
        {active && (
          <Crosshair
            size={14}
            className="text-[var(--hud-teal-bright)] animate-hud-blink shrink-0"
          />
        )}
      </div>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────────
// STEP 2 — PROCESSING STATUS
// ──────────────────────────────────────────────────────────────────

function ProcessingStatus({ fileName }: { fileName: string | null }) {
  const lines = useMemo(
    () => [
      `3d scan ingested :: ${fileName ?? "unknown.stl"}`,
      "voxelizing @ 0.25mm pitch...",
      "ransac slide detection :: locked",
      "mabr rotation :: aligned",
      "sweeping occupancy along +X axis...",
      "marching cubes :: extracting iso-surface",
      "taubin smoothing :: 10 iterations",
      "decimating to target face count...",
      "retention SDF :: carving indent",
      "slide release clearance :: channeling",
      "split plane :: z=0 earcut cap",
      "spooling halves to disk...",
    ],
    [fileName]
  );
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 p-3 border border-[var(--hud-line-strong)] bg-[var(--hud-panel-2)]">
        <ScanReticle size={32} />
        <div className="flex flex-col">
          <span className="font-display text-[11px] uppercase tracking-widest text-[var(--hud-amber-bright)] hud-glow-amber">
            Fabrication Active
          </span>
          <span className="font-mono text-[10px] text-[var(--hud-text-dim)]">
            Do not interrupt pipeline.
          </span>
        </div>
      </div>
      <div className="max-h-[220px] overflow-y-auto hud-scroll p-2 border border-[var(--hud-line)] bg-[var(--hud-void)]/60">
        <TypingLines lines={lines} speed={280} />
      </div>
    </div>
  );
}

function ProcessingIndicator({
  label,
  fileName,
}: {
  label: string;
  fileName: string | null;
}) {
  return (
    <div className="flex items-center gap-3 p-3 border border-[var(--hud-line-strong)] bg-[var(--hud-panel-2)]">
      <ScanReticle size={30} />
      <div className="flex flex-col">
        <span className="font-display text-[11px] uppercase tracking-widest text-[var(--hud-teal-bright)]">
          {label}
        </span>
        {fileName && (
          <span className="font-mono text-[10px] text-[var(--hud-text-dim)] truncate max-w-[240px]">
            {fileName}
          </span>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// STEP 3 — EXPORT PANEL
// ──────────────────────────────────────────────────────────────────

function ExportPanel({
  viewMode,
  setViewMode,
  accessories,
  placedAccessories,
  activeAccessoryId,
  setActiveAccessoryId,
  addAccessory,
  updateAccessory,
  removeAccessory,
  downloadHalf,
  stem,
  reset,
  assets,
}: {
  viewMode: ViewMode;
  setViewMode: (v: ViewMode) => void;
  assets: SceneAssets;
  accessories: string[];
  placedAccessories: PlacedAccessory[];
  activeAccessoryId: string | null;
  setActiveAccessoryId: (id: string | null) => void;
  addAccessory: (name: string) => void;
  updateAccessory: (id: string, updates: Partial<PlacedAccessory>) => void;
  removeAccessory: (id: string) => void;
  downloadHalf: (side: "left" | "right") => void;
  stem: string;
  reset: () => void;
}) {
  const sideAcc = placedAccessories.filter((a) => a.side === viewMode);
  const leftCount = placedAccessories.filter((a) => a.side === "left").length;
  const rightCount = placedAccessories.filter((a) => a.side === "right").length;

  return (
    <div className="flex flex-col gap-3">
      {/* View selector */}
      <div>
        <div className="text-[9px] font-mono text-[var(--hud-text-faint)] tracking-wider mb-1.5">
          // WORKBENCH.VIEW
        </div>
        <div className="grid grid-cols-3 gap-1 p-0.5 border border-[var(--hud-line-strong)] bg-[var(--hud-panel-3)]/40">
          {(
            [
              { v: "unified" as const, Icon: LayoutGrid, label: "UNI" },
              { v: "left" as const, Icon: Square, label: "L" },
              { v: "right" as const, Icon: Square, label: "R" },
            ] satisfies { v: ViewMode; Icon: typeof Square; label: string }[]
          ).map(({ v, Icon, label }) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={`flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-display uppercase tracking-wider transition-all ${
                viewMode === v
                  ? "bg-[var(--hud-teal)] text-[#001b18] shadow-[0_0_10px_rgba(45,212,191,0.4)]"
                  : "text-[var(--hud-text-dim)] hover:text-[var(--hud-teal-bright)] hover:bg-[rgba(45,212,191,0.08)]"
              }`}
            >
              <Icon size={11} />
              {label}
              {v === "left" && leftCount > 0 && (
                <span
                  className={`text-[8px] tabular-nums ${
                    viewMode === v
                      ? "text-[#001b18]"
                      : "text-[var(--hud-amber-bright)]"
                  }`}
                >
                  +{leftCount}
                </span>
              )}
              {v === "right" && rightCount > 0 && (
                <span
                  className={`text-[8px] tabular-nums ${
                    viewMode === v
                      ? "text-[#001b18]"
                      : "text-[var(--hud-amber-bright)]"
                  }`}
                >
                  +{rightCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Accessories when on a specific half */}
      {viewMode !== "unified" && (
        <div className="flex flex-col gap-2.5 animate-hud-fade-up">
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-mono text-[var(--hud-text-faint)] tracking-wider">
              // ATTACH.LIBRARY · {viewMode.toUpperCase()}
            </div>
            <Pill tone="dim">
              <PackageOpen size={9} />
              {accessories.length} STL
            </Pill>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {accessories.map((acc) => (
              <button
                key={acc}
                onClick={() => addAccessory(acc)}
                className="flex flex-col items-center gap-1 p-2 border border-[var(--hud-line)] hover:border-[var(--hud-teal-bright)] hover:bg-[rgba(45,212,191,0.06)] transition-all group/acc"
              >
                <div className="w-8 h-8 border border-[var(--hud-line-strong)] group-hover/acc:border-[var(--hud-teal-bright)] flex items-center justify-center bg-[var(--hud-void)]">
                  <Plus
                    size={10}
                    className="text-[var(--hud-text-faint)] group-hover/acc:text-[var(--hud-teal-bright)]"
                  />
                </div>
                <span className="font-mono text-[8.5px] text-[var(--hud-text-dim)] truncate w-full text-center">
                  {acc.replace(/\.stl$/i, "")}
                </span>
              </button>
            ))}
          </div>

          {sideAcc.length > 0 && (
            <div className="flex flex-col gap-1.5 pt-2 border-t border-[var(--hud-line)]">
              <div className="text-[9px] font-mono text-[var(--hud-text-faint)] tracking-wider">
                // PLACED ({sideAcc.length})
              </div>
              {sideAcc.map((acc) => (
                <AccessoryCard
                  key={acc.id}
                  acc={acc}
                  active={activeAccessoryId === acc.id}
                  onSelect={() => setActiveAccessoryId(acc.id)}
                  onRemove={() => removeAccessory(acc.id)}
                  onUpdate={(u) => updateAccessory(acc.id, u)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Export actions */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-[var(--hud-line)]">
        <div className="text-[9px] font-mono text-[var(--hud-text-faint)] tracking-wider mb-1">
          // EXPORT.TARGETS
        </div>
        <a
          href={assets.fullUrl}
          download={`${stem}-mold.stl`}
          className="hud-btn inline-flex items-center justify-center gap-2"
        >
          <Download size={12} />
          Unified Mold · STL
        </a>
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            onClick={() => downloadHalf("left")}
            icon={<Download size={11} />}
          >
            Half L
            {leftCount > 0 && (
              <span className="text-[8.5px] text-[var(--hud-amber-bright)] ml-1">
                +{leftCount}
              </span>
            )}
          </Button>
          <Button
            onClick={() => downloadHalf("right")}
            icon={<Download size={11} />}
          >
            Half R
            {rightCount > 0 && (
              <span className="text-[8.5px] text-[var(--hud-amber-bright)] ml-1">
                +{rightCount}
              </span>
            )}
          </Button>
        </div>
        <button
          onClick={reset}
          className="text-[10px] font-mono uppercase tracking-wider text-[var(--hud-text-faint)] hover:text-[var(--hud-amber-bright)] mt-1 flex items-center justify-center gap-1.5 transition-colors py-1"
        >
          <RotateCcw size={10} />
          New Session · Clear State
        </button>
      </div>
    </div>
  );
}

function AccessoryCard({
  acc,
  active,
  onSelect,
  onRemove,
  onUpdate,
}: {
  acc: PlacedAccessory;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onUpdate: (u: Partial<PlacedAccessory>) => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`border transition-all cursor-pointer ${
        active
          ? "border-[var(--hud-teal-bright)] bg-[rgba(45,212,191,0.06)] shadow-[0_0_12px_rgba(45,212,191,0.15)]"
          : "border-[var(--hud-line)] bg-[var(--hud-panel-2)]"
      }`}
    >
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--hud-line)]">
        <div className="flex items-center gap-1.5 min-w-0">
          <GripVertical
            size={11}
            className="text-[var(--hud-text-faint)] shrink-0"
          />
          <span className="font-mono text-[10px] text-[var(--hud-teal-bright)] truncate">
            {acc.name.replace(/\.stl$/i, "")}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-[var(--hud-text-faint)] hover:text-[var(--hud-red)] p-1"
        >
          <X size={11} />
        </button>
      </div>
      {active && (
        <div className="p-2 flex flex-col gap-2 animate-hud-fade-up">
          <Slider
            label="POS X"
            code="⟵→"
            unit="mm"
            value={acc.position[0]}
            min={-150}
            max={150}
            step={0.5}
            onChange={(v) =>
              onUpdate({
                position: [v, acc.position[1], acc.position[2]],
              })
            }
          />
          <Slider
            label="POS Y"
            code="⟷"
            unit="mm"
            value={acc.position[1]}
            min={-100}
            max={100}
            step={0.5}
            onChange={(v) =>
              onUpdate({
                position: [acc.position[0], v, acc.position[2]],
              })
            }
          />
          <Slider
            label="STANDOFF Z"
            code="↑"
            unit="mm"
            value={Math.abs(acc.position[2])}
            min={-50}
            max={50}
            step={0.1}
            onChange={(v) =>
              onUpdate({
                position: [
                  acc.position[0],
                  acc.position[1],
                  acc.side === "left" ? -v : v,
                ],
              })
            }
          />
          <Slider
            label="ROTATE Z"
            code="↻"
            unit="deg"
            value={acc.rotation[2]}
            min={-180}
            max={180}
            step={1}
            onChange={(v) =>
              onUpdate({
                rotation: [acc.rotation[0], acc.rotation[1], v],
              })
            }
          />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// PARAMETER PANEL
// ──────────────────────────────────────────────────────────────────

function ParamPanel({
  params,
  update,
  disabled,
  canRerun,
  onRerun,
}: {
  params: Params;
  update: <K extends keyof Params>(key: K, value: Params[K]) => void;
  disabled: boolean;
  canRerun: boolean;
  onRerun: () => void;
}) {
  return (
    <div className="flex flex-col">
      {canRerun && (
        <div className="mb-2">
          <Button
            variant="primary"
            onClick={onRerun}
            disabled={disabled}
            icon={<RefreshCw size={11} className={disabled ? "animate-spin" : ""} />}
            className="w-full"
          >
            Recompile
          </Button>
        </div>
      )}

      <Group title="Detail" code="§ DETAIL" defaultOpen={true} tone="accent">
        <Slider
          label="VOXEL PITCH"
          code="δ"
          unit="mm"
          value={params.voxelPitch}
          min={0.2}
          max={0.5}
          step={0.05}
          hint="Lower = more surface detail, more compute."
          onChange={(v) => update("voxelPitch", v)}
          disabled={disabled}
        />
        <Slider
          label="SMOOTH σ"
          code="σ"
          unit="vox"
          value={params.smoothSigma}
          min={0}
          max={2}
          step={0.1}
          hint="Gaussian pre-marching-cubes smoothing."
          onChange={(v) => update("smoothSigma", v)}
          disabled={disabled}
        />
        <Slider
          label="SMOOTH ITER"
          code="n"
          unit="iter"
          value={params.smoothIter}
          min={0}
          max={50}
          step={1}
          hint="Post-MC Taubin (removes stair-stepping)."
          onChange={(v) => update("smoothIter", v)}
          disabled={disabled}
        />
        <Select
          label="PLUG FACES"
          code="Σf"
          value={params.plugDecimTarget}
          options={[8000, 15000, 30000, 60000, 120000]}
          onChange={(v) => update("plugDecimTarget", v)}
          disabled={disabled}
        />
      </Group>

      <Group title="Alignment" code="§ ALIGN" tone="accent">
        <Toggle
          label="MIRROR Z"
          code="⇌"
          checked={params.mirror}
          hint="Flip if slide release / ejection side is inverted."
          onChange={(v) => update("mirror", v)}
          disabled={disabled}
        />
        <Slider
          label="ROTATE Z"
          code="↻"
          unit="deg"
          value={params.rotateZDeg}
          min={-45}
          max={45}
          step={1}
          hint="Correction for MABR alignment errors."
          onChange={(v) => update("rotateZDeg", v)}
          disabled={disabled}
        />
      </Group>

      <Group title="Trigger Retention" code="§ RET.TRIG" tone="warn">
        <Toggle
          label="ENABLED"
          checked={params.retention}
          hint="Triangle indent behind TG front edge."
          onChange={(v) => update("retention", v)}
          disabled={disabled}
        />
        <Slider
          label="FRONT OFFSET"
          code="Δx"
          unit="mm"
          value={params.retentionFrontOffset}
          min={0}
          max={20}
          step={0.5}
          onChange={(v) => update("retentionFrontOffset", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="LENGTH"
          code="L"
          unit="mm"
          value={params.retentionLength}
          min={4}
          max={40}
          step={1}
          onChange={(v) => update("retentionLength", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="WIDTH Y"
          code="W"
          unit="mm"
          value={params.retentionWidthY}
          min={4}
          max={30}
          step={1}
          onChange={(v) => update("retentionWidthY", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="DEPTH Z"
          code="D"
          unit="mm"
          value={params.retentionDepthZ}
          min={0.5}
          max={10}
          step={0.1}
          onChange={(v) => update("retentionDepthZ", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="Y OFFSET"
          code="Δy"
          unit="mm"
          value={params.retentionYOffset}
          min={-15}
          max={15}
          step={0.5}
          onChange={(v) => update("retentionYOffset", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="ROTATE Z"
          code="θ"
          unit="deg"
          value={params.retentionRotateDeg}
          min={-90}
          max={90}
          step={1}
          onChange={(v) => update("retentionRotateDeg", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="RADIUS"
          code="r"
          unit="mm"
          value={params.retentionCornerRadius}
          min={0}
          max={10}
          step={0.5}
          hint="Round the triangle's sharp corners."
          onChange={(v) => update("retentionCornerRadius", v)}
          disabled={disabled || !params.retention}
        />
        <Toggle
          label="ONE SIDE"
          code="±"
          checked={params.retentionOneSide}
          hint="Default carves both sides of plug."
          onChange={(v) => update("retentionOneSide", v)}
          disabled={disabled || !params.retention}
        />
      </Group>

      <Group title="Slide Release Relief" code="§ REL.SR" tone="warn">
        <Toggle
          label="ENABLED"
          checked={params.srEnabled}
          hint="Clearance channel for slide release."
          onChange={(v) => update("srEnabled", v)}
          disabled={disabled}
        />
        <Slider
          label="WIDTH Y"
          code="W"
          unit="mm"
          value={params.srWidthY}
          min={4}
          max={30}
          step={1}
          onChange={(v) => update("srWidthY", v)}
          disabled={disabled || !params.srEnabled}
        />
        <Slider
          label="DEPTH Z"
          code="D"
          unit="mm"
          value={params.srDepthZ}
          min={2}
          max={15}
          step={0.5}
          onChange={(v) => update("srDepthZ", v)}
          disabled={disabled || !params.srEnabled}
        />
        <Slider
          label="Y OFFSET"
          code="Δy"
          unit="mm"
          value={params.srYOffset}
          min={-10}
          max={10}
          step={0.5}
          onChange={(v) => update("srYOffset", v)}
          disabled={disabled || !params.srEnabled}
        />
        <Slider
          label="CHAMFER"
          code="c"
          unit="mm"
          value={params.srChamfer}
          min={0}
          max={10}
          step={0.5}
          hint="45° cut on outer corners."
          onChange={(v) => update("srChamfer", v)}
          disabled={disabled || !params.srEnabled}
        />
      </Group>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// VIEWPORT HUD OVERLAY
// ──────────────────────────────────────────────────────────────────

function ViewportHUD({
  step,
  viewMode,
  isProcessing,
  featurePoints,
  activeFeatureIndex,
  generatedParams,
  generatedFileName,
  jobId,
}: {
  step: Step;
  viewMode: ViewMode;
  isProcessing: boolean;
  featurePoints: FeaturePoint[];
  activeFeatureIndex: number | null;
  generatedParams: Params | null;
  generatedFileName: string | null;
  jobId: string;
}) {
  const modeLabel =
    step === 1
      ? "AWAITING 3D SCAN"
      : step === 1.5
      ? activeFeatureIndex !== null
        ? `TAG :: ${featurePoints[activeFeatureIndex].label}`
        : "ALIGNMENT ACQUISITION"
      : step === 2
      ? "PROCESSING"
      : `EXPORT · ${viewMode.toUpperCase()}`;

  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      {/* Corner brackets */}
      <svg className="absolute inset-0 w-full h-full" aria-hidden>
        <defs>
          <linearGradient id="hud-corner" x1="0" x2="1">
            <stop offset="0%" stopColor="var(--hud-teal-bright)" />
            <stop offset="100%" stopColor="var(--hud-teal)" />
          </linearGradient>
        </defs>
        {/* TL */}
        <polyline
          points="16,40 16,16 40,16"
          stroke="url(#hud-corner)"
          strokeWidth="1"
          fill="none"
        />
        {/* TR */}
        <polyline
          points="calc(100% - 40) 16, calc(100% - 16) 16, calc(100% - 16) 40"
          stroke="url(#hud-corner)"
          strokeWidth="1"
          fill="none"
        />
      </svg>

      <div className="absolute top-3 left-3 flex items-center gap-2">
        <div className="w-2 h-2 bg-[var(--hud-teal-bright)] shadow-[0_0_6px_var(--hud-teal-bright)]" />
        <div className="w-2 h-2 bg-[var(--hud-teal-bright)] shadow-[0_0_6px_var(--hud-teal-bright)] opacity-60" />
        <div className="w-2 h-2 bg-[var(--hud-teal-bright)] shadow-[0_0_6px_var(--hud-teal-bright)] opacity-30" />
      </div>

      {/* Top-left mode readout */}
      <div className="absolute top-3 left-10 flex items-center gap-3 bg-[var(--hud-void)]/70 backdrop-blur-sm border border-[var(--hud-line-strong)] px-3 py-1.5 pointer-events-none">
        <div className="flex flex-col leading-none">
          <span className="text-[8.5px] font-mono text-[var(--hud-text-faint)] tracking-wider">
            // MODE
          </span>
          <span className="font-display text-[11px] uppercase tracking-[0.16em] text-[var(--hud-teal-bright)]">
            {modeLabel}
          </span>
        </div>
        {isProcessing && (
          <div className="relative">
            <span className="hud-led hud-led-warn" />
          </div>
        )}
      </div>

      {/* Top-right readout */}
      <div className="absolute top-3 right-3 flex flex-col items-end gap-2 pointer-events-none">
        <div className="bg-[var(--hud-void)]/70 backdrop-blur-sm border border-[var(--hud-line)] px-3 py-1.5 flex items-center gap-3">
          <div className="flex flex-col leading-none items-end">
            <span className="text-[8.5px] font-mono text-[var(--hud-text-faint)] tracking-wider">
              STEP
            </span>
            <span className="font-mono text-[11px] text-[var(--hud-teal-bright)] tabular-nums">
              {STEP_META[step].id}/04
            </span>
          </div>
        </div>
        {generatedParams && step === 3 && (
          <GeneratedInfo
            params={generatedParams}
            fileName={generatedFileName}
          />
        )}
      </div>

      {/* Center reticle — shown while tagging */}
      {step === 1.5 && activeFeatureIndex !== null && (
        <CenterReticle />
      )}

      {/* Bottom-left terminal echo */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-0.5 max-w-[46%] pointer-events-none">
        <TerminalLine tone="accent" stamp="[SYS]">
          {modeLabel.toLowerCase()}
        </TerminalLine>
        {step === 1.5 && (
          <TerminalLine tone="default" stamp="[TGT]">
            {featurePoints.filter((f) => f.coords).length}/
            {featurePoints.length} anchors locked
          </TerminalLine>
        )}
        {step === 3 && (
          <TerminalLine tone="success" stamp="[OK]">
            mold ready · halves separable along slide-thickness axis
          </TerminalLine>
        )}
      </div>

      {/* Bottom-right axis compass */}
      <AxisCompass />
    </div>
  );
}

function CenterReticle() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle
          cx="60"
          cy="60"
          r="40"
          fill="none"
          stroke="var(--hud-teal-bright)"
          strokeWidth="0.6"
          strokeDasharray="2 3"
          opacity="0.4"
        />
        <circle
          cx="60"
          cy="60"
          r="18"
          fill="none"
          stroke="var(--hud-teal-bright)"
          strokeWidth="0.8"
          opacity="0.55"
        />
        <line
          x1="60"
          y1="30"
          x2="60"
          y2="45"
          stroke="var(--hud-teal-bright)"
          strokeWidth="1"
        />
        <line
          x1="60"
          y1="75"
          x2="60"
          y2="90"
          stroke="var(--hud-teal-bright)"
          strokeWidth="1"
        />
        <line
          x1="30"
          y1="60"
          x2="45"
          y2="60"
          stroke="var(--hud-teal-bright)"
          strokeWidth="1"
        />
        <line
          x1="75"
          y1="60"
          x2="90"
          y2="60"
          stroke="var(--hud-teal-bright)"
          strokeWidth="1"
        />
        <circle cx="60" cy="60" r="1.2" fill="var(--hud-teal-bright)" />
      </svg>
    </div>
  );
}

function AxisCompass() {
  return (
    <div className="absolute bottom-3 right-3 pointer-events-none">
      <div className="bg-[var(--hud-void)]/70 backdrop-blur-sm border border-[var(--hud-line)] p-2 flex flex-col items-center gap-1">
        <svg width="60" height="60" viewBox="0 0 60 60">
          {/* grid background */}
          <rect
            x="5"
            y="5"
            width="50"
            height="50"
            fill="none"
            stroke="var(--hud-line)"
            strokeWidth="0.4"
            strokeDasharray="1 2"
          />
          {/* X (red-teal) */}
          <line
            x1="30"
            y1="30"
            x2="52"
            y2="30"
            stroke="var(--hud-red)"
            strokeWidth="1.5"
          />
          <text
            x="55"
            y="32"
            fill="var(--hud-red)"
            fontSize="7"
            fontFamily="var(--font-mono)"
          >
            X
          </text>
          {/* Y (amber) */}
          <line
            x1="30"
            y1="30"
            x2="30"
            y2="8"
            stroke="var(--hud-amber)"
            strokeWidth="1.5"
          />
          <text
            x="27"
            y="8"
            fill="var(--hud-amber)"
            fontSize="7"
            fontFamily="var(--font-mono)"
          >
            Y
          </text>
          {/* Z (teal) */}
          <line
            x1="30"
            y1="30"
            x2="14"
            y2="46"
            stroke="var(--hud-teal-bright)"
            strokeWidth="1.5"
          />
          <text
            x="4"
            y="50"
            fill="var(--hud-teal-bright)"
            fontSize="7"
            fontFamily="var(--font-mono)"
          >
            Z
          </text>
          <circle cx="30" cy="30" r="1.5" fill="#FFF" />
        </svg>
        <span className="font-mono text-[8px] tracking-wider text-[var(--hud-text-faint)]">
          WORLD.AXIS
        </span>
      </div>
    </div>
  );
}

function GeneratedInfo({
  params,
  fileName,
}: {
  params: Params;
  fileName: string | null;
}) {
  const rows: [string, string, "default" | "accent"][] = [
    ["VOXEL δ", `${params.voxelPitch}mm`, "default"],
    ["SMOOTH σ", `${params.smoothSigma}`, "default"],
    ["FACES", params.plugDecimTarget.toLocaleString(), "default"],
    ["MIRROR", params.mirror ? "ON" : "OFF", params.mirror ? "accent" : "default"],
    ["ROTATE Z", `${params.rotateZDeg}°`, "default"],
  ];
  const retRows: [string, string][] = params.retention
    ? [
        ["Δx", `${params.retentionFrontOffset}mm`],
        ["L", `${params.retentionLength}mm`],
        ["W", `${params.retentionWidthY}mm`],
        ["D", `${params.retentionDepthZ}mm`],
        ["θ", `${params.retentionRotateDeg}°`],
        ["r", `${params.retentionCornerRadius}mm`],
        ["SIDES", params.retentionOneSide ? "+Z" : "BOTH"],
      ]
    : [];
  return (
    <div className="bg-[var(--hud-void)]/75 backdrop-blur-sm border border-[var(--hud-line)] p-2.5 max-w-[260px] select-text pointer-events-auto">
      <div className="flex items-center gap-1.5 mb-1.5 pb-1.5 border-b border-[var(--hud-line)]">
        <Sparkles size={10} className="text-[var(--hud-teal-bright)]" />
        <span className="font-display text-[9.5px] uppercase tracking-[0.14em] text-[var(--hud-teal-bright)]">
          Build Spec
        </span>
      </div>
      {fileName && (
        <div className="text-[10px] font-mono text-[var(--hud-text)] truncate mb-1.5">
          {fileName}
        </div>
      )}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] font-mono">
        {rows.map(([k, v, t]) => (
          <div key={k} className="contents">
            <span className="text-[var(--hud-text-faint)]">{k}</span>
            <span
              className={`${
                t === "accent"
                  ? "text-[var(--hud-teal-bright)]"
                  : "text-[var(--hud-text-dim)]"
              } text-right tabular-nums`}
            >
              {v}
            </span>
          </div>
        ))}
      </div>
      {params.retention && (
        <>
          <div className="mt-2 pt-1.5 border-t border-[var(--hud-line)] flex items-center gap-1.5">
            <LED state="on" />
            <span className="font-display text-[9.5px] uppercase tracking-wider text-[var(--hud-amber-bright)]">
              Retention Active
            </span>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] font-mono mt-1">
            {retRows.map(([k, v]) => (
              <div key={k} className="contents">
                <span className="text-[var(--hud-text-faint)]">{k}</span>
                <span className="text-[var(--hud-text-dim)] text-right tabular-nums">
                  {v}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
