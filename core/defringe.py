import cv2
import numpy as np


def defringe_rgba(
    rgb: np.ndarray,
    alpha: np.ndarray,
    solid_threshold: int = 235,
    max_iterations: int = 6,
    kernel_size: int = 5,
) -> np.ndarray:
    """
    Removes color fringing / halos from semi-transparent edge pixels by pulling
    colors from adjacent solid foreground pixels into the edge region.

    Parameters:
        rgb: Full-resolution foreground RGB image (H, W, 3), uint8.
        alpha: Alpha mask (H, W), uint8 in [0, 255].
        solid_threshold: Alpha threshold above which pixels are considered solid foreground.
        max_iterations: Number of color bleed iterations (each step expands ~kernel_size//2 pixels).
        kernel_size: Box filter kernel size for color propagation.

    Returns:
        Cleaned RGBA image (H, W, 4), uint8, with original alpha preserved
        and fringing colors replaced by solid subject colors.
    """
    h, w = rgb.shape[:2]
    if alpha.shape[:2] != (h, w):
        alpha = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_LINEAR)

    solid = (alpha >= solid_threshold).astype(np.uint8)
    fringe = (alpha > 0) & (alpha < solid_threshold)

    # If no fringe or no solid pixels, return original RGBA
    if not np.any(fringe) or not np.any(solid):
        return np.dstack([rgb, alpha])

    # Initialize color buffer with solid foreground pixels only
    color_buf = np.zeros_like(rgb, dtype=np.float32)
    color_buf[solid > 0] = rgb[solid > 0].astype(np.float32)
    known = solid.astype(np.float32)

    ksize = (kernel_size, kernel_size)

    for _ in range(max_iterations):
        needed = (known == 0) & fringe
        if not np.any(needed):
            break

        # Accumulate color and weight from neighboring known pixels
        sum_c = cv2.boxFilter(color_buf, cv2.CV_32F, ksize, normalize=False)
        sum_w = cv2.boxFilter(known, cv2.CV_32F, ksize, normalize=False)

        fillable = needed & (sum_w > 0)
        if not np.any(fillable):
            break

        # Set color to normalized average of known neighbors
        color_buf[fillable] = sum_c[fillable] / sum_w[fillable, None]
        known[fillable] = 1.0

    out_rgb = rgb.copy()
    filled = fringe & (known > 0)
    out_rgb[filled] = np.clip(np.round(color_buf[filled]), 0, 255).astype(np.uint8)

    return np.dstack([out_rgb, alpha])
