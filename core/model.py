import io
import logging
import os
from typing import Optional, Tuple
import numpy as np
from PIL import Image, ImageOps
import rembg
from rembg import new_session, remove

from core.matting import refine_alpha_mask

logger = logging.getLogger("cutout.model")

# Model license & commercial use metadata
MODEL_METADATA = {
    "birefnet-general": {
        "display_name": "BiRefNet (General)",
        "license": "MIT",
        "commercial_use": True,
        "notes": (
            "Permits commercial use without restriction. "
            "Requires preservation of copyright and MIT license notice."
        ),
    },
    "u2net": {
        "display_name": "U-2-Net",
        "license": "Apache-2.0",
        "commercial_use": True,
        "notes": (
            "Permits commercial use, modification, and distribution. "
            "Requires original copyright notice and Apache 2.0 attribution."
        ),
    },
}

_ACTIVE_SESSION = None
_ACTIVE_MODEL_NAME = None


def get_providers():
    """Returns the best available onnxruntime execution providers."""
    try:
        import onnxruntime as ort
        available = ort.get_available_providers()
        providers = []
        if "CUDAExecutionProvider" in available:
            providers.append("CUDAExecutionProvider")
        if "CPUExecutionProvider" in available:
            providers.append("CPUExecutionProvider")
        return providers if providers else ["CPUExecutionProvider"]
    except Exception:
        return ["CPUExecutionProvider"]


def is_birefnet_ready() -> bool:
    """Checks if BiRefNet model weights are downloaded and ready on disk."""
    path = os.path.expanduser("~/.rembg/models/birefnet-general/birefnet-general.onnx")
    return os.path.isfile(path) and os.path.getsize(path) > 900 * 1024 * 1024


def load_session(preferred_model: str = "birefnet-general"):
    """
    Attempts to load the preferred BiRefNet session.
    If BiRefNet fails to load or is not ready, falls back to u2net.
    """
    global _ACTIVE_SESSION, _ACTIVE_MODEL_NAME

    providers = get_providers()

    # 1. Prefer BiRefNet if it's already on disk
    if preferred_model == "birefnet-general" and is_birefnet_ready():
        try:
            logger.info("Initializing BiRefNet (birefnet-general)...")
            session = new_session("birefnet-general", providers=providers)
            _ACTIVE_SESSION = session
            _ACTIVE_MODEL_NAME = "birefnet-general"
            logger.info("Successfully loaded BiRefNet model.")
            return _ACTIVE_SESSION, _ACTIVE_MODEL_NAME
        except Exception as e:
            logger.warning(f"BiRefNet failed to load ({e}). Falling back to u2net...")

    # 2. Check if u2net is ready as fallback
    u2net_path = os.path.expanduser("~/.rembg/models/u2net/u2net.onnx")
    if os.path.isfile(u2net_path) and os.path.getsize(u2net_path) > 100 * 1024 * 1024:
        try:
            logger.info("Initializing U-2-Net (u2net)...")
            session = new_session("u2net", providers=providers)
            _ACTIVE_SESSION = session
            _ACTIVE_MODEL_NAME = "u2net"
            logger.info("Successfully loaded U-2-Net fallback model.")
            return _ACTIVE_SESSION, _ACTIVE_MODEL_NAME
        except Exception as e:
            logger.warning(f"Failed to load u2net from disk: {e}")

    # 3. If neither is on disk, attempt birefnet-general first
    try:
        logger.info("Attempting new_session for birefnet-general...")
        session = new_session("birefnet-general", providers=providers)
        _ACTIVE_SESSION = session
        _ACTIVE_MODEL_NAME = "birefnet-general"
        return _ACTIVE_SESSION, _ACTIVE_MODEL_NAME
    except Exception as e:
        logger.warning(f"BiRefNet load failed ({e}). Falling back to u2net...")
        session = new_session("u2net", providers=providers)
        _ACTIVE_SESSION = session
        _ACTIVE_MODEL_NAME = "u2net"
        return _ACTIVE_SESSION, _ACTIVE_MODEL_NAME


def get_active_session():
    """Gets the active session or initializes one if needed."""
    global _ACTIVE_SESSION, _ACTIVE_MODEL_NAME

    # If currently using u2net fallback, check if BiRefNet finished downloading in background
    if _ACTIVE_MODEL_NAME == "u2net" and is_birefnet_ready():
        logger.info("BiRefNet model has become available! Upgrading from u2net...")
        try:
            return load_session("birefnet-general")
        except Exception as e:
            logger.warning(f"Could not upgrade to BiRefNet: {e}")

    if _ACTIVE_SESSION is None:
        return load_session()
    return _ACTIVE_SESSION, _ACTIVE_MODEL_NAME


def get_model_info():
    """Returns current active model information and licensing details."""
    _, model_name = get_active_session()
    metadata = MODEL_METADATA.get(
        model_name,
        {
            "display_name": model_name,
            "license": "Open Source",
            "commercial_use": True,
            "notes": "See model repository for terms.",
        },
    )
    return {
        "model_name": model_name,
        **metadata,
    }


def remove_background(
    image: Image.Image,
    refine_edges: bool = True,
) -> Tuple[Image.Image, Image.Image, str]:
    """
    Removes background from PIL Image, maintaining original pixel resolution.
    Returns:
        (original_rgb_image, alpha_mask_image, model_name)
    """
    # Normalize orientation from EXIF tags
    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        image = image.convert("RGB")

    orig_w, orig_h = image.size
    session, model_name = get_active_session()

    # Generate full-resolution alpha mask
    raw_mask = remove(
        image,
        session=session,
        only_mask=True,
    )

    # Ensure mask is L mode (grayscale 8-bit)
    if raw_mask.mode != "L":
        raw_mask = raw_mask.convert("L")

    # Ensure mask matches exact original resolution
    if raw_mask.size != (orig_w, orig_h):
        raw_mask = raw_mask.resize((orig_w, orig_h), Image.Resampling.BILINEAR)

    # Edge refinement with guided filter using original RGB as guidance
    if refine_edges:
        rgb_np = np.array(image)
        mask_np = np.array(raw_mask)
        refined_np = refine_alpha_mask(rgb_np, mask_np, r=4, eps=1e-4)
        refined_mask = Image.fromarray(refined_np, mode="L")
    else:
        refined_mask = raw_mask

    return image, refined_mask, model_name
