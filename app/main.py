"""
FastAPI entry-point cho manual-doc-recorder.

Endpoints:
  POST /compile           — nhận ai_output, chạy word + pdf song song
  GET  /status/{job_id}  — check tiến trình job
  GET  /download/{fname} — trả file về browser / Playwright
  GET  /health           — healthcheck cho Docker
"""

from __future__ import annotations

import asyncio
import os
import traceback
import uuid
from pathlib import Path
from typing import Literal
from fastapi import Request
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
# ── Paths (override bằng env var khi chạy trong container) ──────────────────
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "./output"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ── In-memory job store (đủ dùng cho single-instance) ───────────────────────
JobStatus = Literal["pending", "running", "done", "error"]

jobs: dict[str, dict] = {}

# ── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Manual Doc Recorder API",
    version="1.0.0",
    description="Nhận ai_output từ Playwright tracker → sinh .docx và .pdf",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tracker.js gọi từ localhost browser
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Schema ───────────────────────────────────────────────────────────────────
class CompileRequest(BaseModel):
    ai_output: str
    filename_prefix: str = "HUONG_DAN_SU_DUNG"


class CompileResponse(BaseModel):
    job_id: str
    status: JobStatus
    message: str




# ── Worker ───────────────────────────────────────────────────────────────────

async def _run_compile(job_id: str, ai_output: str, prefix: str) -> None:
    """Chạy word + pdf compiler song song trong executor (blocking I/O)."""
    jobs[job_id]["status"] = "running"

    loop = asyncio.get_running_loop()

    try:
        word_task = loop.run_in_executor(None, _compile_word, ai_output, prefix)
        pdf_task  = loop.run_in_executor(None, _compile_pdf,  ai_output, prefix)

        word_result, pdf_result = await asyncio.gather(
            word_task, pdf_task, return_exceptions=True
        )

        errors: list[str] = []
        files: list[str] = []

        if isinstance(word_result, Exception):
            errors.append(f"Word: {word_result}")
        else:
            files.append(word_result)

        if isinstance(pdf_result, Exception):
            errors.append(f"PDF: {pdf_result}")
        else:
            files.append(pdf_result)

        if errors and not files:
            raise RuntimeError("; ".join(errors))

        jobs[job_id].update({
            "status": "done",
            "files": files,
            "warnings": errors,   # partial errors
        })

    except Exception as exc:
        jobs[job_id].update({
            "status": "error",
            "error": str(exc),
            "traceback": traceback.format_exc(),
        })


def _compile_word(ai_output: str, prefix: str) -> str:
    """Chạy đồng bộ compile_and_word.build_docx(), trả về tên file."""
    # Import lazy để tránh load khi không cần
    import importlib.util, sys

    spec = importlib.util.spec_from_file_location(
        "compile_and_word", Path(__file__).parent.parent / "compile_and_word.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["compile_and_word"] = mod
    spec.loader.exec_module(mod)

    output_path = OUTPUT_DIR / f"{prefix}_FINAL.docx"
    mod.build_docx(ai_output=ai_output, output_path=output_path)
    return output_path.name


def _compile_pdf(ai_output: str, prefix: str) -> str:
    """Chạy đồng bộ compile_and_pdf, trả về tên file."""
    import importlib.util, sys

    spec = importlib.util.spec_from_file_location(
        "compile_and_pdf", Path(__file__).parent.parent / "compile_and_pdf.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["compile_and_pdf"] = mod
    spec.loader.exec_module(mod)

    md_path  = OUTPUT_DIR / f"{prefix}_FINAL.md"
    pdf_path = OUTPUT_DIR / f"{prefix}_FINAL.pdf"

    mod.build_md(ai_output=ai_output, output_md=md_path)
    mod.build_pdf_from_md(md_file=md_path, pdf_file=pdf_path)
    return pdf_path.name


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def ui():
    return Path("static/index.html").read_text(encoding="utf-8")



@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/compile", response_model=CompileResponse, status_code=202)
async def compile_docs(req: CompileRequest):
    """
    Nhận ai_output từ Playwright tracker.
    Kick off job async, trả về job_id ngay lập tức.
    """
    if not req.ai_output or not req.ai_output.strip():
        raise HTTPException(status_code=422, detail="ai_output không được rỗng")

    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "pending", "files": [], "warnings": [], "error": None}

    # Fire-and-forget — không block response
    asyncio.create_task(_run_compile(job_id, req.ai_output, req.filename_prefix))

    return CompileResponse(
        job_id=job_id,
        status="pending",
        message=f"Job {job_id} đã được tạo. Dùng GET /status/{job_id} để theo dõi.",
    )




@app.get("/status/{job_id}")
async def get_status(job_id: str):
    """Trả về trạng thái + danh sách file đã sinh ra."""
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy job: {job_id}")
    return {
        "job_id": job_id,
        **job,
        # Thêm download URLs tiện lợi
        "download_urls": [f"/download/{f}" for f in job.get("files", [])],
    }


@app.get("/download/{filename}")
async def download_file(filename: str):
    """
    Trả file .docx / .pdf / .md từ OUTPUT_DIR về client.
    Playwright dùng endpoint này để lấy file sau khi compile xong.
    """
    # Chặn path traversal
    safe_name = Path(filename).name
    file_path = OUTPUT_DIR / safe_name

    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"File không tồn tại: {safe_name}")

    media_types = {
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".pdf":  "application/pdf",
        ".md":   "text/markdown",
        ".png":  "image/png",
        ".jpg":  "image/jpeg",
    }
    media_type = media_types.get(file_path.suffix.lower(), "application/octet-stream")

    return FileResponse(
        path=str(file_path),
        filename=safe_name,
        media_type=media_type,
    )


@app.get("/jobs")
async def list_jobs():
    """Debug endpoint — liệt kê tất cả jobs trong memory."""
    return {
        jid: {k: v for k, v in info.items() if k != "traceback"}
        for jid, info in jobs.items()
    }

app.mount("/static", StaticFiles(directory="static"), name="static")