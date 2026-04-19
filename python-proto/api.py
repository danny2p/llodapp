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
from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
JOBS_DIR = HERE / "jobs"
JOBS_DIR.mkdir(exist_ok=True)
ACCESSORIES_DIR = HERE.parent / "accessories"

app = FastAPI(title="LLOD Holster Workshop")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
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
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )

    if process.stdout:
        for line in iter(process.stdout.readline, ""):
            if line.startswith("__PROGRESS__:"):
                try:
                    data = json.loads(line.split("__PROGRESS__:", 1)[1])
                    yield {"type": "progress", "data": data}
                except:
                    pass

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
):
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

    async def event_generator():
        yield json.dumps({"type": "progress", "data": {"p": 0.0, "l": "initializing pipeline"}}) + "\n"

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
...
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


app.mount("/jobs", StaticFiles(directory=JOBS_DIR), name="jobs")
if ACCESSORIES_DIR.exists():
    app.mount("/accessories", StaticFiles(directory=ACCESSORIES_DIR), name="accessories")
else:
    ACCESSORIES_DIR.mkdir(exist_ok=True)
    app.mount("/accessories", StaticFiles(directory=ACCESSORIES_DIR), name="accessories")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
