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

from fastapi import FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
JOBS_DIR = HERE / "jobs"
JOBS_DIR.mkdir(exist_ok=True)
ACCESSORIES_DIR = HERE.parent / "accessories"

app = FastAPI(title="LLOD Mold Maker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "cmd": cmd,
                "stdout": result.stdout[-2000:],
                "stderr": result.stderr[-2000:],
            },
        )


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


@app.post("/api/process")
async def process(
    file: UploadFile,
    voxel_pitch: float = Form(0.35),
    smooth_sigma: float = Form(0.8),
    plug_decim_target: int = Form(30_000),
    gun_decim_target: int = Form(60_000),
    smooth_iter: int = Form(0),
    retention: bool = Form(True),
    retention_front_offset: float = Form(4.0),
    retention_length: float = Form(16.0),
    retention_width_y: float = Form(14.0),
    retention_depth_z: float = Form(4.0),
    retention_y_offset: float = Form(0.0),
    retention_rotate_deg: float = Form(0.0),
    retention_corner_radius: float = Form(0.0),
    retention_one_side: bool = Form(False),
    mirror: bool = Form(False),
    rotate_z_deg: float = Form(0.0),
    # Slide Release
    sr_enabled: bool = Form(True),
    sr_width_y: float = Form(12.0),
    sr_depth_z: float = Form(6.0),
    sr_y_offset: float = Form(0.0),
    sr_z_offset: float = Form(0.0),
    feature_points: str | None = Form(None),
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
        "--decim-target", str(plug_decim_target),
        "--gun-decim-target", str(gun_decim_target),
        "--voxel-pitch", str(voxel_pitch),
        "--smooth-sigma", str(smooth_sigma),
        "--smooth-iter", str(smooth_iter),
        "--rotate-z-deg", str(rotate_z_deg),
        "--retention-front-offset", str(retention_front_offset),
        "--retention-length", str(retention_length),
        "--retention-width-y", str(retention_width_y),
        "--retention-depth-z", str(retention_depth_z),
        "--retention-y-offset", str(retention_y_offset),
        "--retention-rotate-deg", str(retention_rotate_deg),
        "--retention-corner-radius", str(retention_corner_radius),
        # Pass SR params
        "--sr-width-y", str(sr_width_y),
        "--sr-depth-z", str(sr_depth_z),
        "--sr-y-offset", str(sr_y_offset),
        "--sr-z-offset", str(sr_z_offset),
    ]
    if mirror:
        cmd.append("--mirror")
    if retention:
        cmd.append("--retention")
    if retention_one_side:
        cmd.append("--retention-one-side")
    if sr_enabled:
        cmd.append("--sr-enabled")
    
    if feature_points:
        features_path = job_dir / "features.json"
        features_path.write_text(feature_points)
        cmd.extend(["--feature-points", str(features_path)])

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
