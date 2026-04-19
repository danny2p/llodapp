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
  Power,
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
  ColorPicker,
} from "@/components/hud";
import {
  FEATURES,
  FEATURES_BY_ID,
  publishedFeatures,
  initialFeatureStates,
  areAllFeaturesReady,
  featureProgress,
  type FeatureDef,
  type FeatureState,
  type FeatureStates,
  type FeatureParam,
  type NumberParam,
  type SelectParam,
  type ToggleParam,
  type FeatureValue,
  type GlobalParams,
} from "@/lib/features";
import type { Vec3 } from "@/lib/featuresFrame";

const Scene = dynamic(() => import("@/components/Scene").then((m) => m.Scene), {
  ssr: false,
});

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

type ProcessResponse = SceneAssets & {
  jobId: string;
  tgAnchor: TgAnchor | null;
};

const DEFAULT_GLOBAL_PARAMS: GlobalParams = {
  voxelPitch: 0.25,
  smoothSigma: 0.8,
  smoothIter: 10,
  plugDecimTarget: 60000,
  gunDecimTarget: 60000,
  mirror: false,
  rotateZDeg: 0,
  gunColor: "#6e7480",
  moldColor: "#00e6d6",
  totalLength: 160,
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

// Which feature point is the user actively tagging?
export type ActiveTag = { featureId: string; pointIndex: number } | null;

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

// ────────────────────────────────────────────────────────────────────
// PAGE
// ────────────────────────────────────────────────────────────────────

export default function Page() {
  const [step, setStep] = useState<Step>(1);
  const [viewMode, setViewMode] = useState<ViewMode>("unified");
  const [accessories, setAccessories] = useState<string[]>([]);
  const [samples, setSamples] = useState<string[]>([]);
  const [selectedSampleName, setSelectedSampleName] = useState<string | null>(
    null
  );
  const [featureStates, setFeatureStates] = useState<FeatureStates>(() =>
    initialFeatureStates()
  );
  const [activeTag, setActiveTag] = useState<ActiveTag>(null);
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
  const [globalParams, setGlobalParams] = useState<GlobalParams>(
    DEFAULT_GLOBAL_PARAMS
  );
  const [generatedGlobalParams, setGeneratedGlobalParams] =
    useState<GlobalParams | null>(null);
  const [generatedFeatureStates, setGeneratedFeatureStates] =
    useState<FeatureStates | null>(null);
  const [generatedFileName, setGeneratedFileName] = useState<string | null>(
    null
  );
  const [processingLogs, setProcessingLogs] = useState<string[]>([]);
  const [processingProgress, setProcessingProgress] = useState(0);

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

    fetch(`${API_BASE}/api/samples`)
      .then((res) => {
        if (!res.ok) throw new Error("failed to fetch samples list");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setSamples(data);
      })
      .catch((err) => console.error(err));
  }, []);

  const updateGlobalParam = <K extends keyof GlobalParams>(
    key: K,
    value: GlobalParams[K]
  ) => {
    setGlobalParams((p) => ({ ...p, [key]: value }));
  };

  const updateFeatureEnabled = useCallback(
    (featureId: string, enabled: boolean) => {
      setFeatureStates((prev) => ({
        ...prev,
        [featureId]: { ...prev[featureId], enabled },
      }));
    },
    []
  );

  const updateFeatureValue = useCallback(
    (featureId: string, paramId: string, value: FeatureValue) => {
      setFeatureStates((prev) => ({
        ...prev,
        [featureId]: {
          ...prev[featureId],
          values: { ...prev[featureId].values, [paramId]: value },
        },
      }));
    },
    []
  );

  const clearFeaturePoint = useCallback(
    (featureId: string, pointIndex: number) => {
      setFeatureStates((prev) => {
        const s = prev[featureId];
        const pts = [...s.points];
        pts[pointIndex] = null;
        return { ...prev, [featureId]: { ...s, points: pts } };
      });
      setActiveTag({ featureId, pointIndex });
    },
    []
  );

  const onTagPoint = useCallback(
    (featureId: string, pointIndex: number, coords: Vec3) => {
      setFeatureStates((prev) => {
        const s = prev[featureId];
        const pts = [...s.points];
        pts[pointIndex] = coords;
        const next = { ...prev, [featureId]: { ...s, points: pts } };
        setActiveTag(findNextUntaggedPoint(next, { featureId, pointIndex }));
        return next;
      });
    },
    []
  );

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

  const processFile = useCallback(
    async (
      file: File | null,
      withGlobals: GlobalParams,
      sampleName: string | null = null
    ) => {
      setError(null);
      setIsProcessing(true);
      setAssets(null);
      setProcessingLogs([]);
      setProcessingProgress(0);
      setStep(1);
      try {
        const form = new FormData();
        if (file) {
          form.append("file", file);
        } else if (sampleName) {
          form.append("sample_name", sampleName);
        }
        for (const [k, v] of Object.entries(withGlobals)) {
          form.append(CAMEL_TO_SNAKE(k), String(v));
        }
        const res = await fetch(`${API_BASE}/api/align-stream`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) throw new Error(await readErr(res));
        if (!res.body) throw new Error("ReadableStream not supported");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === "progress") {
                setProcessingLogs((prev) => [...prev, msg.data.l]);
                setProcessingProgress(msg.data.p);
              } else if (msg.type === "result") {
                setAlignedGunUrl(API_BASE + msg.data.alignedUrl);
                setStep(1.5);
                setActiveTag(findNextUntaggedPoint(featureStates, null));
              } else if (msg.type === "error") {
                throw new Error(
                  msg.detail.stderr || `Error ${msg.detail.code} in alignment`
                );
              }
            } catch (e) {
              console.error("Failed to parse progress line:", line, e);
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsProcessing(false);
      }
    },
    [featureStates]
  );

  const generateMold = useCallback(async () => {
    if (!uploadedFile && !selectedSampleName) return;
    setError(null);
    setIsProcessing(true);
    setProcessingLogs([]);
    setProcessingProgress(0);
    setStep(2);
    try {
      const form = new FormData();
      if (uploadedFile) {
        form.append("file", uploadedFile);
      } else if (selectedSampleName) {
        form.append("sample_name", selectedSampleName);
      }
      for (const [k, v] of Object.entries(globalParams)) {
        form.append(CAMEL_TO_SNAKE(k), String(v));
      }
      form.append("total_length", String(globalParams.totalLength));
      form.append("features_state", JSON.stringify(featureStates));

      const res = await fetch(`${API_BASE}/api/process-stream`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(await readErr(res));
      if (!res.body) throw new Error("ReadableStream not supported");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "progress") {
              setProcessingLogs((prev) => [...prev, msg.data.l]);
              setProcessingProgress(msg.data.p);
            } else if (msg.type === "result") {
              const data = msg.data as ProcessResponse;
              setJobId(data.jobId);
              setAssets(absolutize(data));
              setGeneratedGlobalParams(globalParams);
              setGeneratedFeatureStates(featureStates);
              setGeneratedFileName(uploadedFile.name);
              // Allow 3 seconds for the 'plunge and reveal' animation to complete 
              // before transitioning to the split-half view.
              window.setTimeout(() => setStep(3), 3000);
            } else if (msg.type === "error") {
              throw new Error(
                msg.detail.stderr || `Error ${msg.detail.code} in pipeline`
              );
            }
          } catch (e) {
            console.error("Failed to parse progress line:", line, e);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep(1.5);
    } finally {
      setIsProcessing(false);
    }
  }, [uploadedFile, globalParams, featureStates, absolutize]);

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
      void processFile(f, globalParams);
    },
    [globalParams, processFile]
  );

  const rerun = useCallback(() => {
    if (!uploadedFile) return;
    const alignmentChanged =
      !generatedGlobalParams ||
      globalParams.mirror !== generatedGlobalParams.mirror ||
      globalParams.rotateZDeg !== generatedGlobalParams.rotateZDeg;

    if (alignmentChanged) {
      void processFile(uploadedFile, globalParams);
    } else {
      void generateMold();
    }
  }, [
    uploadedFile,
    globalParams,
    generatedGlobalParams,
    processFile,
    generateMold,
  ]);

  const reset = () => {
    setStep(1);
    setFileName(null);
    setUploadedFile(null);
    setAssets(null);
    setJobId(null);
    setAlignedGunUrl(null);
    setActiveTag(null);
    setFeatureStates(initialFeatureStates());
    setPlacedAccessories([]);
    setError(null);
    setIsProcessing(false);
    setGeneratedGlobalParams(null);
    setGeneratedFeatureStates(null);
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
      <TopBar
        step={step}
        systemState={systemState}
        fileName={fileName}
        jobId={jobIdDisplay}
        onReset={reset}
        hasJob={!!jobId}
      />

      <div className="flex-1 flex min-h-0">
        <aside className="w-[360px] shrink-0 border-r border-[var(--hud-line)] bg-[var(--hud-panel)]/60 hud-grid overflow-y-auto hud-scroll animate-hud-slide-left">
          <div className="p-3 flex flex-col gap-3">
            <StepContext
              step={step}
              featureStates={featureStates}
              activeTag={activeTag}
              setActiveTag={setActiveTag}
              updateFeatureEnabled={updateFeatureEnabled}
              clearFeaturePoint={clearFeaturePoint}
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
              processingLogs={processingLogs}
              processingProgress={processingProgress}
              samples={samples}
              onSelectSample={(name) => processFile(null, globalParams, name)}
              />

            <Panel title="Processing Parameters" id="§ PROC.PARAMS">
              <ParamPanel
                globalParams={globalParams}
                updateGlobalParam={updateGlobalParam}
                featureStates={featureStates}
                updateFeatureEnabled={updateFeatureEnabled}
                updateFeatureValue={updateFeatureValue}
                disabled={isProcessing}
                canRerun={!!uploadedFile}
                onRerun={rerun}
              />
            </Panel>

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

        <main className="flex-1 relative min-w-0 animate-hud-fade-up">
          <Scene
            step={step}
            viewMode={viewMode}
            assets={assets}
            alignedGunUrl={alignedGunUrl}
            featureStates={featureStates}
            activeTag={activeTag}
            onTagPoint={onTagPoint}
            placedAccessories={placedAccessories}
            activeAccessoryId={activeAccessoryId}
            onUpdateAccessory={updateAccessory}
            onSetActiveAccessory={setActiveAccessoryId}
            globalParams={globalParams}
            progress={processingProgress}
          />

          <ViewportHUD
            step={step}
            viewMode={viewMode}
            isProcessing={isProcessing}
            featureStates={featureStates}
            activeTag={activeTag}
            generatedGlobalParams={generatedGlobalParams}
            generatedFeatureStates={generatedFeatureStates}
            generatedFileName={generatedFileName}
            jobId={jobIdDisplay}
          />
        </main>
      </div>
    </div>
  );
}

async function readErr(res: Response): Promise<string> {
  let msg = `${res.status}`;
  try {
    const body = await res.json();
    if (body.detail && typeof body.detail === "object") {
      msg += ": " + (body.detail.stderr || JSON.stringify(body.detail));
    } else {
      msg += ": " + (body.detail || JSON.stringify(body));
    }
  } catch {
    const text = await res.text();
    msg += ": " + text.slice(0, 400);
  }
  return msg;
}

// Find the next un-tagged point across published, enabled features, starting
// just after `after`. Returns null if everything required is tagged.
function findNextUntaggedPoint(
  states: FeatureStates,
  after: { featureId: string; pointIndex: number } | null
): ActiveTag {
  const defs = publishedFeatures();
  const startIdx = after
    ? Math.max(0, defs.findIndex((d) => d.id === after.featureId))
    : 0;
  // First pass: continue from `after` (or the beginning).
  for (let i = startIdx; i < defs.length; i++) {
    const def = defs[i];
    const st = states[def.id];
    if (!st?.enabled) continue;
    for (let p = 0; p < def.points.length; p++) {
      if (after && i === startIdx && p <= after.pointIndex) continue;
      if (st.points[p] === null) return { featureId: def.id, pointIndex: p };
    }
  }
  // Second pass: wrap back around to pick up earlier untagged slots.
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const st = states[def.id];
    if (!st?.enabled) continue;
    for (let p = 0; p < def.points.length; p++) {
      if (st.points[p] === null) return { featureId: def.id, pointIndex: p };
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// TOP BAR
// ────────────────────────────────────────────────────────────────────

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
  return (
    <header className="relative border-b border-[var(--hud-line)] bg-[var(--hud-void)]/80 backdrop-blur-md h-12 flex items-center px-4 shrink-0 z-10">
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

      <StepRail step={step} />

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

// ────────────────────────────────────────────────────────────────────
// STEP CONTEXT
// ────────────────────────────────────────────────────────────────────

function StepContext(props: {
  step: Step;
  featureStates: FeatureStates;
  activeTag: ActiveTag;
  setActiveTag: (t: ActiveTag) => void;
  updateFeatureEnabled: (featureId: string, enabled: boolean) => void;
  clearFeaturePoint: (featureId: string, pointIndex: number) => void;
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
  processingLogs: string[];
  processingProgress: number;
  samples: string[];
  onSelectSample: (name: string) => void;
}) {
  const {
    step,
    featureStates,
    activeTag,
    setActiveTag,
    updateFeatureEnabled,
    clearFeaturePoint,
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
    processingLogs,
    processingProgress,
    samples,
    onSelectSample,
  } = props;

  const meta = STEP_META[step];
  const tone: "default" | "accent" | "warn" = step === 2 ? "warn" : "accent";

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
        <UploadDropzone
          handleUpload={handleUpload}
          samples={samples}
          onSelectSample={onSelectSample}
        />
      )}

      {step === 1 && isProcessing && (
        <ProcessingStatus
          fileName={fileName}
          logs={processingLogs}
          progress={processingProgress}
          label="Alignment Active"
        />
      )}

      {step === 1.5 && (
        <FeatureTagger
          featureStates={featureStates}
          activeTag={activeTag}
          setActiveTag={setActiveTag}
          updateFeatureEnabled={updateFeatureEnabled}
          clearFeaturePoint={clearFeaturePoint}
          onGenerate={generateMold}
        />
      )}

      {step === 2 && (
        <ProcessingStatus
          fileName={fileName}
          logs={processingLogs}
          progress={processingProgress}
        />
      )}

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

// ────────────────────────────────────────────────────────────────────
// STEP 1 — UPLOAD DROPZONE
// ────────────────────────────────────────────────────────────────────

function UploadDropzone({
  handleUpload,
  samples,
  onSelectSample,
}: {
  handleUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  samples: string[];
  onSelectSample: (name: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
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

      {samples.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[9px] font-mono text-[var(--hud-text-faint)] tracking-widest uppercase px-1">
            // Use Sample Specimen
          </div>
          <div className="grid grid-cols-1 gap-1">
            {samples.map((name) => (
              <button
                key={name}
                onClick={() => onSelectSample(name)}
                className="hud-btn text-left justify-start gap-2"
              >
                <div className="w-1.5 h-1.5 bg-[var(--hud-teal-bright)]/40" />
                <span className="truncate">{name.replace(/\.stl$/i, "")}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 text-[10px] font-mono text-[var(--hud-text-faint)] mt-2">
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

// ────────────────────────────────────────────────────────────────────
// STEP 1.5 — FEATURE TAGGER
// ────────────────────────────────────────────────────────────────────

function FeatureTagger({
  featureStates,
  activeTag,
  setActiveTag,
  updateFeatureEnabled,
  clearFeaturePoint,
  onGenerate,
}: {
  featureStates: FeatureStates;
  activeTag: ActiveTag;
  setActiveTag: (t: ActiveTag) => void;
  updateFeatureEnabled: (featureId: string, enabled: boolean) => void;
  clearFeaturePoint: (featureId: string, pointIndex: number) => void;
  onGenerate: () => void;
}) {
  const defs = publishedFeatures();
  const { tagged, required } = defs.reduce(
    (acc, def) => {
      const s = featureStates[def.id];
      if (!s?.enabled) return acc;
      const { tagged, required } = featureProgress(def, s);
      return { tagged: acc.tagged + tagged, required: acc.required + required };
    },
    { tagged: 0, required: 0 }
  );
  const ready = areAllFeaturesReady(featureStates);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-[var(--hud-text-dim)]">ALIGNMENT PROGRESS</span>
        <span className="text-[var(--hud-teal-bright)] tabular-nums">
          {tagged}/{required}
        </span>
      </div>
      {required > 0 && (
        <div className="flex gap-1">
          {Array.from({ length: required }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-[3px] ${
                i < tagged
                  ? "bg-[var(--hud-teal-bright)] shadow-[0_0_6px_rgba(94,234,212,0.6)]"
                  : "bg-[var(--hud-text-ghost)]"
              }`}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {defs.map((def) => (
          <FeatureTagCard
            key={def.id}
            def={def}
            state={featureStates[def.id]}
            activeTag={activeTag}
            setActiveTag={setActiveTag}
            updateFeatureEnabled={updateFeatureEnabled}
            clearFeaturePoint={clearFeaturePoint}
          />
        ))}
      </div>

      <Button
        variant="primary"
        disabled={!ready}
        onClick={onGenerate}
        icon={<Zap size={12} />}
      >
        Create Split Molds
      </Button>
    </div>
  );
}

function FeatureTagCard({
  def,
  state,
  activeTag,
  setActiveTag,
  updateFeatureEnabled,
  clearFeaturePoint,
}: {
  def: FeatureDef;
  state: FeatureState;
  activeTag: ActiveTag;
  setActiveTag: (t: ActiveTag) => void;
  updateFeatureEnabled: (featureId: string, enabled: boolean) => void;
  clearFeaturePoint: (featureId: string, pointIndex: number) => void;
}) {
  const { complete } = featureProgress(def, state);

  // Support features with zero points (automatic features)
  const rows = def.points.length > 0 ? def.points : [null];

  return (
    <div
      className={`flex flex-col gap-1.5 transition-all ${
        !state.enabled ? "opacity-40 grayscale" : "opacity-100"
      }`}
    >
      {rows.map((slot, i) => {
        const active =
          activeTag?.featureId === def.id && activeTag.pointIndex === i;
        const coord = state.points[i];
        
        // Is this the 'primary' row for the feature? 
        const isPrimary = i === 0;

        return (
          <div
            key={slot?.id ?? "auto"}
            className={`group/tile relative border transition-all ${
              active
                ? "border-[var(--hud-teal-bright)] bg-[rgba(45,212,191,0.12)] shadow-[0_0_15px_rgba(45,212,191,0.1)]"
                : coord && state.enabled
                ? "border-[var(--hud-line-strong)] bg-[var(--hud-panel-2)]"
                : "border-[var(--hud-line)] bg-transparent hover:border-[var(--hud-line-strong)]"
            }`}
          >
            <div className="flex items-stretch h-11">
              {/* Power Toggle Section */}
              {isPrimary && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = !state.enabled;
                    updateFeatureEnabled(def.id, next);
                    if (!next && activeTag?.featureId === def.id) setActiveTag(null);
                  }}
                  className={`w-9 shrink-0 flex items-center justify-center border-r border-[var(--hud-line)] transition-colors ${
                    state.enabled
                      ? "text-[var(--hud-teal-bright)] bg-[rgba(45,212,191,0.05)]"
                      : "text-[var(--hud-text-ghost)] hover:text-[var(--hud-text-dim)]"
                  }`}
                  title={state.enabled ? "Disable Feature" : "Enable Feature"}
                >
                  <Power size={12} strokeWidth={state.enabled ? 3 : 2} />
                </button>
              )}

              {/* Main Interaction Area */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!state.enabled) updateFeatureEnabled(def.id, true);
                  // Only activate tagging if there are actual points to tag
                  if (def.points.length > 0) {
                    setActiveTag({ featureId: def.id, pointIndex: i });
                  }
                }}
                className={`flex-1 flex items-center gap-3 px-3 select-none ${
                  def.points.length > 0 ? "cursor-pointer" : "cursor-default"
                }`}
              >
                {/* Feature Status indicator */}
                <div className="relative w-2 h-2 shrink-0">
                  <div
                    className="absolute inset-0 opacity-40"
                    style={{ background: def.color, filter: "blur(3px)" }}
                  />
                  <div
                    className="relative w-2 h-2"
                    style={{
                      background: (coord && state.enabled) || (def.points.length === 0 && state.enabled) ? def.color : "transparent",
                      border: `1px solid ${def.color}`,
                      boxShadow: (coord && state.enabled) || (def.points.length === 0 && state.enabled) ? `0 0 5px ${def.color}` : "none",
                    }}
                  />
                </div>

                <div className="flex flex-col min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={`font-display text-[11px] uppercase tracking-[0.14em] transition-colors ${
                      active ? "text-[var(--hud-teal-bright)]" : "text-[var(--hud-text)]"
                    }`}>
                      {(isPrimary || !slot) ? def.label : slot.label}
                      {isPrimary && def.intent !== "marker" && (
                        <span className="ml-2 text-[8.5px] lowercase font-mono text-[var(--hud-text-faint)] tracking-normal normal-case">
                          ({def.intent})
                        </span>
                      )}
                    </span>
                    {!isPrimary && slot && (
                      <span className="font-mono text-[8.5px] text-[var(--hud-text-faint)]">
                        P.{String(i + 1).padStart(2, "0")}
                      </span>
                    )}
                  </div>
                  
                  {coord && state.enabled ? (
                    <span className="font-mono text-[9px] text-[var(--hud-text-dim)] tabular-nums mt-0.5">
                      X {coord[0].toFixed(1)} · Y {coord[1].toFixed(1)} · Z {coord[2].toFixed(1)}
                    </span>
                  ) : def.points.length === 0 && state.enabled ? (
                    <span className="font-mono text-[8.5px] text-[var(--hud-teal-bright)] uppercase tracking-wider mt-0.5">
                      Auto-Aligned
                    </span>
                  ) : (
                    <span className="font-mono text-[8.5px] text-[var(--hud-text-faint)] uppercase tracking-wider mt-0.5">
                      {active ? "Awaiting Capture..." : "Unlinked"}
                    </span>
                  )}
                </div>

                {active && (
                  <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-[var(--hud-teal-bright)] text-[var(--hud-void)] rounded-sm">
                    <Crosshair size={10} className="animate-hud-spin-slow" />
                    <span className="text-[8px] font-bold">READY</span>
                  </div>
                )}

                {coord && state.enabled && !active && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      clearFeaturePoint(def.id, i);
                    }}
                    className="p-1.5 text-[var(--hud-text-faint)] hover:text-[var(--hud-red)] transition-colors"
                    title="Clear point"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// STEP 2 — PROCESSING STATUS
// ────────────────────────────────────────────────────────────────────

function ProcessingStatus({
  fileName,
  logs,
  progress,
  label = "Processing Active",
}: {
  fileName: string | null;
  logs: string[];
  progress: number;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 p-3 border border-[var(--hud-line-strong)] bg-[var(--hud-panel-2)]">
        <ScanReticle size={32} />
        <div className="flex flex-col flex-1">
          <div className="flex items-center justify-between">
            <span className="font-display text-[11px] uppercase tracking-widest text-[var(--hud-amber-bright)] hud-glow-amber">
              {label}
            </span>
            <span className="font-mono text-[10px] text-[var(--hud-amber)] tabular-nums">
              {Math.round(progress * 100)}%
            </span>
          </div>
          <div className="h-1 bg-[var(--hud-line)] mt-2 relative overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-[var(--hud-amber)] transition-all duration-500 ease-out"
              style={{ width: `${progress * 100}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-[var(--hud-amber-bright)] hud-glow-amber animate-pulse"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <span className="font-mono text-[9px] text-[var(--hud-text-faint)] mt-1.5 uppercase tracking-wider">
            Do not leave or refresh page.
          </span>
        </div>
      </div>
      <div className="max-h-[220px] overflow-y-auto hud-scroll p-2 border border-[var(--hud-line)] bg-[var(--hud-void)]/60 flex flex-col gap-0.5">
        {logs.map((line, i) => (
          <TerminalLine key={i} tone="accent">
            {line}
          </TerminalLine>
        ))}
        <div className="animate-pulse h-3 w-1.5 bg-[var(--hud-teal-bright)] ml-1 mt-1" />
      </div>
    </div>
  );
}


// ────────────────────────────────────────────────────────────────────
// STEP 3 — EXPORT PANEL
// ────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────
// PARAMETER PANEL
// ────────────────────────────────────────────────────────────────────

function ParamPanel({
  globalParams,
  updateGlobalParam,
  featureStates,
  updateFeatureEnabled,
  updateFeatureValue,
  disabled,
  canRerun,
  onRerun,
}: {
  globalParams: GlobalParams;
  updateGlobalParam: <K extends keyof GlobalParams>(
    key: K,
    value: GlobalParams[K]
  ) => void;
  featureStates: FeatureStates;
  updateFeatureEnabled: (featureId: string, enabled: boolean) => void;
  updateFeatureValue: (
    featureId: string,
    paramId: string,
    value: FeatureValue
  ) => void;
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
            icon={
              <RefreshCw size={11} className={disabled ? "animate-spin" : ""} />
            }
            className="w-full"
          >
            Recompile
          </Button>
        </div>
      )}

      <Group title="Global" code="§ GLOBAL" tone="accent">
        <ColorPicker
          label="3D SCAN COLOR"
          code="RGB"
          value={globalParams.gunColor}
          onChange={(v) => updateGlobalParam("gunColor", v)}
          disabled={disabled}
        />
        <ColorPicker
          label="MOLD COLOR"
          code="RGB"
          value={globalParams.moldColor}
          onChange={(v) => updateGlobalParam("moldColor", v)}
          disabled={disabled}
        />
        <Slider
          label="TOTAL LENGTH"
          code="Lx"
          unit="mm"
          value={globalParams.totalLength}
          min={100}
          max={250}
          step={1}
          hint="Total length of the holster mold (insertion depth)."
          onChange={(v) => updateGlobalParam("totalLength", v)}
          disabled={disabled}
        />
      </Group>

      <Group title="Detail" code="§ DETAIL" defaultOpen={false} tone="accent">
        <Slider
          label="VOXEL PITCH"
          code="δ"
          unit="mm"
          value={globalParams.voxelPitch}
          min={0.2}
          max={0.5}
          step={0.05}
          hint="Lower = more surface detail, more compute."
          onChange={(v) => updateGlobalParam("voxelPitch", v)}
          disabled={disabled}
        />
        <Slider
          label="SMOOTH σ"
          code="σ"
          unit="vox"
          value={globalParams.smoothSigma}
          min={0}
          max={2}
          step={0.1}
          hint="Gaussian pre-marching-cubes smoothing."
          onChange={(v) => updateGlobalParam("smoothSigma", v)}
          disabled={disabled}
        />
        <Slider
          label="SMOOTH ITER"
          code="n"
          unit="iter"
          value={globalParams.smoothIter}
          min={0}
          max={50}
          step={1}
          hint="Post-MC Taubin (removes stair-stepping)."
          onChange={(v) => updateGlobalParam("smoothIter", v)}
          disabled={disabled}
        />
        <Select
          label="PLUG FACES"
          code="Σf"
          value={globalParams.plugDecimTarget}
          options={[8000, 15000, 30000, 60000, 120000]}
          onChange={(v) => updateGlobalParam("plugDecimTarget", v)}
          disabled={disabled}
        />
      </Group>

      <Group title="Alignment" code="§ ALIGN" tone="accent">
        <Toggle
          label="MIRROR Z"
          code="⇌"
          checked={globalParams.mirror}
          hint="Flip if slide release / ejection side is inverted."
          onChange={(v) => updateGlobalParam("mirror", v)}
          disabled={disabled}
        />
        <Slider
          label="ROTATE Z"
          code="↻"
          unit="deg"
          value={globalParams.rotateZDeg}
          min={-45}
          max={45}
          step={1}
          hint="Correction for MABR alignment errors."
          onChange={(v) => updateGlobalParam("rotateZDeg", v)}
          disabled={disabled}
        />
      </Group>

      {publishedFeatures().map((def) => {
        const state = featureStates[def.id];
        if (!state?.enabled) return null;
        return (
          <FeatureParamGroup
            key={def.id}
            def={def}
            state={state}
            onToggleEnabled={(v) => updateFeatureEnabled(def.id, v)}
            onUpdate={(paramId, value) =>
              updateFeatureValue(def.id, paramId, value)
            }
            disabled={disabled}
          />
        );
      })}
    </div>
  );
}

function FeatureParamGroup({
  def,
  state,
  onToggleEnabled,
  onUpdate,
  disabled,
}: {
  def: FeatureDef;
  state: FeatureState;
  onToggleEnabled: (v: boolean) => void;
  onUpdate: (paramId: string, value: FeatureValue) => void;
  disabled: boolean;
}) {
  const code = `§ ${def.id.toUpperCase().replace(/_/g, ".")}`;
  return (
    <Group title={def.label} code={code} tone="warn">
      <Toggle
        label="ENABLED"
        checked={state.enabled}
        hint={def.description}
        onChange={onToggleEnabled}
        disabled={disabled}
      />
      {def.params.map((p) => {
        if (p.type === "number") {
          return (
            <Slider
              key={p.id}
              label={p.label.toUpperCase()}
              code={p.code}
              unit={p.unit}
              value={Number(state.values[p.id] ?? p.default)}
              min={p.min}
              max={p.max}
              step={p.step}
              hint={p.hint}
              onChange={(v) => onUpdate(p.id, v)}
              disabled={disabled}
            />
          );
        }
        if (p.type === "toggle") {
          return (
            <Toggle
              key={p.id}
              label={p.label.toUpperCase()}
              code={p.code}
              checked={Boolean(state.values[p.id] ?? p.default)}
              hint={p.hint}
              onChange={(v) => onUpdate(p.id, v)}
              disabled={disabled}
            />
          );
        }
        // select (numeric)
        return (
          <Select
            key={p.id}
            label={p.label.toUpperCase()}
            code={p.code}
            value={Number(state.values[p.id] ?? p.default)}
            options={p.options}
            onChange={(v) => onUpdate(p.id, v)}
            disabled={disabled}
          />
        );
      })}
    </Group>
  );
}

// ────────────────────────────────────────────────────────────────────
// VIEWPORT HUD OVERLAY
// ────────────────────────────────────────────────────────────────────

function ViewportHUD({
  step,
  viewMode,
  isProcessing,
  featureStates,
  activeTag,
  generatedGlobalParams,
  generatedFeatureStates,
  generatedFileName,
  jobId,
}: {
  step: Step;
  viewMode: ViewMode;
  isProcessing: boolean;
  featureStates: FeatureStates;
  activeTag: ActiveTag;
  generatedGlobalParams: GlobalParams | null;
  generatedFeatureStates: FeatureStates | null;
  generatedFileName: string | null;
  jobId: string;
}) {
  const activeSlotLabel = (() => {
    if (!activeTag) return null;
    const def = FEATURES_BY_ID[activeTag.featureId];
    if (!def) return null;
    const slot = def.points[activeTag.pointIndex];
    return slot ? `${def.label} :: ${slot.label}` : def.label;
  })();

  const modeLabel =
    step === 1
      ? "AWAITING 3D SCAN"
      : step === 1.5
      ? activeSlotLabel
        ? `TAG :: ${activeSlotLabel}`
        : "ALIGNMENT ACQUISITION"
      : step === 2
      ? "PROCESSING"
      : `EXPORT · ${viewMode.toUpperCase()}`;

  const { tagged, required } = publishedFeatures().reduce(
    (acc, def) => {
      const s = featureStates[def.id];
      if (!s?.enabled) return acc;
      const { tagged, required } = featureProgress(def, s);
      return { tagged: acc.tagged + tagged, required: acc.required + required };
    },
    { tagged: 0, required: 0 }
  );

  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      <svg className="absolute inset-0 w-full h-full" aria-hidden>
        <defs>
          <linearGradient id="hud-corner" x1="0" x2="1">
            <stop offset="0%" stopColor="var(--hud-teal-bright)" />
            <stop offset="100%" stopColor="var(--hud-teal)" />
          </linearGradient>
        </defs>
        <polyline
          points="16,40 16,16 40,16"
          stroke="url(#hud-corner)"
          strokeWidth="1"
          fill="none"
        />
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
        {generatedGlobalParams && generatedFeatureStates && step === 3 && (
          <GeneratedInfo
            globalParams={generatedGlobalParams}
            featureStates={generatedFeatureStates}
            fileName={generatedFileName}
          />
        )}
      </div>

      {step === 1.5 && activeTag && <CenterReticle />}

      <div className="absolute bottom-3 left-3 flex flex-col gap-0.5 max-w-[46%] pointer-events-none">
        <TerminalLine tone="accent" stamp="[SYS]">
          {modeLabel.toLowerCase()}
        </TerminalLine>
        {step === 1.5 && (
          <TerminalLine tone="default" stamp="[TGT]">
            {tagged}/{required} anchors locked
          </TerminalLine>
        )}
        {step === 3 && (
          <TerminalLine tone="success" stamp="[OK]">
            mold ready · halves separable along slide-thickness axis
          </TerminalLine>
        )}
      </div>

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
  globalParams,
  featureStates,
  fileName,
}: {
  globalParams: GlobalParams;
  featureStates: FeatureStates;
  fileName: string | null;
}) {
  const rows: [string, string, "default" | "accent"][] = [
    ["VOXEL δ", `${globalParams.voxelPitch}mm`, "default"],
    ["SMOOTH σ", `${globalParams.smoothSigma}`, "default"],
    ["FACES", globalParams.plugDecimTarget.toLocaleString(), "default"],
    [
      "MIRROR",
      globalParams.mirror ? "ON" : "OFF",
      globalParams.mirror ? "accent" : "default",
    ],
    ["ROTATE Z", `${globalParams.rotateZDeg}°`, "default"],
  ];

  const activeFeatures = publishedFeatures().filter(
    (d) => featureStates[d.id]?.enabled
  );

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
      {activeFeatures.map((def) => {
        const state = featureStates[def.id];
        return (
          <div
            key={def.id}
            className="mt-2 pt-1.5 border-t border-[var(--hud-line)]"
          >
            <div className="flex items-center gap-1.5">
              <LED state="on" />
              <span
                className="font-display text-[9.5px] uppercase tracking-wider"
                style={{ color: def.color }}
              >
                {def.label}
              </span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] font-mono mt-1">
              {def.params.slice(0, 6).map((p) => {
                const v = state.values[p.id] ?? ("default" in p ? p.default : "");
                const label = p.code ?? p.label;
                let display: string;
                if (p.type === "number") {
                  display = `${v}${p.unit ? p.unit : ""}`;
                } else if (p.type === "toggle") {
                  display = v ? "ON" : "OFF";
                } else {
                  display = String(v);
                }
                return (
                  <div key={p.id} className="contents">
                    <span className="text-[var(--hud-text-faint)]">
                      {label}
                    </span>
                    <span className="text-[var(--hud-text-dim)] text-right tabular-nums">
                      {display}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
