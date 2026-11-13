# ✂️ Cut-Out — Local AI Background Remover

A fast, private, 100% local web application that removes image backgrounds at full original resolution, featuring smart brush refinement (Restore & Erase with Magic edge preservation), color defringing, and tile-based undo history.

No cloud calls. No account. No watermark. Everything runs on your machine.

---

## 🌟 Key Features

1. **One-Screen Drop & Auto-Cutout**:
   - Big drop zone supporting PNG, JPG, and WebP.
   - Clipboard paste support (`Ctrl+V` / `Cmd+V`).
   - Background is removed automatically as soon as an image is loaded, with a live progress state.

2. **Full-Resolution Quality Preservation**:
   - Keeps the original uncompressed image and a separate full-resolution alpha mask.
   - Brushes edit **ONLY the alpha mask**, never touching the original pixels. Restore can always bring back pixels at 100% fidelity.
   - **Edge Refinement**: Employs a Fast Guided Filter guided by the original RGB image to snap edges to fine details (hair strands, fur, logos, and straight edges).
   - **Color Defringing**: On export, solid neighbouring colors are pulled into semi-transparent edge pixels, eliminating background halos.

3. **Multi-Image & Multi-Canvas Slide Support**:
   - Upload multiple images at once (multi-file drop or file selection).
   - **Simultaneous Multi-Canvas Grid**: Work on multiple cutouts side-by-side in the same window, erasing or restoring on any canvas directly without switching back and forth.
   - **Focus Mode**: Switch to single-canvas view with GPU zoom & pan for intricate pixel-level touch-ups.
   - Bottom slide filmstrip with thumbnail previews, dimension badges, active selection, and quick remove buttons.
   - "+ Add Slide" to inject additional images anytime into the current session.

4. **Restore Ghost Guide**:
   - In **RESTORE** mode, the erased areas automatically display a translucent ghost preview (35% opacity) of the original image with an opacity slider.
   - You can see exactly what details were erased and where you can paint to bring them back.

5. **Multi-Resolution Download & Batch ZIP**:
   - Download the active canvas at multiple resolutions:
     - **Original (100%)**: Exact pixel dimensions with color defringing.
     - **Large (2K / HD)**: High-resolution downscale with Lanczos resampling.
     - **Medium (Web 1080px)**: Optimized for web & presentations.
     - **Small (Thumbnail 512px)**: Lightweight icon/preview size.
   - **Batch Export**: "Download All Slides (ZIP)" packs all canvases with full color defringing and custom brush edits into a single ZIP file.

6. **Interactive Controls & Keyboard Shortcuts**:
   - Brush size slider with live circular cursor indicator (`[` / `]` shortcuts).
   - Edge softness slider for feathered falloff.
   - Tile-based Undo / Redo (`Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y`) storing only modified $128 \times 128$ image regions for low memory consumption and instant response even on 4K+ images.
   - Hardware-accelerated GPU Zoom & Pan (scroll wheel to zoom, `Space + Drag` to pan).
   - **Hold to Compare**: Press and hold the "Hold to Compare" button (or shortcut `C` / `\`) to view the original unedited image; releasing reverts to the cutout.
   - **Background Preview**: Toggle between Checkerboard (transparency), Solid White, Solid Black, or any Custom Color via color picker.
   - **Clean Neutral Themes**: Clean, modern zinc & charcoal dark mode and crisp slate light mode.

---

## 🤖 AI Model & Commercial License

Cut-Out uses `rembg` configured to use **BiRefNet** (`birefnet-general`) with automatic fallback to **U-2-Net** (`u2net`):

| Model | Architecture | License | Commercial Use |
| :--- | :--- | :--- | :--- |
| **BiRefNet** (`birefnet-general`) | Bilateral Reference for High-Resolution Segmentation | **MIT License** | **Allowed ✓** (No royalty fees; preserve copyright notice) |
| **U-2-Net** (`u2net`) | 2-Level Nested U-Structure for Saliency Detection | **Apache-2.0** | **Allowed ✓** (Standard open source commercial use; preserve license notice) |

> **Commercial Use Summary**: Both BiRefNet and U-2-Net can be freely used in commercial and closed-source products without licensing fees, provided the respective open-source copyright notices are retained in redistributions.

---

## 📁 Project Structure

```
Cut-Out/
├── app.py                     # FastAPI backend & one-command runner
├── requirements.txt           # Python package dependencies
├── core/
│   ├── __init__.py
│   ├── model.py               # BiRefNet / U-2-Net session management & fallback
│   ├── matting.py             # Fast Guided Filter alpha edge refinement
│   └── defringe.py            # Color defringing / halo removal algorithm
├── static/
│   ├── index.html             # Single-page UI with drop zone & editor
│   ├── style.css              # Light & Dark theme stylesheets
│   └── app.js                 # Canvas editor, Magic brush, tile undo, zoom/pan
├── tests/
│   ├── __init__.py
│   ├── test_pipeline.py       # Automated unit & integration tests
│   └── sample_run.py          # Demonstration script with verification checks
└── README.md                  # Documentation and guide
```

---

## 🚀 Quickstart (One-Command Run)

All dependencies are already installed in the local virtual environment (`.venv`).

You can run the web app with any of these methods:

### Option A: Direct one-line command
```bash
./run.sh
```

### Option B: Automatic venv switch
```bash
python3 app.py
```
*(The script automatically detects `.venv` and re-executes inside it)*

### Option C: Standard virtualenv activation
```bash
source .venv/bin/activate
python app.py
```

Then open your browser at:
👉 **[http://localhost:8000](http://localhost:8000)**

---

### 📦 Reinstalling Dependencies (if needed)

On modern Ubuntu / Debian systems with **PEP 668** (`externally-managed-environment`), always install packages into a virtual environment rather than system-wide Python:

```bash
# Activate the existing virtual environment:
source .venv/bin/activate

# Then run pip:
pip install -r requirements.txt
```

---

## 🧪 Running the Tests

To run the automated test suite verifying dimension preservation, brush mask editing, defringing, and API endpoints:

```bash
python -m unittest tests/test_pipeline.py -v
```

To run the end-to-end sample verification:
```bash
python tests/sample_run.py
```
