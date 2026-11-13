import logging
import os
from typing import Optional, Tuple
import numpy as np
from PIL import Image, ImageFilter

logger = logging.getLogger("cutout.upscaler")

_SR_SESSION = None
_MODEL_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models", "realesr-general-x4v3.onnx")


def get_upscaler_session():
    """Lazily loads the Real-ESRGAN ONNX session."""
    global _SR_SESSION
    if _SR_SESSION is not None:
        return _SR_SESSION

    if not os.path.isfile(_MODEL_PATH):
        logger.warning(f"Real-ESRGAN model not found at {_MODEL_PATH}. Falling back to Lanczos.")
        return None

    try:
        import onnxruntime as ort
        from core.model import get_providers
        providers = get_providers()
        sess_opts = ort.SessionOptions()
        sess_opts.inter_op_num_threads = 4
        sess_opts.intra_op_num_threads = 4
        _SR_SESSION = ort.InferenceSession(_MODEL_PATH, sess_options=sess_opts, providers=providers)
        logger.info(f"Loaded Real-ESRGAN ONNX session with providers: {providers}")
        return _SR_SESSION
    except Exception as e:
        logger.error(f"Failed to initialize Real-ESRGAN session: {e}")
        return None


def is_ai_upscaler_available() -> bool:
    """Checks if the Real-ESRGAN AI model file is available on disk."""
    return os.path.isfile(_MODEL_PATH)


def upscale_rgba_image(
    img_rgba: Image.Image,
    target_size: Optional[Tuple[int, int]] = None,
    use_ai: bool = True,
) -> Image.Image:
    """
    Upscales an RGBA cut-out image.
    If use_ai is True and Real-ESRGAN is available, applies 4x deep-learning
    super-resolution to hallucinate crisp details, sharp vector lines, and clean textures.
    If target_size differs from 4x (e.g. 2x or custom size), resizes the super-resolved
    output with Lanczos-4 resampling (Super Sample Anti-Aliasing).
    Also sharpens alpha mask boundaries for clean anti-aliased edge contours.
    """
    w, h = img_rgba.size
    if target_size:
        target_w, target_h = target_size
    else:
        target_w, target_h = w * 2, h * 2

    # If target is smaller than or equal to original, simple Lanczos downscaling is optimal
    if target_w <= w and target_h <= h:
        return img_rgba.resize((target_w, target_h), Image.Resampling.LANCZOS)

    sess = get_upscaler_session() if use_ai else None

    # Separate RGB and Alpha
    r, g, b, a = img_rgba.split()
    rgb = Image.merge("RGB", (r, g, b))

    if sess is not None:
        try:
            # Run Real-ESRGAN on RGB image
            rgb_sr_4x = _run_realesrgan(sess, rgb)
            if rgb_sr_4x.size != (target_w, target_h):
                rgb_out = rgb_sr_4x.resize((target_w, target_h), Image.Resampling.LANCZOS)
            else:
                rgb_out = rgb_sr_4x
        except Exception as e:
            logger.warning(f"Real-ESRGAN inference failed, falling back to Lanczos: {e}")
            rgb_out = _upscale_algorithmic_rgb(rgb, target_w, target_h)
    else:
        rgb_out = _upscale_algorithmic_rgb(rgb, target_w, target_h)

    # Upscale alpha mask with Lanczos + smoothstep boundary preservation
    a_out = a.resize((target_w, target_h), Image.Resampling.LANCZOS)
    a_np = np.array(a_out, dtype=np.float32)
    mask_trans = (a_np > 6) & (a_np < 250)
    if np.any(mask_trans):
        t = (a_np[mask_trans] - 6) / 244.0
        # Smoothstep curve sharpening
        a_np[mask_trans] = 6 + 244.0 * (3 * t**2 - 2 * t**3)
        a_out = Image.fromarray(np.clip(a_np, 0, 255).astype(np.uint8), mode="L")

    return Image.merge("RGBA", (*rgb_out.split(), a_out))


def _run_realesrgan(sess, img_rgb: Image.Image, tile_size: int = 400, overlap: int = 24) -> Image.Image:
    """Runs Real-ESRGAN inference with seamless overlapping tiles."""
    w, h = img_rgb.size
    scale = 4

    # Direct pass if image is small enough to avoid tiling overhead
    if w <= 512 and h <= 512:
        arr = (np.asarray(img_rgb, dtype=np.float32) / 255.0).transpose(2, 0, 1)[None, ...]
        out = sess.run(None, {"input": arr})[0][0]
        return Image.fromarray((out.transpose(1, 2, 0) * 255.0).clip(0, 255).astype(np.uint8))

    # Tiled inference with linear feathering on tile overlaps
    out_w = w * scale
    out_h = h * scale
    out_arr = np.zeros((out_h, out_w, 3), dtype=np.float32)
    weight_arr = np.zeros((out_h, out_w, 1), dtype=np.float32)

    step = tile_size - overlap
    xs = list(range(0, w, step))
    ys = list(range(0, h, step))

    for y in ys:
        for x in xs:
            tw = min(tile_size, w - x)
            th = min(tile_size, h - y)
            tile = img_rgb.crop((x, y, x + tw, y + th))
            arr = (np.asarray(tile, dtype=np.float32) / 255.0).transpose(2, 0, 1)[None, ...]
            out_tile = sess.run(None, {"input": arr})[0][0].transpose(1, 2, 0)

            tx, ty = x * scale, y * scale
            st_w, st_h = tw * scale, th * scale

            # Linear feather window for seamless blending across tile boundaries
            wx = np.ones((st_w,), dtype=np.float32)
            wy = np.ones((st_h,), dtype=np.float32)
            feather = overlap * scale
            if x > 0 and feather < st_w:
                wx[:feather] = np.linspace(0, 1, feather)
            if (x + tw) < w and feather < st_w:
                wx[-feather:] = np.linspace(1, 0, feather)
            if y > 0 and feather < st_h:
                wy[:feather] = np.linspace(0, 1, feather)
            if (y + th) < h and feather < st_h:
                wy[-feather:] = np.linspace(1, 0, feather)

            w_grid = (wy[:, None] * wx[None, :])[:, :, None]

            out_arr[ty : ty + st_h, tx : tx + st_w] += out_tile[:st_h, :st_w] * w_grid
            weight_arr[ty : ty + st_h, tx : tx + st_w] += w_grid

    out_arr = np.clip((out_arr / np.maximum(weight_arr, 1e-4)) * 255.0, 0, 255).astype(np.uint8)
    return Image.fromarray(out_arr)


def _upscale_algorithmic_rgb(img_rgb: Image.Image, target_w: int, target_h: int) -> Image.Image:
    """Algorithmic Lanczos-4 resampling with adaptive unsharp mask sharpening."""
    w, h = img_rgb.size
    scale = max(target_w / w, target_h / h)
    out = img_rgb.resize((target_w, target_h), Image.Resampling.LANCZOS)
    if scale > 1.05:
        radius = min(3.0, 1.2 * (scale ** 0.5))
        percent = min(220, int(110 + 25 * scale))
        out = out.filter(ImageFilter.UnsharpMask(radius=radius, percent=percent, threshold=2))
    return out

