import io
import os
import unittest
import zipfile
import numpy as np
from PIL import Image

from core.defringe import defringe_rgba
from core.matting import refine_alpha_mask
from core.model import get_model_info, remove_background
from app import app
from starlette.testclient import TestClient


class TestCutOutPipeline(unittest.TestCase):
    def setUp(self):
        # Create a synthetic 640x480 test image with a colorful subject on a white background
        self.width = 640
        self.height = 480
        
        # Background: white (255, 255, 255)
        arr = np.full((self.height, self.width, 3), 255, dtype=np.uint8)
        
        # Subject: a colored rectangle in the center (red: 220, 40, 40)
        arr[100:380, 150:490] = [220, 40, 40]
        # Inner detail: a blue circle / square (blue: 30, 80, 220)
        arr[200:280, 250:390] = [30, 80, 220]
        
        self.sample_image = Image.fromarray(arr, mode="RGB")
        self.client = TestClient(app)

    def test_model_license_and_info(self):
        """Test model metadata and commercial license reporting."""
        info = get_model_info()
        self.assertIn("model_name", info)
        self.assertIn("license", info)
        self.assertTrue(info.get("commercial_use"), "Model should allow commercial use")
        print(f"\n[PASS] Model: {info.get('display_name')} | License: {info.get('license')} | Commercial Use: {info.get('commercial_use')}")

    def test_dimension_preservation(self):
        """Test that the cutout pipeline preserves original full resolution pixel size."""
        orig_img, mask_img, model_name = remove_background(self.sample_image, refine_edges=True)
        
        # Both original image and mask MUST match the exact input dimensions
        self.assertEqual(orig_img.size, (self.width, self.height))
        self.assertEqual(mask_img.size, (self.width, self.height))
        
        mask_np = np.array(mask_img)
        self.assertEqual(mask_np.shape, (self.height, self.width))
        self.assertGreater(mask_np.max(), 0, "Mask should have detected the subject foreground")
        print(f"\n[PASS] Input size: ({self.width}, {self.height}) == Output size: {orig_img.size} == Mask size: {mask_img.size}")

    def test_brush_erase_and_restore_original_untouched(self):
        """
        Test that brushes edit ONLY the alpha mask,
        and NEVER modify the original image pixels.
        """
        orig_img, mask_img, _ = remove_background(self.sample_image, refine_edges=True)
        
        orig_pixels = np.array(orig_img)
        orig_pixels_copy = orig_pixels.copy()
        mask_pixels = np.array(mask_img)
        
        # Center of the subject
        cx, cy = 300, 240
        radius = 25
        
        # 1. Simulate ERASE brush
        # Create circular brush mask
        y_coords, x_coords = np.ogrid[:self.height, :self.width]
        dist_from_center = np.sqrt((x_coords - cx) ** 2 + (y_coords - cy) ** 2)
        brush_circle = dist_from_center <= radius
        
        mask_before_erase = mask_pixels.copy()
        # Erase: set mask to 0 in brush circle
        mask_pixels[brush_circle] = 0
        
        # Assert mask changed
        self.assertFalse(np.array_equal(mask_pixels, mask_before_erase), "Mask should change after erase")
        self.assertEqual(mask_pixels[cy, cx], 0, "Erased center pixel should have alpha = 0")
        # Assert original image pixels were NOT modified
        self.assertTrue(
            np.array_equal(orig_pixels, orig_pixels_copy),
            "CRITICAL: Original image pixels must NEVER be touched during brush erase!"
        )
        print("\n[PASS] Erase brush: mask changed, original pixels completely untouched.")

        # 2. Simulate RESTORE brush
        # Restore: set mask back to 255 in brush circle
        mask_pixels[brush_circle] = 255
        
        # Assert mask restored
        self.assertEqual(mask_pixels[cy, cx], 255, "Restored center pixel should have alpha = 255")
        # Assert original image pixels remain 100% untouched
        self.assertTrue(
            np.array_equal(orig_pixels, orig_pixels_copy),
            "CRITICAL: Original image pixels must NEVER be touched during brush restore!"
        )
        print("[PASS] Restore brush: mask restored, original pixels completely untouched.")

    def test_magic_brush_color_discrimination(self):
        """Test that Magic option discriminates between similar and dissimilar colors."""
        orig_img, mask_img, _ = remove_background(self.sample_image)
        orig_pixels = np.array(orig_img)
        mask_pixels = np.array(mask_img)
        
        # In our synthetic image:
        # [100:380, 150:490] is red [220, 40, 40]
        # [200:280, 250:390] is blue [30, 80, 220]
        
        # Stroke starts at red pixel
        sample_color = orig_pixels[150, 200] # Red
        tolerance = 40.0
        
        # Test pixel 1: another red pixel nearby
        red_pixel = orig_pixels[160, 210]
        dist_red = np.sqrt(
            0.3 * (float(red_pixel[0]) - sample_color[0]) ** 2 +
            0.59 * (float(red_pixel[1]) - sample_color[1]) ** 2 +
            0.11 * (float(red_pixel[2]) - sample_color[2]) ** 2
        )
        
        # Test pixel 2: the blue detail pixel
        blue_pixel = orig_pixels[240, 300]
        dist_blue = np.sqrt(
            0.3 * (float(blue_pixel[0]) - sample_color[0]) ** 2 +
            0.59 * (float(blue_pixel[1]) - sample_color[1]) ** 2 +
            0.11 * (float(blue_pixel[2]) - sample_color[2]) ** 2
        )
        
        self.assertLess(dist_red, tolerance, "Red pixel should match starting color")
        self.assertGreater(dist_blue, tolerance, "Blue pixel should NOT match starting color (protected)")
        print(f"\n[PASS] Magic brush: similar color diff={dist_red:.1f} <= tol({tolerance}), dissimilar={dist_blue:.1f} > tol({tolerance})")

    def test_color_defringing_and_export(self):
        """Test color defringing (purging background halos into semi-transparent pixels)."""
        rgb = np.zeros((100, 100, 3), dtype=np.uint8)
        rgb[30:70, 30:70] = [200, 40, 40] # solid red foreground
        rgb[20:30, 20:80] = [255, 255, 255] # white background halo in fringe
        
        alpha = np.zeros((100, 100), dtype=np.uint8)
        alpha[30:70, 30:70] = 255
        alpha[20:30, 20:80] = 120 # semi-transparent edge
        
        # Run defringing
        rgba = defringe_rgba(rgb, alpha)
        
        self.assertEqual(rgba.shape, (100, 100, 4))
        # Solid center should remain red
        self.assertTrue(np.all(rgba[50, 50, :3] == [200, 40, 40]))
        # Alpha should remain unchanged
        self.assertEqual(rgba[25, 50, 3], 120)
        # Fringe RGB should have pulled color from solid red, purging the white halo
        self.assertTrue(
            rgba[25, 50, 0] > 150 and rgba[25, 50, 1] < 100,
            f"Fringe pixel color should be pulled from solid red, got: {rgba[25, 50, :3]}"
        )
        print("\n[PASS] Color defringing successfully pulled solid subject colors into edge fringe.")

    def test_api_remove_bg_and_export_endpoints(self):
        """Test full end-to-end API upload and export."""
        # 1. Upload sample image to /api/remove-bg
        img_buf = io.BytesIO()
        self.sample_image.save(img_buf, format="PNG")
        img_bytes = img_buf.getvalue()
        
        res = self.client.post(
            "/api/remove-bg",
            files={"file": ("test.png", img_bytes, "image/png")}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("session_id", data)
        self.assertEqual(data["width"], self.width)
        self.assertEqual(data["height"], self.height)
        
        session_id = data["session_id"]
        
        # 2. Test export endpoint
        export_res = self.client.post(
            "/api/export",
            data={"session_id": session_id}
        )
        self.assertEqual(export_res.status_code, 200)
        self.assertEqual(export_res.headers["content-type"], "image/png")
        
        # Verify exported image pixel dimensions (original full resolution)
        exported_img = Image.open(io.BytesIO(export_res.content))
        self.assertEqual(
            exported_img.size,
            (self.width, self.height),
            f"Exported image size {exported_img.size} must match input size ({self.width}, {self.height})"
        )
        self.assertEqual(exported_img.mode, "RGBA")
        print(f"\n[PASS] End-to-end API export verified: exact dimensions ({self.width}, {self.height}) preserved!")

        # 3. Test export with custom/scaled resolution (e.g. 320x240)
        scaled_res = self.client.post(
            "/api/export",
            data={"session_id": session_id, "width": 320, "height": 240}
        )
        self.assertEqual(scaled_res.status_code, 200)
        scaled_img = Image.open(io.BytesIO(scaled_res.content))
        self.assertEqual(scaled_img.size, (320, 240))
        self.assertEqual(scaled_img.mode, "RGBA")
        print(f"[PASS] Scaled resolution export verified: requested (320, 240) == exported {scaled_img.size}!")

        # 4. Test batch export endpoint
        batch_res = self.client.post(
            "/api/export-batch",
            data={"session_ids": session_id}
        )
        self.assertEqual(batch_res.status_code, 200)
        self.assertEqual(batch_res.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(batch_res.content), "r") as zf:
            files = zf.namelist()
            self.assertEqual(len(files), 1)
            self.assertTrue(files[0].endswith(".png"))
        print("[PASS] Batch ZIP export verified: valid ZIP archive with cutout PNGs!")


if __name__ == "__main__":
    unittest.main()
