import io
import os
import sys
import time
import uuid
import zipfile

# Auto-reexec inside the virtual environment if running with system Python
_CURR_DIR = os.path.dirname(os.path.abspath(__file__))
_VENV_PY = os.path.join(_CURR_DIR, ".venv", "bin", "python")
if os.path.isfile(_VENV_PY) and os.path.realpath(sys.executable) != os.path.realpath(_VENV_PY):
    os.execv(_VENV_PY, [_VENV_PY] + sys.argv)

from typing import Dict, Any, Optional
import numpy as np
from PIL import Image, ImageFilter
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles

from core.defringe import defringe_rgba
from core.model import get_model_info, remove_background
from core.upscaler import upscale_rgba_image, is_ai_upscaler_available

app = FastAPI(title="Cut-Out: Local Background Remover")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session cache for storing full-resolution original images and masks
# Automatically evicts old sessions after 2 hours
SESSIONS: Dict[str, Dict[str, Any]] = {}
SESSION_MAX_AGE_SEC = 7200


def cleanup_expired_sessions():
    now = time.time()
    expired = [
        sid
        for sid, s in SESSIONS.items()
        if now - s.get("created_at", 0) > SESSION_MAX_AGE_SEC
    ]
    for sid in expired:
        SESSIONS.pop(sid, None)


@app.get("/api/info")
def api_info():
    """Returns the active AI model information and licensing details."""
    return get_model_info()


@app.get("/api/health")
def api_health():
    return {"status": "ok", "active_sessions": len(SESSIONS)}


@app.post("/api/load-image")
async def api_load_image(file: UploadFile = File(...)):
    """
    Receives an uploaded image (PNG, JPG, WebP), creates a full-resolution session
    with its original background INTACT (fully opaque alpha mask = 255).
    Zero AI delay; loads into editor instantly.
    """
    cleanup_expired_sessions()

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    try:
        pil_image = Image.open(io.BytesIO(content))
        orig_rgb = pil_image.convert("RGB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image format: {e}")

    session_id = uuid.uuid4().hex
    w, h = orig_rgb.size

    # Initial mask is 100% opaque (background NOT removed yet)
    alpha_mask = Image.new("L", (w, h), 255)

    orig_buf = io.BytesIO()
    orig_rgb.save(orig_buf, format="PNG")
    orig_bytes = orig_buf.getvalue()

    mask_buf = io.BytesIO()
    alpha_mask.save(mask_buf, format="PNG")
    mask_bytes = mask_buf.getvalue()

    SESSIONS[session_id] = {
        "orig_rgb_np": np.array(orig_rgb),
        "mask_np": np.array(alpha_mask),
        "orig_bytes": orig_bytes,
        "mask_bytes": mask_bytes,
        "width": w,
        "height": h,
        "created_at": time.time(),
        "model_used": "none",
    }

    return {
        "session_id": session_id,
        "width": w,
        "height": h,
        "model_used": "none",
        "image_url": f"/api/session/{session_id}/image",
        "mask_url": f"/api/session/{session_id}/mask",
    }


@app.post("/api/run-ai")
async def api_run_ai(
    session_id: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None)
):
    """
    Runs AI background removal model on demand for an existing session OR directly from uploaded image file.
    Guarantees that AI Cutout works even if session is restored after reload or server restarted.
    """
    cleanup_expired_sessions()

    pil_image = None
    target_session_id = session_id

    if session_id and session_id in SESSIONS:
        session = SESSIONS[session_id]
        orig_rgb_np = session["orig_rgb_np"]
        pil_image = Image.fromarray(orig_rgb_np)
    elif file is not None:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty file uploaded.")
        raw_img = Image.open(io.BytesIO(content))
        from PIL import ImageOps
        raw_img = ImageOps.exif_transpose(raw_img)
        pil_image = raw_img.convert("RGB")
        target_session_id = str(uuid.uuid4())
    else:
        raise HTTPException(status_code=404, detail="Session expired or not found. Please re-run with image.")

    try:
        orig_rgb, alpha_mask, model_used = remove_background(pil_image, refine_edges=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI background removal failed: {e}")

    orig_buf = io.BytesIO()
    orig_rgb.save(orig_buf, format="PNG")
    orig_bytes = orig_buf.getvalue()

    mask_buf = io.BytesIO()
    alpha_mask.save(mask_buf, format="PNG")
    mask_bytes = mask_buf.getvalue()

    w, h = orig_rgb.size
    SESSIONS[target_session_id] = {
        "orig_rgb": orig_rgb,
        "mask": alpha_mask,
        "orig_rgb_np": np.array(orig_rgb),
        "mask_np": np.array(alpha_mask),
        "orig_bytes": orig_bytes,
        "mask_bytes": mask_bytes,
        "width": w,
        "height": h,
        "created_at": time.time(),
        "model_used": model_used,
    }

    return {
        "session_id": target_session_id,
        "model_used": model_used,
        "mask_url": f"/api/session/{target_session_id}/mask",
        "image_url": f"/api/session/{target_session_id}/image",
    }


@app.post("/api/remove-bg")
async def api_remove_bg(file: UploadFile = File(...)):
    """
    Receives an uploaded image (PNG, JPG, WebP), extracts the foreground mask
    using BiRefNet (or u2net fallback), refines edges, and creates a session.
    """
    cleanup_expired_sessions()

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file uploaded.")

    try:
        pil_image = Image.open(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image format: {e}")

    try:
        orig_rgb, alpha_mask, model_used = remove_background(pil_image, refine_edges=True)
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Background removal failed: {e}"
        )

    session_id = uuid.uuid4().hex
    w, h = orig_rgb.size

    # Convert original to RGB PNG bytes and mask to L PNG bytes
    orig_buf = io.BytesIO()
    orig_rgb.save(orig_buf, format="PNG")
    orig_bytes = orig_buf.getvalue()

    mask_buf = io.BytesIO()
    alpha_mask.save(mask_buf, format="PNG")
    mask_bytes = mask_buf.getvalue()

    SESSIONS[session_id] = {
        "orig_rgb_np": np.array(orig_rgb),
        "mask_np": np.array(alpha_mask),
        "orig_bytes": orig_bytes,
        "mask_bytes": mask_bytes,
        "width": w,
        "height": h,
        "created_at": time.time(),
        "model_used": model_used,
    }

    return {
        "session_id": session_id,
        "width": w,
        "height": h,
        "model_used": model_used,
        "image_url": f"/api/session/{session_id}/image",
        "mask_url": f"/api/session/{session_id}/mask",
    }


@app.get("/api/session/{session_id}/image")
def get_session_image(session_id: str):
    if session_id not in SESSIONS:
        raise HTTPException(status_code=404, detail="Session not found")
    return Response(content=SESSIONS[session_id]["orig_bytes"], media_type="image/png")


@app.get("/api/session/{session_id}/mask")
def get_session_mask(session_id: str):
    if session_id not in SESSIONS:
        raise HTTPException(status_code=404, detail="Session not found")
    return Response(content=SESSIONS[session_id]["mask_bytes"], media_type="image/png")


@app.post("/api/export")
async def api_export(
    session_id: str = Form(...),
    mask_file: UploadFile = File(None),
    width: Optional[int] = Form(None),
    height: Optional[int] = Form(None),
    format: Optional[str] = Form("png"),
    enhance: Optional[bool] = Form(True),
):
    """
    Exports the final cut-out image at original resolution or chosen target resolution.
    Applies color defringing to pull solid foreground colors into
    semi-transparent boundary pixels, preventing background color halos.
    When upscaling, performs high-order Lanczos resampling with adaptive
    detail sharpening and crisp alpha edge reconstruction.
    """
    if session_id not in SESSIONS:
        raise HTTPException(status_code=404, detail="Session not found")

    session = SESSIONS[session_id]
    orig_rgb_np = session["orig_rgb_np"]
    h, w = orig_rgb_np.shape[:2]

    if mask_file is not None:
        mask_bytes = await mask_file.read()
        mask_pil = Image.open(io.BytesIO(mask_bytes)).convert("L")
        if mask_pil.size != (w, h):
            mask_pil = mask_pil.resize((w, h), Image.Resampling.BILINEAR)
        mask_np = np.array(mask_pil)
    else:
        mask_np = session["mask_np"]

    # Apply color defringing (color decontamination) on full resolution pixels
    rgba_np = defringe_rgba(orig_rgb_np, mask_np)
    out_img = Image.fromarray(rgba_np, mode="RGBA")

    # If a specific target resolution is requested, upscale using Real-ESRGAN / Lanczos
    if width and height and (width, height) != (w, h):
        target_w = max(16, min(8192, int(width)))
        target_h = max(16, min(8192, int(height)))
        out_img = upscale_rgba_image(
            out_img,
            target_size=(target_w, target_h),
            use_ai=bool(enhance),
        )

    out_buf = io.BytesIO()
    fmt = (format or "png").lower().strip()

    if fmt in ("jpg", "jpeg"):
        bg = Image.new("RGB", out_img.size, (255, 255, 255))
        bg.paste(out_img, mask=out_img.split()[3])
        bg.save(out_buf, format="JPEG", quality=95)
        media_type = "image/jpeg"
        ext = "jpg"
    elif fmt == "webp":
        out_img.save(out_buf, format="WEBP", quality=95)
        media_type = "image/webp"
        ext = "webp"
    else:
        out_img.save(out_buf, format="PNG", compress_level=6)
        media_type = "image/png"
        ext = "png"

    out_buf.seek(0)
    filename = f"cutout_{out_img.width}x{out_img.height}.{ext}"

    return StreamingResponse(
        out_buf,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(out_buf.getvalue())),
        },
    )


@app.post("/api/export-batch")
async def api_export_batch(request: Request):
    """
    Exports multiple sessions at once into a single ZIP archive.
    Each image is processed with full-resolution color defringing
    and incorporates any custom client-side mask edits.
    """
    form = await request.form()
    session_ids = form.get("session_ids", "")
    sids = [s.strip() for s in str(session_ids).split(",") if s.strip()]
    if not sids:
        raise HTTPException(status_code=400, detail="No session IDs provided")

    zip_buf = io.BytesIO()
    count = 0
    with zipfile.ZipFile(zip_buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for i, sid in enumerate(sids):
            if sid in SESSIONS:
                count += 1
                session = SESSIONS[sid]
                orig_rgb_np = session["orig_rgb_np"]
                h, w = orig_rgb_np.shape[:2]

                mask_file = form.get(f"mask_{sid}")
                if mask_file is not None and hasattr(mask_file, "read"):
                    mask_bytes = await mask_file.read()
                    mask_pil = Image.open(io.BytesIO(mask_bytes)).convert("L")
                    if mask_pil.size != (w, h):
                        mask_pil = mask_pil.resize((w, h), Image.Resampling.BILINEAR)
                    mask_np = np.array(mask_pil)
                else:
                    mask_np = session["mask_np"]

                rgba_np = defringe_rgba(orig_rgb_np, mask_np)
                out_img = Image.fromarray(rgba_np, mode="RGBA")
                img_buf = io.BytesIO()
                out_img.save(img_buf, format="PNG", compress_level=6)
                zf.writestr(f"cutout_slide_{i+1}_{out_img.width}x{out_img.height}.png", img_buf.getvalue())

    if count == 0:
        raise HTTPException(status_code=404, detail="No valid sessions found for batch export")

    zip_buf.seek(0)
    return StreamingResponse(
        zip_buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="all_cutouts.zip"',
            "Content-Length": str(len(zip_buf.getvalue())),
        },
    )


# Mount static directory for frontend
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.route("/style.css", methods=["GET", "HEAD"])
def serve_css(request: Request):
    return FileResponse("static/style.css", media_type="text/css")


@app.route("/app.js", methods=["GET", "HEAD"])
def serve_js(request: Request):
    return FileResponse("static/app.js", media_type="application/javascript")


@app.route("/favicon.svg", methods=["GET", "HEAD"])
def serve_favicon(request: Request):
    return FileResponse("static/favicon.svg", media_type="image/svg+xml")


@app.get("/")
@app.head("/")
def serve_index():
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 60)
    print("  🚀 Starting Cut-Out (Local Background Remover)")
    print("  👉 Open http://localhost:8000 in your browser")
    print("=" * 60 + "\n")
    uvicorn.run(app, host="127.0.0.1", port=8000)
