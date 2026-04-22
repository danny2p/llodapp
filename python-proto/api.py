"""FastAPI service that runs the plug pipeline on an uploaded STL.

Each request gets its own job directory under ./jobs/<uuid>/. We run
prototype_v11_mabr.py (single decim variant, single gun decim) then
split_plug.py on the resulting plug. The job directory is mounted as a
static route so the browser can fetch the STLs directly.

Pipeline is CPU-bound and synchronous — a single request blocks one
uvicorn worker for ~15–30s. Fine for the demo; if this grows, swap to
a background task + polling endpoint.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
JOBS_DIR = HERE / "jobs"
JOBS_DIR.mkdir(exist_ok=True)
ACCESSORIES_DIR = HERE.parent / "accessories"
SAMPLES_DIR = HERE / "samples"
CONFIGS_DIR = HERE / "configs"
CONFIGS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="LLOD Holster Workshop")
...
@app.get("/api/samples")
def list_samples() -> list[str]:
    if not SAMPLES_DIR.exists():
        return []
    return [p.name for p in sorted(SAMPLES_DIR.glob("*.stl"))]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


def _run(cmd: list[str]) -> None:
    # Use Popen + communicate to avoid deadlocks when buffer fills up
    process = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    stdout, stderr = process.communicate()
    
    if process.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "cmd": cmd,
                "stdout": stdout[-2000:],
                "stderr": stderr[-2000:],
            },
        )


async def _run_stream(cmd: list[str]):
    """Run a command and yield progress markers + final status."""
    # Add -u to python command to disable output buffering
    if cmd[0].endswith("python") or cmd[0].endswith("python3"):
        cmd.insert(1, "-u")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )

    # We'll use a set to track emitted progress to avoid duplicates if 
    # the script emits multiple identical markers.
    last_p = -1.0

    if process.stdout:
        for line in iter(process.stdout.readline, ""):
            if line.startswith("__PROGRESS__:"):
                try:
                    data = json.loads(line.split("__PROGRESS__:", 1)[1])
                    if data['p'] != last_p:
                        yield {"type": "progress", "data": data}
                        last_p = data['p']
                except:
                    pass
            # Optional: Log other output to stderr for debugging
            # else: print(f"SUBPROCESS: {line.strip()}")

    return_code = process.wait()
    if return_code != 0:
        stderr = process.stderr.read() if process.stderr else ""
        yield {"type": "error", "detail": {"code": return_code, "stderr": stderr}}
    else:
        yield {"type": "complete"}


def _one(job_dir: Path, pattern: str) -> Path:
    matches = sorted(job_dir.glob(pattern))
    if not matches:
        raise HTTPException(
            status_code=500,
            detail=f"pipeline did not produce a file matching {pattern}",
        )
    return matches[0]


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/accessories")
def list_accessories() -> list[str]:
    if not ACCESSORIES_DIR.exists():
        return []
    return [p.name for p in sorted(ACCESSORIES_DIR.glob("*.stl"))]


@app.post("/api/align-stream")
async def align_stream(
    file: UploadFile | None = None,
    sample_name: str | None = Form(None),
    rotate_z_deg: float = Form(0.0),
    mirror: bool = Form(False),
):
    if not file and not sample_name:
        raise HTTPException(status_code=400, detail="Must provide either a file or a sample name")

    job_id = uuid.uuid4().hex[:12]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir()

    if file:
        if not file.filename or not file.filename.lower().endswith(".stl"):
            raise HTTPException(status_code=400, detail="upload must be a .stl file")
        stem = Path(file.filename).stem
        safe_stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in stem) or "upload"
        input_path = job_dir / f"{safe_stem}.stl"
        with input_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    else:
        sample_path = SAMPLES_DIR / sample_name # type: ignore
        if not sample_path.exists():
            raise HTTPException(status_code=404, detail="Sample not found")
        stem = sample_path.stem
        input_path = job_dir / sample_path.name
        shutil.copy2(sample_path, input_path)

    async def event_generator():
        yield json.dumps({"type": "progress", "data": {"p": 0.0, "l": "initializing alignment"}}) + "\n"

        cmd: list[str] = [
            sys.executable, str(HERE / "prototype_v11_mabr.py"),
            "--input", str(input_path),
            "--out-dir", str(job_dir),
            "--gun-decim-target", "30000",
            "--rotate-z-deg", str(rotate_z_deg),
        ]
        if mirror:
            cmd.append("--mirror")

        async for msg in _run_stream(cmd):
            if msg["type"] == "error":
                yield json.dumps(msg) + "\n"
                return
            yield json.dumps(msg) + "\n"

        gun_path = _one(job_dir, f"*_mabr_aligned_decim30000*.stl")
        
        result = {
            "jobId": job_id,
            "alignedUrl": f"/jobs/{job_id}/{gun_path.name}",
        }
        yield json.dumps({"type": "result", "data": result}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@app.post("/api/align")
async def align(
    file: UploadFile,
    rotate_z_deg: float = Form(0.0),
    mirror: bool = Form(False),
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".stl"):
        raise HTTPException(status_code=400, detail="upload must be a .stl file")

    job_id = uuid.uuid4().hex[:12]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir()

    stem = Path(file.filename).stem
    safe_stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in stem) or "upload"
    input_path = job_dir / f"{safe_stem}.stl"
    with input_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    cmd: list[str] = [
        sys.executable, str(HERE / "prototype_v11_mabr.py"),
        "--input", str(input_path),
        "--out-dir", str(job_dir),
        "--gun-decim-target", "30000",
        "--rotate-z-deg", str(rotate_z_deg),
    ]
    if mirror:
        cmd.append("--mirror")
    
    _run(cmd)

    gun_path = _one(job_dir, f"*_mabr_aligned_decim30000*.stl")
    
    return {
        "jobId": job_id,
        "alignedUrl": f"/jobs/{job_id}/{gun_path.name}",
    }

@app.post("/api/process-stream")
async def process_stream(
    file: UploadFile | None = None,
    sample_name: str | None = Form(None),
    voxel_pitch: float = Form(0.25),
    mc_step_size: int = Form(2),
    smooth_sigma: float = Form(0.8),
    plug_decim_target: int = Form(60_000),
    gun_decim_target: int = Form(60_000),
    smooth_iter: int = Form(0),
    total_length: float = Form(160.0),
    mirror: bool = Form(False),
    rotate_z_deg: float = Form(0.0),
    features_state: str = Form(...),
):
    if not file and not sample_name:
        raise HTTPException(status_code=400, detail="Must provide either a file or a sample name")

    job_id = uuid.uuid4().hex[:12]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir()

    if file:
        if not file.filename or not file.filename.lower().endswith(".stl"):
            raise HTTPException(status_code=400, detail="upload must be a .stl file")
        stem = Path(file.filename).stem
        safe_stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in stem) or "upload"
        input_path = job_dir / f"{safe_stem}.stl"
        with input_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)
    else:
        sample_path = SAMPLES_DIR / sample_name # type: ignore
        if not sample_path.exists():
            raise HTTPException(status_code=404, detail="Sample not found")
        stem = sample_path.stem
        input_path = job_dir / sample_path.name
        shutil.copy2(sample_path, input_path)

    features_path = job_dir / "features_state.json"
    features_path.write_text(features_state)

    async def event_generator():
        yield json.dumps({"type": "progress", "data": {"p": 0.0, "l": "initializing pipeline"}}) + "\n"

        cmd: list[str] = [
            sys.executable, str(HERE / "prototype_v11_mabr.py"),
            "--input", str(input_path),
            "--out-dir", str(job_dir),
            "--decim-target", str(plug_decim_target),
            "--gun-decim-target", str(gun_decim_target),
            "--voxel-pitch", str(voxel_pitch),
            "--mc-step-size", str(mc_step_size),
            "--smooth-sigma", str(smooth_sigma),
            "--smooth-iter", str(smooth_iter),
            "--total-length", str(total_length),
            "--rotate-z-deg", str(rotate_z_deg),
            "--features-state", str(features_path),
        ]
        if mirror:
            cmd.append("--mirror")

        async for msg in _run_stream(cmd):
            if msg["type"] == "error":
                yield json.dumps(msg) + "\n"
                return
            yield json.dumps(msg) + "\n"

        yield json.dumps({"type": "progress", "data": {"p": 0.98, "l": "splitting mold into halves"}}) + "\n"

        # Split is fast, usually doesn't need its own stream logic but we can wrap it
        plug_path = _one(job_dir, f"*_swept_mabr_*_decim{plug_decim_target}*.stl")
        gun_path = _one(job_dir, f"*_mabr_aligned_decim{gun_decim_target}*.stl")

        try:
            _run([
                sys.executable, str(HERE / "split_plug.py"),
                "--input", str(plug_path),
                "--out-dir", str(job_dir),
            ])
        except Exception as e:
            yield json.dumps({"type": "error", "detail": {"code": 500, "stderr": str(e)}}) + "\n"
            return

        left_path = _one(job_dir, "*_left.stl")
        right_path = _one(job_dir, "*_right.stl")

        tg_json = job_dir / "tg.json"
        tg_anchor = None
        if tg_json.exists():
            tg_anchor = json.loads(tg_json.read_text())

        def url(p: Path) -> str:
            return f"/jobs/{job_id}/{p.name}"

        result = {
            "jobId": job_id,
            "gunUrl": url(gun_path),
            "fullUrl": url(plug_path),
            "leftUrl": url(left_path),
            "rightUrl": url(right_path),
            "tgAnchor": tg_anchor,
        }

        yield json.dumps({"type": "result", "data": result}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@app.post("/api/process")
async def process(
    file: UploadFile,
    voxel_pitch: float = Form(0.25),
    smooth_sigma: float = Form(0.8),
    plug_decim_target: int = Form(60_000),
    gun_decim_target: int = Form(60_000),
    smooth_iter: int = Form(0),
    total_length: float = Form(160.0),
    mirror: bool = Form(False),
    rotate_z_deg: float = Form(0.0),
    features_state: str = Form(...),
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".stl"):
        raise HTTPException(status_code=400, detail="upload must be a .stl file")

    job_id = uuid.uuid4().hex[:12]
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir()

    stem = Path(file.filename).stem
    safe_stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in stem) or "upload"
    input_path = job_dir / f"{safe_stem}.stl"
    with input_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    features_path = job_dir / "features_state.json"
    features_path.write_text(features_state)

    cmd: list[str] = [
        sys.executable, str(HERE / "prototype_v11_mabr.py"),
        "--input", str(input_path),
        "--out-dir", str(job_dir),
        "--decim-target", str(plug_decim_target),
        "--gun-decim-target", str(gun_decim_target),
        "--voxel-pitch", str(voxel_pitch),
        "--smooth-sigma", str(smooth_sigma),
        "--smooth-iter", str(smooth_iter),
        "--total-length", str(total_length),
        "--rotate-z-deg", str(rotate_z_deg),
        "--features-state", str(features_path),
    ]
    if mirror:
        cmd.append("--mirror")

    _run(cmd)

    plug_path = _one(job_dir, f"*_swept_mabr_*_decim{plug_decim_target}*.stl")
    gun_path = _one(job_dir, f"*_mabr_aligned_decim{gun_decim_target}*.stl")

    _run([
        sys.executable, str(HERE / "split_plug.py"),
        "--input", str(plug_path),
        "--out-dir", str(job_dir),
    ])

    left_path = _one(job_dir, "*_left.stl")
    right_path = _one(job_dir, "*_right.stl")

    tg_json = job_dir / "tg.json"
    tg_anchor = None
    if tg_json.exists():
        tg_anchor = json.loads(tg_json.read_text())

    def url(p: Path) -> str:
        return f"/jobs/{job_id}/{p.name}"

    return {
        "jobId": job_id,
        "gunUrl": url(gun_path),
        "fullUrl": url(plug_path),
        "leftUrl": url(left_path),
        "rightUrl": url(right_path),
        "tgAnchor": tg_anchor,
    }


@app.post("/api/download-merged")
async def download_merged(
    job_id: str = Form(...),
    side: str = Form(...),  # "left" or "right"
    accessories: str = Form(...),  # JSON string
) -> FileResponse:
    job_dir = JOBS_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail="Job not found")

    # Find the base STL (left or right)
    try:
        base_path = _one(job_dir, f"*_{side}.stl")
        full_path = _one(job_dir, f"*_swept_mabr_*.stl")
    except HTTPException:
        raise HTTPException(status_code=404, detail=f"Base or full STL not found for job {job_id}")

    # Output path
    out_name = f"merged_{side}_{uuid.uuid4().hex[:8]}.stl"
    out_path = job_dir / out_name

    cmd: list[str] = [
        sys.executable, str(HERE / "merge_accessories.py"),
        "--base", str(base_path),
        "--full", str(full_path),
        "--accessories", accessories,
        "--out", str(out_path),
        "--accessories-dir", str(ACCESSORIES_DIR),
    ]

    _run(cmd)

    return FileResponse(
        path=out_path,
        filename=f"{side}-half-with-accessories.stl",
        media_type="application/octet-stream",
    )


@app.post("/api/save-config")
async def save_config(request: Request) -> dict:
    body = await request.json()
    filename = body.get("filename", "")
    safe_name = "".join(c if c.isalnum() or c in "-_." else "_" for c in filename)
    if not safe_name.endswith(".json"):
        raise HTTPException(status_code=400, detail="filename must end in .json")
    config_path = CONFIGS_DIR / safe_name
    config_path.write_text(json.dumps(body, indent=2))
    return {"saved": safe_name}


@app.get("/api/configs")
def list_configs(prefix: str = "") -> list[str]:
    return [p.name for p in sorted(CONFIGS_DIR.glob("*.json")) if p.name.startswith(prefix)]


@app.get("/api/configs/{filename}")
def get_config(filename: str) -> dict:
    safe_name = "".join(c if c.isalnum() or c in "-_." else "_" for c in filename)
    config_path = CONFIGS_DIR / safe_name
    if not config_path.exists():
        raise HTTPException(status_code=404, detail="Config not found")
    return json.loads(config_path.read_text())


@app.delete("/api/configs/{filename}")
def delete_config(filename: str) -> dict:
    safe_name = "".join(c if c.isalnum() or c in "-_." else "_" for c in filename)
    config_path = CONFIGS_DIR / safe_name
    if not config_path.exists():
        raise HTTPException(status_code=404, detail="Config not found")
    config_path.unlink()
    return {"deleted": safe_name}


@app.get("/api/download-cad/{job_id}")
async def download_cad(job_id: str) -> FileResponse:
    job_dir = JOBS_DIR / job_id
    if not job_dir.exists():
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")

    print(f"Exporting CAD for job {job_id}...", flush=True)

    # 1. Find the aligned gun STL to pass it to the script
    try:
        gun_path = _one(job_dir, "*_mabr_aligned_decim*.stl")
    except HTTPException:
        try:
            gun_path = _one(job_dir, "*_mabr_aligned.stl")
        except HTTPException:
            raise HTTPException(status_code=500, detail="Aligned gun STL not found")

    # 2. Run the CAD export script
    # Find the swept cavity STL (the 'base' plug with no features)
    plug_path = job_dir / "base_cavity.stl"
    if not plug_path.exists():
        plug_path = None

    cmd: list[str] = [
        sys.executable,
        str(HERE / "export_cad.py"),
        "--job-dir", str(job_dir),
        "--stl-path", str(gun_path),
    ]
    if plug_path:
        cmd.extend(["--plug-path", str(plug_path)])
    
    try:
        _run(cmd)
    except HTTPException as e:
        print(f"CAD Export failed: {e.detail}", flush=True)
        raise e
    except Exception as e:
        print(f"Unexpected CAD Export error: {str(e)}", flush=True)
        raise HTTPException(status_code=500, detail=f"Internal error: {str(e)}")

    step_path = job_dir / "features.step"
    if not step_path.exists():
        print(f"Error: {step_path} missing after export script finished", flush=True)
        raise HTTPException(status_code=500, detail="CAD export failed to produce features.step")

    # 3. Create a ZIP file
    zip_name = f"llod_export_{job_id}.zip"
    zip_path = job_dir / zip_name
    
    import zipfile
    with zipfile.ZipFile(zip_path, 'w') as zipf:
        zipf.write(step_path, "llod_assembly.step")
        zipf.write(gun_path, "gun_scan_reference.stl")
        if plug_path and plug_path.exists():
            zipf.write(plug_path, "mold_cavity_reference.stl")

    return FileResponse(
        path=zip_path,
        filename=zip_name,
        media_type="application/zip",
    )


app.mount("/jobs", StaticFiles(directory=JOBS_DIR), name="jobs")
if ACCESSORIES_DIR.exists():
    app.mount("/accessories", StaticFiles(directory=ACCESSORIES_DIR), name="accessories")
else:
    ACCESSORIES_DIR.mkdir(exist_ok=True)
    app.mount("/accessories", StaticFiles(directory=ACCESSORIES_DIR), name="accessories")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
