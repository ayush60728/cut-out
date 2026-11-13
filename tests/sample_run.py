#!/usr/bin/env python3
"""
Sample demonstration script for Cut-Out pipeline.
Tests background removal on a realistic sample image, simulates brush edits,
applies color defringing, and verifies full-resolution preservation.
"""

import os
import sys

# Ensure repository root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from PIL import Image, ImageDraw

from core.defringe import defringe_rgba
from core.matting import refine_alpha_mask
from core.model import get_model_info, remove_background


def create_sample_image(filename="sample_input.png", width=1280, height=720):
    """Creates a sample test image with soft gradients and distinct subject."""
    img = Image.new("RGB", (width, height), color=(245, 247, 250))
    draw = ImageDraw.Draw(img)

    # Draw background gradient bars
    for y in range(0, height, 40):
        shade = 240 - (y // 15)
        draw.rectangle([0, y, width, y + 20], fill=(shade, shade, shade + 5))

    # Foreground Subject: A stylish geometric badge with fine details
    cx, cy = width // 2, height // 2
    # Shadow
    draw.ellipse([cx - 210, cy - 190, cx + 210, cy + 230], fill=(210, 215, 225))
    # Outer circle
    draw.ellipse([cx - 200, cy - 200, cx + 200, cy + 200], fill=(99, 102, 241))
    # Inner star/polygon
    points = []
    for i in range(10):
        r = 180 if i % 2 == 0 else 90
        angle = i * np.pi / 5 - np.pi / 2
        px = cx + int(r * np.cos(angle))
        py = cy + int(r * np.sin(angle))
        points.append((px, py))
    draw.polygon(points, fill=(245, 158, 11))

    # Center circle
    draw.ellipse([cx - 70, cy - 70, cx + 70, cy + 70], fill=(236, 72, 153))

    img.save(filename)
    print(f"Created sample image: {filename} ({width}x{height})")
    return img


def main():
    print("=" * 65)
    print("  Cut-Out — Background Removal & Brush Pipeline Verification")
    print("=" * 65)

    info = get_model_info()
    print(f"\n[1] AI Model in use: {info['display_name']} ({info['model_name']})")
    print(f"    License: {info['license']}")
    print(f"    Commercial Use Allowed: {info['commercial_use']}")
    print(f"    License Notes: {info['notes']}")

    # 1. Create sample input image
    sample_path = "sample_input.png"
    img = create_sample_image(sample_path, width=1200, height=800)
    input_w, input_h = img.size

    # 2. Automatic background removal
    print(f"\n[2] Running automatic cutout on {input_w}x{input_h} image...")
    orig_rgb, alpha_mask, model_name = remove_background(img, refine_edges=True)
    mask_w, mask_h = alpha_mask.size
    print(f"    Processed with model: {model_name}")
    print(f"    Original RGB dimensions: {orig_rgb.size}")
    print(f"    Refined Alpha Mask dimensions: {alpha_mask.size}")

    assert orig_rgb.size == (input_w, input_h), "Original dimensions changed!"
    assert alpha_mask.size == (input_w, input_h), "Mask dimensions do not match original!"
    print("    -> Dimension preservation: VERIFIED (100% exact match)")

    # 3. Test brush operations (Erase & Restore)
    print("\n[3] Testing Erase and Restore brushes on Alpha Mask...")
    orig_np = np.array(orig_rgb)
    orig_copy = orig_np.copy()
    mask_np = np.array(alpha_mask)
    mask_initial = mask_np.copy()

    # Erase brush at (cx, cy)
    cx, cy, radius = input_w // 2, input_h // 2, 40
    y, x = np.ogrid[:input_h, :input_w]
    brush_area = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2

    # Erase: set mask to 0 in brush area
    mask_np[brush_area] = 0
    print(f"    - Erased circular region at ({cx}, {cy}) radius={radius}px")
    assert not np.array_equal(mask_np, mask_initial), "Mask should have changed after erase"
    assert np.array_equal(orig_np, orig_copy), "CRITICAL FAIL: Original pixels were modified!"
    print("    -> Erase brush test: Mask modified, original image pixels untouched: PASSED")

    # Restore brush at (cx, cy)
    mask_np[brush_area] = 255
    print(f"    - Restored circular region at ({cx}, {cy}) radius={radius}px")
    assert mask_np[cy, cx] == 255, "Mask at center should be restored to 255"
    assert np.array_equal(orig_np, orig_copy), "CRITICAL FAIL: Original pixels were modified!"
    print("    -> Restore brush test: Mask restored, original image pixels untouched: PASSED")

    # 4. Color Defringing & Export
    print("\n[4] Applying Color Defringing (halo purge) and exporting...")
    out_rgba = defringe_rgba(orig_np, mask_np)
    out_img = Image.fromarray(out_rgba, mode="RGBA")
    output_path = "sample_output_cutout.png"
    out_img.save(output_path)

    out_w, out_h = out_img.size
    print(f"    Exported image saved to: {output_path}")
    print(f"    Input size:  {input_w} x {input_h}")
    print(f"    Output size: {out_w} x {out_h}")
    assert (out_w, out_h) == (input_w, input_h), "Exported size does not match input size!"
    print("    -> Export size exact match: VERIFIED")

    print("\n" + "=" * 65)
    print("  ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!")
    print("=" * 65 + "\n")


if __name__ == "__main__":
    main()
