"use client";

import { useCallback, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { SceneAssets, Step, TgAnchor } from "@/components/Scene";

const Scene = dynamic(() => import("@/components/Scene").then((m) => m.Scene), {
  ssr: false,
});

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

const STEP_META: Record<Step, { title: string; subtitle: string }> = {
  1: { title: "Upload a scan", subtitle: "STL of the firearm you want to mold." },
  2: { title: "Generating mold", subtitle: "Inserting the scan into clay to carve the cavity." },
  3: { title: "Splitting model", subtitle: "Separating the mold into left and right halves." },
};

type ProcessResponse = SceneAssets & {
  jobId: string;
  tgAnchor: TgAnchor | null;
};

type Params = {
  voxelPitch: number;
  smoothSigma: number;
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
  retentionOneSide: boolean;
};

const DEFAULT_PARAMS: Params = {
  voxelPitch: 0.35,
  smoothSigma: 0.8,
  plugDecimTarget: 30000,
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
  retentionOneSide: false,
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

export default function Page() {
  const [step, setStep] = useState<Step>(1);
  const [viewMode, setViewMode] = useState<ViewMode>("unified");
  const [accessories, setAccessories] = useState<string[]>([]);
  const [placedAccessories, setPlacedAccessories] = useState<PlacedAccessory[]>(
    []
  );
  const [activeAccessoryId, setActiveAccessoryId] = useState<string | null>(
    null
  );
  const [fileName, setFileName] = useState<string | null>(null);

  // Fetch accessories on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/accessories`)
      .then((res) => {
        if (!res.ok) throw new Error("failed to fetch accessories list");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setAccessories(data);
        } else {
          console.error("accessories API did not return an array", data);
          setAccessories([]);
        }
      })
      .catch((err) => console.error(err));
  }, []);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [assets, setAssets] = useState<SceneAssets | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [generatedParams, setGeneratedParams] = useState<Params | null>(null);
  const [generatedFileName, setGeneratedFileName] = useState<string | null>(null);

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
        position: [0, 5, 0], // Start 5mm above "table"
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
        const res = await fetch(`${API_BASE}/api/process`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`${res.status}: ${body.slice(0, 400)}`);
        }
        const data = (await res.json()) as ProcessResponse;
        setAssets(absolutize(data));
        setGeneratedParams(withParams);
        setGeneratedFileName(file.name);
        setStep(2);
        window.setTimeout(() => setStep(3), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsProcessing(false);
      }
    },
    []
  );

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
    if (uploadedFile) void processFile(uploadedFile, params);
  }, [uploadedFile, params, processFile]);

  const reset = () => {
    setStep(1);
    setFileName(null);
    setUploadedFile(null);
    setAssets(null);
    setError(null);
    setIsProcessing(false);
    setGeneratedParams(null);
    setGeneratedFileName(null);
  };

  const stem = fileName ? fileName.replace(/\.stl$/i, "") : "mold";

  return (
    <div className="min-h-screen flex flex-col bg-black text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
        <div className="font-semibold tracking-tight">LLOD · Mold Maker</div>
        <StepIndicator current={step} />
      </header>

      <div className="flex-1 grid grid-cols-[minmax(320px,380px)_1fr]">
        <aside className="border-r border-zinc-800 p-6 flex flex-col gap-6 overflow-y-auto max-h-[calc(100vh-69px)]">
          <section>
            <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Step {step}
            </h2>
            <h1 className="text-xl font-semibold">{STEP_META[step].title}</h1>
            <p className="text-sm text-zinc-400 mt-1">{STEP_META[step].subtitle}</p>
          </section>

          {step === 3 && assets && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-1">
                Work Surface
              </h3>
              <div className="grid grid-cols-3 gap-1 bg-zinc-900 p-1 rounded-md border border-zinc-800">
                {(["unified", "left", "right"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={[
                      "text-[11px] py-1.5 rounded transition-colors capitalize",
                      viewMode === m
                        ? "bg-zinc-100 text-black font-medium"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800",
                    ].join(" ")}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === 3 && assets && viewMode !== "unified" && (
            <Group title="Accessories" collapsible defaultOpen={true}>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {accessories.map((acc) => (
                  <button
                    key={acc}
                    onClick={() => addAccessory(acc)}
                    className="text-[10px] p-2 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600 transition-colors flex flex-col items-center gap-1"
                  >
                    <div className="w-8 h-8 bg-zinc-900 rounded flex items-center justify-center">
                      <span className="text-zinc-500">STL</span>
                    </div>
                    <span className="truncate w-full text-center">{acc}</span>
                  </button>
                ))}
              </div>

              {placedAccessories.filter((a) => a.side === viewMode).length > 0 && (
                <div className="flex flex-col gap-4 border-t border-zinc-800 pt-4">
                  {placedAccessories
                    .filter((a) => a.side === viewMode)
                    .map((acc) => (
                      <div
                        key={acc.id}
                        className={[
                          "p-3 rounded-md border transition-colors",
                          activeAccessoryId === acc.id
                            ? "bg-zinc-900 border-emerald-900/50 shadow-[0_0_10px_rgba(16,185,129,0.05)]"
                            : "bg-zinc-900/50 border-zinc-800",
                        ].join(" ")}
                        onClick={() => setActiveAccessoryId(acc.id)}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[11px] font-medium text-emerald-500">
                            {acc.name}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeAccessory(acc.id);
                            }}
                            className="text-[10px] text-zinc-500 hover:text-red-400"
                          >
                            Remove
                          </button>
                        </div>

                        {activeAccessoryId === acc.id && (
                          <div className="flex flex-col gap-3">
                            <Slider
                              label="X Position"
                              unit="mm"
                              value={acc.position[0]}
                              min={-120}
                              max={120}
                              step={0.5}
                              onChange={(v) =>
                                updateAccessory(acc.id, {
                                  position: [v, acc.position[1], acc.position[2]],
                                })
                              }
                            />
                            <Slider
                              label="Y Position"
                              unit="mm"
                              value={acc.position[2]}
                              min={-80}
                              max={80}
                              step={0.5}
                              onChange={(v) =>
                                updateAccessory(acc.id, {
                                  position: [acc.position[0], acc.position[1], v],
                                })
                              }
                            />
                            <Slider
                              label="Height (Z)"
                              unit="mm"
                              value={acc.position[1]}
                              min={-10}
                              max={30}
                              step={0.1}
                              hint="Distance from the mold surface"
                              onChange={(v) =>
                                updateAccessory(acc.id, {
                                  position: [acc.position[0], v, acc.position[2]],
                                })
                              }
                            />
                            <Slider
                              label="Rotation"
                              unit="deg"
                              value={acc.rotation[1]}
                              min={-180}
                              max={180}
                              step={1}
                              onChange={(v) =>
                                updateAccessory(acc.id, {
                                  rotation: [acc.rotation[0], v, acc.rotation[2]],
                                })
                              }
                            />
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </Group>
          )}

          {step === 1 && !isProcessing && !uploadedFile && (
            <label className="flex flex-col gap-2">
              <span className="text-sm text-zinc-300">Scan file (.stl)</span>
              <input
                type="file"
                accept=".stl,model/stl,application/octet-stream"
                onChange={handleUpload}
                className="text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-zinc-800 file:text-zinc-100 file:cursor-pointer hover:file:bg-zinc-700"
              />
              <span className="text-xs text-zinc-500">
                Processing takes 15–30 seconds.
              </span>
            </label>
          )}

          {isProcessing && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 text-sm text-zinc-300">
                <Spinner />
                <span>Processing {fileName ?? "scan"}…</span>
              </div>
              <span className="text-xs text-zinc-500">
                Voxelizing + sweeping + decimating. Takes 15–30 seconds.
              </span>
            </div>
          )}

          {step === 2 && !isProcessing && (
            <div className="flex items-center gap-3 text-sm text-zinc-300">
              <Spinner />
              <span>Animating insertion of {fileName ?? "scan"}…</span>
            </div>
          )}

          {step === 3 && assets && (
            <div className="flex flex-col gap-3">
              <div className="text-sm text-zinc-300">
                Mold ready. Halves separate along the slide-thickness axis.
              </div>
              <div className="flex flex-col gap-2">
                <DownloadLink href={assets.fullUrl} download={`${stem}-mold.stl`} label="Download unified mold" />
                <DownloadLink href={assets.leftUrl} download={`${stem}-left.stl`} label="Download left half" />
                <DownloadLink href={assets.rightUrl} download={`${stem}-right.stl`} label="Download right half" />
              </div>
              <button
                onClick={reset}
                className="self-start text-sm px-3 py-2 rounded-md bg-zinc-800 hover:bg-zinc-700"
              >
                Start over (new scan)
              </button>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-400 border border-red-900 rounded-md p-3 whitespace-pre-wrap">
              {error}
            </div>
          )}

          <ParamPanel
            params={params}
            update={updateParam}
            disabled={isProcessing}
            canRerun={!!uploadedFile}
            onRerun={rerun}
          />
        </aside>

        <main className="relative">
          <Scene
            step={step}
            viewMode={viewMode}
            assets={assets}
            placedAccessories={placedAccessories}
            activeAccessoryId={activeAccessoryId}
            onUpdateAccessory={updateAccessory}
            onSetActiveAccessory={setActiveAccessoryId}
          />
          {generatedParams && (
            <GeneratedInfo
              params={generatedParams}
              fileName={generatedFileName}
            />
          )}
        </main>
      </div>
    </div>
  );
}

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
    <section className="flex flex-col gap-5 pt-4 border-t border-zinc-800">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500">
          Parameters
        </h3>
        {canRerun && (
          <button
            onClick={onRerun}
            disabled={disabled}
            className="text-xs px-3 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Re-run
          </button>
        )}
      </div>

      <Group title="Detail">
        <Slider
          label="Voxel pitch"
          unit="mm"
          value={params.voxelPitch}
          min={0.2}
          max={0.5}
          step={0.05}
          hint="Lower = more surface detail, more compute"
          onChange={(v) => update("voxelPitch", v)}
          disabled={disabled}
        />
        <Slider
          label="Smooth sigma"
          unit="vox"
          value={params.smoothSigma}
          min={0}
          max={2}
          step={0.1}
          hint="Gaussian pre-marching-cubes smoothing"
          onChange={(v) => update("smoothSigma", v)}
          disabled={disabled}
        />
        <Select
          label="Plug faces"
          value={params.plugDecimTarget}
          options={[8000, 15000, 30000, 60000, 120000]}
          onChange={(v) => update("plugDecimTarget", v)}
          disabled={disabled}
        />
      </Group>

      <Group title="Alignment">
        <Checkbox
          label="Mirror Z"
          checked={params.mirror}
          hint="Use if slide release/ejection side is wrong"
          onChange={(v) => update("mirror", v)}
          disabled={disabled}
        />
        <Slider
          label="Rotate Z"
          unit="deg"
          value={params.rotateZDeg}
          min={-45}
          max={45}
          step={1}
          hint="Corrects MABR alignment errors"
          onChange={(v) => update("rotateZDeg", v)}
          disabled={disabled}
        />
      </Group>

      <Group title="Trigger Retention" collapsible defaultOpen={false}>
        <Checkbox
          label="Enabled"
          checked={params.retention}
          hint="Adds triangle indent behind trigger-guard front edge"
          onChange={(v) => update("retention", v)}
          disabled={disabled}
        />
        <Slider
          label="Front offset"
          unit="mm"
          value={params.retentionFrontOffset}
          min={0}
          max={20}
          step={0.5}
          hint="mm behind TG front edge where the flat side starts"
          onChange={(v) => update("retentionFrontOffset", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="Length"
          unit="mm"
          value={params.retentionLength}
          min={4}
          max={40}
          step={1}
          hint="Triangle length from flat side to point"
          onChange={(v) => update("retentionLength", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="Width (Y)"
          unit="mm"
          value={params.retentionWidthY}
          min={4}
          max={30}
          step={1}
          hint="Triangle width at the flat side"
          onChange={(v) => update("retentionWidthY", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="Depth (Z)"
          unit="mm"
          value={params.retentionDepthZ}
          min={0.5}
          max={10}
          step={0.1}
          hint="Max bump depth at the flat side"
          onChange={(v) => update("retentionDepthZ", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="Y offset"
          unit="mm"
          value={params.retentionYOffset}
          min={-15}
          max={15}
          step={0.5}
          hint="Shift triangle away from TG center"
          onChange={(v) => update("retentionYOffset", v)}
          disabled={disabled || !params.retention}
        />
        <Slider
          label="Rotate Z"
          unit="deg"
          value={params.retentionRotateDeg}
          min={-90}
          max={90}
          step={1}
          hint="Rotate the triangle around +Z, anchored at the flat side"
          onChange={(v) => update("retentionRotateDeg", v)}
          disabled={disabled || !params.retention}
        />
        <Checkbox
          label="One side only"
          checked={params.retentionOneSide}
          hint="Default carves both sides of the plug"
          onChange={(v) => update("retentionOneSide", v)}
          disabled={disabled || !params.retention}
        />
      </Group>
    </section>
  );
}

function GeneratedInfo({
  params,
  fileName,
}: {
  params: Params;
  fileName: string | null;
}) {
  const rows: [string, string][] = [
    ["voxel pitch", `${params.voxelPitch} mm`],
    ["smooth sigma", `${params.smoothSigma} vox`],
    ["plug faces", params.plugDecimTarget.toLocaleString()],
    ["mirror", params.mirror ? "yes" : "no"],
    ["rotate Z", `${params.rotateZDeg}°`],
  ];
  const retentionRows: [string, string][] = params.retention
    ? [
        ["front offset", `${params.retentionFrontOffset} mm`],
        ["length", `${params.retentionLength} mm`],
        ["width Y", `${params.retentionWidthY} mm`],
        ["depth Z", `${params.retentionDepthZ} mm`],
        ["Y offset", `${params.retentionYOffset} mm`],
        ["rotate Z", `${params.retentionRotateDeg}°`],
        ["sides", params.retentionOneSide ? "+Z only" : "both"],
      ]
    : [];
  return (
    <div className="absolute top-4 right-4 bg-black/70 backdrop-blur-sm border border-zinc-800 rounded-md px-3 py-2 text-[11px] leading-relaxed text-zinc-300 font-mono max-w-[260px] pointer-events-none select-text">
      {fileName && (
        <div className="text-zinc-100 truncate mb-1">{fileName}</div>
      )}
      <InfoRows rows={rows} />
      <div className="text-zinc-500 mt-1.5">
        retention {params.retention ? "on" : "off"}
      </div>
      {params.retention && <InfoRows rows={retentionRows} />}
    </div>
  );
}

function InfoRows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid grid-cols-[auto_auto] gap-x-3">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <span className="text-zinc-500">{k}</span>
          <span className="text-zinc-200 tabular-nums text-right">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Group({
  title,
  children,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => collapsible && setIsOpen(!isOpen)}
        disabled={!collapsible}
        className={[
          "flex items-center justify-between w-full text-left",
          collapsible ? "cursor-pointer group/title" : "cursor-default",
        ].join(" ")}
      >
        <h4 className="text-[11px] uppercase tracking-wider text-zinc-500 group-hover/title:text-zinc-300 transition-colors">
          {title}
        </h4>
        {collapsible && (
          <span
            className={[
              "text-[10px] text-zinc-600 group-hover/title:text-zinc-400 transition-transform",
              isOpen ? "rotate-0" : "-rotate-90",
            ].join(" ")}
          >
            ▼
          </span>
        )}
      </button>
      {isOpen && <div className="flex flex-col gap-3">{children}</div>}
    </div>
  );
}

function Slider({
  label,
  unit,
  value,
  min,
  max,
  step,
  hint,
  onChange,
  disabled,
}: {
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint?: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={["flex flex-col gap-1", disabled ? "opacity-50" : ""].join(" ")}>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-zinc-200">{label}</span>
        <span className="text-xs text-zinc-400 tabular-nums">
          {value}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        disabled={disabled}
        className="accent-emerald-500"
      />
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={["flex items-center justify-between gap-3", disabled ? "opacity-50" : ""].join(" ")}>
      <span className="text-sm text-zinc-200">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        disabled={disabled}
        className="text-sm bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o.toLocaleString()}
          </option>
        ))}
      </select>
    </label>
  );
}

function Checkbox({
  label,
  checked,
  hint,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  hint?: string;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={["flex flex-col gap-0.5", disabled ? "opacity-50" : ""].join(" ")}>
      <span className="flex items-center gap-2 text-sm text-zinc-200">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="accent-emerald-500"
        />
        {label}
      </span>
      {hint && <span className="text-[11px] text-zinc-500 ml-6">{hint}</span>}
    </label>
  );
}

function StepIndicator({ current }: { current: Step }) {
  const steps: { n: Step; label: string }[] = [
    { n: 1, label: "Upload" },
    { n: 2, label: "Generate" },
    { n: 3, label: "Split" },
  ];
  return (
    <ol className="flex items-center gap-2 text-xs">
      {steps.map(({ n, label }, i) => {
        const active = n === current;
        const done = n < current;
        return (
          <li key={n} className="flex items-center gap-2">
            <span
              className={[
                "flex items-center justify-center rounded-full w-6 h-6 font-semibold",
                active
                  ? "bg-zinc-100 text-black"
                  : done
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-800 text-zinc-400",
              ].join(" ")}
            >
              {n}
            </span>
            <span className={active ? "text-zinc-100" : "text-zinc-500"}>
              {label}
            </span>
            {i < steps.length - 1 && <span className="w-8 h-px bg-zinc-700 mx-1" />}
          </li>
        );
      })}
    </ol>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block w-4 h-4 rounded-full border-2 border-zinc-600 border-t-zinc-100 animate-spin"
      aria-label="loading"
    />
  );
}

function DownloadLink({
  href,
  download,
  label,
}: {
  href?: string;
  download: string;
  label: string;
}) {
  const disabled = !href;
  return (
    <a
      href={href}
      download={download}
      aria-disabled={disabled}
      className={[
        "text-sm px-3 py-2 rounded-md border text-center",
        disabled
          ? "pointer-events-none border-zinc-800 text-zinc-600"
          : "border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-100",
      ].join(" ")}
    >
      {label}
    </a>
  );
}
