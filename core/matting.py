import cv2
import numpy as np


def guided_filter_mono(
    guide: np.ndarray,
    p: np.ndarray,
    r: int = 4,
    eps: float = 1e-3,
    subsample: int = 1,
) -> np.ndarray:
    """
    Fast Guided Filter for alpha mask edge refinement.

    Parameters:
        guide: Grayscale guidance image, float32 in [0, 1], shape (H, W).
        p: Input rough mask, float32 in [0, 1], shape (H, W).
        r: Filter radius in pixels.
        eps: Regularization parameter.
        subsample: Subsampling factor for fast acceleration.

    Returns:
        Refined alpha mask, float32 in [0, 1], shape (H, W).
    """
    h, w = p.shape[:2]

    if subsample > 1:
        s_w, s_h = max(1, w // subsample), max(1, h // subsample)
        guide_sub = cv2.resize(guide, (s_w, s_h), interpolation=cv2.INTER_LINEAR)
        p_sub = cv2.resize(p, (s_w, s_h), interpolation=cv2.INTER_LINEAR)
        r_sub = max(1, r // subsample)
    else:
        guide_sub = guide
        p_sub = p
        r_sub = r

    ksize = (2 * r_sub + 1, 2 * r_sub + 1)

    mean_I = cv2.boxFilter(guide_sub, cv2.CV_32F, ksize)
    mean_p = cv2.boxFilter(p_sub, cv2.CV_32F, ksize)
    mean_Ip = cv2.boxFilter(guide_sub * p_sub, cv2.CV_32F, ksize)
    cov_Ip = mean_Ip - mean_I * mean_p

    mean_II = cv2.boxFilter(guide_sub * guide_sub, cv2.CV_32F, ksize)
    var_I = mean_II - mean_I * mean_I

    a = cov_Ip / (var_I + eps)
    b = mean_p - a * mean_I

    mean_a = cv2.boxFilter(a, cv2.CV_32F, ksize)
    mean_b = cv2.boxFilter(b, cv2.CV_32F, ksize)

    if subsample > 1:
        mean_a = cv2.resize(mean_a, (w, h), interpolation=cv2.INTER_LINEAR)
        mean_b = cv2.resize(mean_b, (w, h), interpolation=cv2.INTER_LINEAR)

    q = mean_a * guide + mean_b
    return np.clip(q, 0.0, 1.0)


def refine_alpha_mask(
    guide_rgb: np.ndarray,
    alpha_mask: np.ndarray,
    r: int = 4,
    eps: float = 1e-4,
) -> np.ndarray:
    """
    Refines a uint8 alpha mask (H, W) using the full-resolution RGB guide (H, W, 3).
    Preserves solid foreground/background while snapping semi-transparent edges
    to high-frequency details (hair, fur, text, edges) in the original image.

    Returns:
        Refined alpha mask as uint8 (H, W) in [0, 255].
    """
    h, w = guide_rgb.shape[:2]
    if alpha_mask.shape[:2] != (h, w):
        alpha_mask = cv2.resize(alpha_mask, (w, h), interpolation=cv2.INTER_LINEAR)

    # Convert RGB guide to grayscale float32 [0, 1]
    if guide_rgb.ndim == 3 and guide_rgb.shape[2] >= 3:
        guide_gray = cv2.cvtColor(guide_rgb[:, :, :3], cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    else:
        guide_gray = guide_rgb.astype(np.float32) / 255.0

    mask_f = alpha_mask.astype(np.float32) / 255.0

    # Subsample for very high-resolution images to maintain interactive speed
    subsample = 2 if max(h, w) > 2000 else 1

    refined_f = guided_filter_mono(guide_gray, mask_f, r=r, eps=eps, subsample=subsample)

    # Convert back to uint8 [0, 255]
    refined_u8 = (np.clip(refined_f, 0.0, 1.0) * 255.0).astype(np.uint8)

    # Re-enforce strictly solid areas (alpha == 0 or alpha == 255) far from edges
    # so we only sharpen the boundary zone
    edge_zone = cv2.absdiff(alpha_mask, cv2.medianBlur(alpha_mask, 5)) > 10
    edge_zone = cv2.dilate(edge_zone.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))

    final_mask = alpha_mask.copy()
    final_mask[edge_zone > 0] = refined_u8[edge_zone > 0]

    return final_mask
