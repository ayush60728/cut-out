/**
 * Cut-Out — Multi-Slide / Multi-Canvas Application
 * - Simultaneous interactive canvases in a single window
 * - Add multiple images at once (slides / multi-card grid)
 * - Erase and Restore on any canvas simultaneously
 * - Select specific canvas to download in multiple resolutions
 * - Batch export all slides as ZIP
 * - Magic brush with color sampling
 * - Fast Guided Filter & Color Defringing on export
 */

(function () {
  "use strict";

  const TILE_SIZE = 128;
  const MAX_UNDO = 40;

  // Global Application State
  const state = {
    theme: localStorage.getItem("cutout_theme") || "dark",
    slides: [],            // Array of slide objects
    activeSlideIndex: 0,   // Currently selected slide
    viewMode: "grid",      // 'grid' (multi-canvas) or 'single' (focused)

    activeTool: "magic",   // 'restore', 'erase', 'magic', or 'auto'
    magic: true,
    brushSize: 40,
    brushSoftness: 0.25,
    magicTolerance: 35,
    ghostOpacity: 0.35,

    // Focused view zoom & pan
    zoom: 1.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    spaceDown: false,
    panStart: { x: 0, y: 0 },

    // Stroke state
    isDrawing: false,
    drawingSlide: null,
    lastPt: null,
    strokeStartPt: null,
    startColor: null,
    strokeDirtyTiles: null,
    shiftDown: false,
    ctrlDown: false,

    isComparing: false,
    activeBg: "checkerboard",
    customBg: "#3b82f6",

    modelInfo: null,

    // Custom Resolution export state
    customRes: {
      width: 0,
      height: 0,
      aspectLocked: true,
      scale: 1.0,
      format: "png",
      enhance: true,
    },
  };

  // Active Pointer Capture tracking for continuous drag
  let activePointerCaptureTarget = null;
  let activePointerId = null;

  // DOM Elements Cache
  const el = {
    body: document.body,
    uploadScreen: document.getElementById("uploadScreen"),
    dropZone: document.getElementById("dropZone"),
    fileInput: document.getElementById("fileInput"),
    addMoreInput: document.getElementById("addMoreInput"),
    loadingOverlay: document.getElementById("loadingOverlay"),
    loadingText: document.getElementById("loadingText"),
    loadingSubtext: document.getElementById("loadingSubtext"),

    editorScreen: document.getElementById("editorScreen"),
    editorControlsNav: document.getElementById("editorControlsNav"),
    canvasViewport: document.getElementById("canvasViewport"),
    canvasStage: document.getElementById("canvasStage"),
    multiCanvasGrid: document.getElementById("multiCanvasGrid"),
    slideBar: document.getElementById("slideBar"),
    slideList: document.getElementById("slideList"),
    btnAddSlideBar: document.getElementById("btnAddSlideBar"),
    brushCursor: document.getElementById("brushCursor"),
    brushCursorInner: document.querySelector(".brush-cursor-inner"),

    modelBadge: document.getElementById("modelBadge"),
    modelBadgeText: document.getElementById("modelBadgeText"),
    btnTheme: document.getElementById("btnTheme"),
    themeIcon: document.getElementById("themeIcon"),

    btnViewGrid: document.getElementById("btnViewGrid"),
    btnArrangeBoxes: document.getElementById("btnArrangeBoxes"),
    btnViewSingle: document.getElementById("btnViewSingle"),
    btnUndo: document.getElementById("btnUndo"),
    btnRedo: document.getElementById("btnRedo"),
    btnCompare: document.getElementById("btnCompare"),
    zoomGroup: document.getElementById("zoomGroup"),
    btnZoomIn: document.getElementById("btnZoomIn"),
    btnZoomOut: document.getElementById("btnZoomOut"),
    btnZoomFit: document.getElementById("btnZoomFit"),
    zoomLevelText: document.getElementById("zoomLevelText"),
    bgOptions: document.querySelectorAll(".bg-opt"),
    customBgColor: document.getElementById("customBgColor"),

    btnAddSlide: document.getElementById("btnAddSlide"),
    btnNewImage: document.getElementById("btnNewImage"),
    downloadWrapper: document.getElementById("downloadWrapper"),
    btnDownload: document.getElementById("btnDownload"),
    downloadBtnText: document.getElementById("downloadBtnText"),
    downloadMenu: document.getElementById("downloadMenu"),
    resolutionOptions: document.getElementById("resolutionOptions"),
    downloadPresetsView: document.getElementById("downloadPresetsView"),
    downloadCustomView: document.getElementById("downloadCustomView"),
    downloadMenuTitle: document.getElementById("downloadMenuTitle"),
    downloadSlideInfo: document.getElementById("downloadSlideInfo"),
    btnOpenCustomRes: document.getElementById("btnOpenCustomRes"),
    btnBackToPresets: document.getElementById("btnBackToPresets"),
    batchDownloadContainer: document.getElementById("batchDownloadContainer"),
    customResWidth: document.getElementById("customResWidth"),
    customResHeight: document.getElementById("customResHeight"),
    btnToggleAspectLock: document.getElementById("btnToggleAspectLock"),
    aspectLockIcon: document.getElementById("aspectLockIcon"),
    chkCustomEnhance: document.getElementById("chkCustomEnhance"),
    upscaleNote: document.getElementById("upscaleNote"),
    btnDownloadCustom: document.getElementById("btnDownloadCustom"),
    btnDownloadCustomText: document.getElementById("btnDownloadCustomText"),

    toolRestore: document.getElementById("toolRestore"),
    toolErase: document.getElementById("toolErase"),
    toolMagic: document.getElementById("toolMagic"),
    toolAutoColor: document.getElementById("toolAutoColor"),
    btnRunAi: document.getElementById("btnRunAi"),
    magicToleranceGroup: document.getElementById("magicToleranceGroup"),
    brushSize: document.getElementById("brushSize"),
    brushSizeVal: document.getElementById("brushSizeVal"),
    brushSoftness: document.getElementById("brushSoftness"),
    brushSoftnessVal: document.getElementById("brushSoftnessVal"),
    magicTolerance: document.getElementById("magicTolerance"),
    magicToleranceVal: document.getElementById("magicToleranceVal"),
    ghostOpacityGroup: document.getElementById("ghostOpacityGroup"),
    ghostOpacity: document.getElementById("ghostOpacity"),
    ghostOpacityVal: document.getElementById("ghostOpacityVal"),

    infoModal: document.getElementById("infoModal"),
    modalClose: document.getElementById("modalClose"),
    modalContent: document.getElementById("modalContent"),
  };

  // ==========================================
  // TAB REFRESH PERSISTENCE (IndexedDB + sessionStorage)
  // - Preserves workspace, slides, masks, and edits across tab refresh (F5 / Ctrl+R)
  // - Automatically cleared when tab is closed or when clicking Reset
  // ==========================================

  const DB_NAME = "CutOut_Workspace_DB";
  const DB_VERSION = 1;
  const STORE_NAME = "workspace_sessions";

  function openSessionDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        return reject(new Error("IndexedDB not supported in this browser"));
      }
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function clearSessionDB() {
    try {
      sessionStorage.removeItem("cutout_has_active_workspace");
      sessionStorage.removeItem("cutout_tab_session_id");
      const db = await openSessionDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = rej;
      });
    } catch (err) {
      console.warn("Could not clear session DB:", err);
    }
  }

  let isSavingSession = false;
  let sessionSavePending = false;
  let saveSessionDebounce = null;

  function scheduleSessionSave(delay = 250) {
    if (saveSessionDebounce) clearTimeout(saveSessionDebounce);
    saveSessionDebounce = setTimeout(() => {
      saveSessionToDB();
    }, delay);
  }

  async function saveSessionToDB() {
    if (state.slides.length === 0) {
      await clearSessionDB();
      return;
    }
    if (isSavingSession) {
      sessionSavePending = true;
      return;
    }
    isSavingSession = true;

    try {
      let tabId = sessionStorage.getItem("cutout_tab_session_id");
      if (!tabId) {
        tabId = "tab_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem("cutout_tab_session_id", tabId);
      }

      // Convert each slide to serializable format with image Blobs
      const serializedSlides = await Promise.all(
        state.slides.map(async (slide) => {
          const origBlob = await new Promise((res) => slide.origCanvas.toBlob(res, "image/png"));
          const maskBlob = await new Promise((res) => slide.maskCanvas.toBlob(res, "image/png"));
          return {
            id: slide.id,
            sessionId: slide.sessionId,
            filename: slide.filename,
            width: slide.width,
            height: slide.height,
            origBlob: origBlob,
            maskBlob: maskBlob,
            posX: slide.posX,
            posY: slide.posY,
            width_px: slide.width_px,
            height_px: slide.height_px,
            isMaximized: !!slide.isMaximized,
            zIndex: slide.zIndex || 1,
            zoom: slide.zoom || 1.0,
            panX: slide.panX || 0,
            panY: slide.panY || 0,
          };
        })
      );

      const record = {
        id: tabId,
        timestamp: Date.now(),
        activeSlideIndex: state.activeSlideIndex,
        viewMode: state.viewMode,
        activeTool: state.activeTool,
        brushSize: state.brushSize,
        brushSoftness: state.brushSoftness,
        magicTolerance: state.magicTolerance,
        magic: state.magic,
        activeBg: state.activeBg,
        customBg: state.customBg,
        slides: serializedSlides,
      };

      const db = await openSessionDB();
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      await new Promise((res, rej) => {
        tx.oncomplete = res;
        tx.onerror = rej;
      });

      sessionStorage.setItem("cutout_has_active_workspace", "1");
    } catch (err) {
      console.warn("Error saving session to DB:", err);
    } finally {
      isSavingSession = false;
      if (sessionSavePending) {
        sessionSavePending = false;
        scheduleSessionSave(100);
      }
    }
  }

  function loadBlobAsImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  function showRestoredToast(msg) {
    let toast = document.querySelector(".session-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "session-toast";
      toast.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        <span class="session-toast-msg"></span>
      `;
      document.body.appendChild(toast);
    }
    toast.querySelector(".session-toast-msg").textContent = msg;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
  }

  async function checkAndRestoreTabSession() {
    const hasActiveWorkspace = sessionStorage.getItem("cutout_has_active_workspace");
    const tabId = sessionStorage.getItem("cutout_tab_session_id");

    // If tab has no active workspace marker (e.g. freshly opened tab or after tab close),
    // stay clean on the upload dropzone!
    if (!hasActiveWorkspace || !tabId) {
      return;
    }

    try {
      const db = await openSessionDB();
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(tabId);

      const record = await new Promise((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });

      if (!record || !record.slides || record.slides.length === 0) {
        return;
      }

      el.loadingOverlay.style.display = "flex";
      el.loadingText.textContent = "Restoring Your Workspace...";
      el.loadingSubtext.textContent = `Restoring ${record.slides.length} canvas${record.slides.length > 1 ? "es" : ""} and your edits`;

      state.slides = [];
      for (const s of record.slides) {
        const [origImg, maskImg] = await Promise.all([
          loadBlobAsImage(s.origBlob),
          loadBlobAsImage(s.maskBlob),
        ]);

        const w = s.width;
        const h = s.height;

        // 1. Original RGB buffer
        const oCanvas = document.createElement("canvas");
        oCanvas.width = w;
        oCanvas.height = h;
        const oCtx = oCanvas.getContext("2d", { willReadFrequently: true });
        oCtx.drawImage(origImg, 0, 0, w, h);
        const oData = oCtx.getImageData(0, 0, w, h);

        // 2. Full-resolution Mask buffer
        const mCanvas = document.createElement("canvas");
        mCanvas.width = w;
        mCanvas.height = h;
        const mCtx = mCanvas.getContext("2d", { willReadFrequently: true });
        mCtx.drawImage(maskImg, 0, 0, w, h);
        const mData = mCtx.getImageData(0, 0, w, h);

        // 3. Viewport Display Canvas
        const vCanvas = document.createElement("canvas");
        vCanvas.width = w;
        vCanvas.height = h;
        const vCtx = vCanvas.getContext("2d", { willReadFrequently: true });
        const vData = vCtx.createImageData(w, h);

        const slide = {
          id: s.id,
          sessionId: s.sessionId || ("sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8)),
          filename: s.filename,
          width: w,
          height: h,
          origCanvas: oCanvas,
          origCtx: oCtx,
          origImageData: oData,
          maskCanvas: mCanvas,
          maskCtx: mCtx,
          maskImageData: mData,
          viewCanvas: vCanvas,
          viewCtx: vCtx,
          viewImageData: vData,
          undoStack: [],
          redoStack: [],
          posX: s.posX,
          posY: s.posY,
          width_px: s.width_px,
          height_px: s.height_px,
          isMaximized: !!s.isMaximized,
          zIndex: s.zIndex || 1,
          zoom: s.zoom || 1.0,
          panX: s.panX || 0,
          panY: s.panY || 0,
        };

        compositeSlide(slide);
        state.slides.push(slide);
      }

      state.activeSlideIndex = Math.min(record.activeSlideIndex || 0, state.slides.length - 1);
      if (record.viewMode) state.viewMode = record.viewMode;
      if (record.activeTool) setTool(record.activeTool);
      if (record.brushSize) {
        state.brushSize = record.brushSize;
        if (el.brushSize) el.brushSize.value = record.brushSize;
        if (el.brushSizeVal) el.brushSizeVal.textContent = `${record.brushSize}px`;
      }
      if (record.brushSoftness != null) {
        state.brushSoftness = record.brushSoftness;
        if (el.brushSoftness) el.brushSoftness.value = Math.round(record.brushSoftness * 100);
        if (el.brushSoftnessVal) el.brushSoftnessVal.textContent = `${Math.round(record.brushSoftness * 100)}%`;
      }
      if (record.magicTolerance != null) {
        state.magicTolerance = record.magicTolerance;
        if (el.magicTolerance) el.magicTolerance.value = record.magicTolerance;
        if (el.magicToleranceVal) el.magicToleranceVal.textContent = record.magicTolerance;
      }
      if (record.magic != null) {
        state.magic = record.magic;
        if (el.chkMagic) el.chkMagic.checked = record.magic;
      }
      if (record.activeBg) {
        state.activeBg = record.activeBg;
        el.bgOptions.forEach((opt) => opt.classList.toggle("active", opt.dataset.bg === record.activeBg));
        setPreviewBackground(record.activeBg, record.customBg);
      }
      if (record.customBg && el.customBgColor) {
        state.customBg = record.customBg;
        el.customBgColor.value = record.customBg;
      }

      // Transition to Editor screen
      el.uploadScreen.style.display = "none";
      el.editorScreen.style.display = "flex";
      el.editorControlsNav.style.display = "flex";
      el.btnAddSlide.style.display = "inline-flex";
      el.btnNewImage.style.display = "inline-flex";
      el.downloadWrapper.style.display = "inline-flex";
      el.slideBar.style.display = "flex";

      renderMultiCanvasGrid();
      renderSlideBar();
      updateSelectedSlideUI();
      setViewMode(state.viewMode || "grid");
      updateCursorDimensions();

      showRestoredToast(`Restored ${state.slides.length} canvas${state.slides.length > 1 ? "es" : ""} from current session`);
    } catch (err) {
      console.error("Error restoring tab session:", err);
    } finally {
      el.loadingOverlay.style.display = "none";
    }
  }

  // ==========================================
  // INITIALIZATION & THEME
  // ==========================================

  async function init() {
    applyTheme(state.theme);
    bindEvents();
    fetchModelInfo();
    await checkAndRestoreTabSession();
  }

  function applyTheme(theme) {
    state.theme = theme;
    el.body.setAttribute("data-theme", theme);
    localStorage.setItem("cutout_theme", theme);
    if (theme === "dark") {
      el.themeIcon.innerHTML = `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>`;
    } else {
      el.themeIcon.innerHTML = `<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>`;
    }
  }

  async function fetchModelInfo() {
    try {
      const res = await fetch("/api/info");
      if (res.ok) {
        state.modelInfo = await res.json();
        const name = state.modelInfo.display_name || state.modelInfo.model_name;
        el.modelBadgeText.textContent = name;
      }
    } catch (e) {
      console.warn("Could not load model info:", e);
    }
  }

  // ==========================================
  // EVENT BINDINGS
  // ==========================================

  function bindEvents() {
    el.btnTheme.addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });

    el.modelBadge.addEventListener("click", showModelInfoModal);
    el.modalClose.addEventListener("click", () => {
      el.infoModal.style.display = "none";
    });
    el.infoModal.addEventListener("click", (e) => {
      if (e.target === el.infoModal) el.infoModal.style.display = "none";
    });

    // File inputs & Drop zone
    el.dropZone.addEventListener("click", () => el.fileInput.click());
    el.fileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleIncomingFiles(Array.from(e.target.files));
      }
    });

    // Add Slide button in header & slidebar
    el.btnAddSlide.addEventListener("click", () => el.addMoreInput.click());
    el.btnAddSlideBar.addEventListener("click", () => el.addMoreInput.click());
    el.addMoreInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleIncomingFiles(Array.from(e.target.files));
      }
    });

    ["dragenter", "dragover"].forEach((evt) => {
      window.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (el.uploadScreen.style.display !== "none") {
          el.dropZone.classList.add("dragover");
        }
      });
    });

    ["dragleave", "drop"].forEach((evt) => {
      window.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.dropZone.classList.remove("dragover");
      });
    });

    window.addEventListener("drop", (e) => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length > 0) {
        handleIncomingFiles(Array.from(files));
      }
    });

    // Clipboard paste support (Ctrl+V)
    window.addEventListener("paste", (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      const files = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const file = items[i].getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        handleIncomingFiles(files);
      }
    });

    // Navigation & View Mode
    el.btnViewGrid.addEventListener("click", () => setViewMode("grid"));
    if (el.btnArrangeBoxes) el.btnArrangeBoxes.addEventListener("click", arrangeBoxesInGrid);
    el.btnViewSingle.addEventListener("click", () => setViewMode("single"));

    el.btnNewImage.addEventListener("click", resetAll);

    // Download Menu Toggle & Custom Resolution Controls
    el.btnDownload.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDownloadMenu();
    });

    document.addEventListener("click", (e) => {
      if (el.downloadWrapper && !el.downloadWrapper.contains(e.target)) {
        closeDownloadMenu();
      }
    });

    if (el.btnOpenCustomRes) {
      el.btnOpenCustomRes.addEventListener("click", (e) => {
        e.stopPropagation();
        openCustomResolutionView();
      });
    }

    if (el.btnBackToPresets) {
      el.btnBackToPresets.addEventListener("click", (e) => {
        e.stopPropagation();
        backToPresetsView();
      });
    }

    if (el.customResWidth) {
      el.customResWidth.addEventListener("input", onCustomWidthInput);
    }

    if (el.customResHeight) {
      el.customResHeight.addEventListener("input", onCustomHeightInput);
    }

    if (el.btnToggleAspectLock) {
      el.btnToggleAspectLock.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleAspectLock();
      });
    }

    document.querySelectorAll(".scale-pill").forEach((pill) => {
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        const sc = parseFloat(pill.dataset.scale);
        if (!isNaN(sc)) applyScalePreset(sc);
      });
    });

    document.querySelectorAll(".format-chip").forEach((chip) => {
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        setCustomFormat(chip.dataset.format);
      });
    });

    if (el.chkCustomEnhance) {
      el.chkCustomEnhance.addEventListener("change", (e) => {
        state.customRes.enhance = e.target.checked;
        updateCustomDownloadButtonUI();
      });
    }

    if (el.btnDownloadCustom) {
      el.btnDownloadCustom.addEventListener("click", (e) => {
        e.stopPropagation();
        downloadCustomResolution();
      });
    }

    // Tools (Mutually exclusive: only one selected at once)
    el.toolRestore.addEventListener("click", () => setTool("restore"));
    el.toolErase.addEventListener("click", () => setTool("erase"));
    if (el.toolMagic) {
      el.toolMagic.addEventListener("click", () => setTool("magic"));
    }
    if (el.toolAutoColor) {
      el.toolAutoColor.addEventListener("click", () => setTool("auto"));
    }
    if (el.btnRunAi) {
      el.btnRunAi.addEventListener("click", runAiCutoutForActiveSlide);
    }

    el.brushSize.addEventListener("input", (e) => {
      state.brushSize = parseInt(e.target.value, 10);
      el.brushSizeVal.textContent = `${state.brushSize}px`;
      updateCursorDimensions();
    });

    el.brushSoftness.addEventListener("input", (e) => {
      state.brushSoftness = parseInt(e.target.value, 10) / 100.0;
      el.brushSoftnessVal.textContent = `${e.target.value}%`;
      updateCursorDimensions();
    });

    el.magicTolerance.addEventListener("input", (e) => {
      state.magicTolerance = parseInt(e.target.value, 10);
      el.magicToleranceVal.textContent = e.target.value;
    });

    if (el.ghostOpacity) {
      el.ghostOpacity.addEventListener("input", (e) => {
        state.ghostOpacity = parseInt(e.target.value, 10) / 100.0;
        if (el.ghostOpacityVal) el.ghostOpacityVal.textContent = `${e.target.value}%`;
        compositeAllSlides();
      });
    }

    // Undo / Redo for active slide
    el.btnUndo.addEventListener("click", undoActiveSlide);
    el.btnRedo.addEventListener("click", redoActiveSlide);

    // Background preview selection
    el.bgOptions.forEach((btn) => {
      btn.addEventListener("click", () => {
        el.bgOptions.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        setPreviewBackground(btn.dataset.bg);
      });
    });

    el.customBgColor.addEventListener("input", (e) => {
      el.bgOptions.forEach((b) => b.classList.remove("active"));
      setPreviewBackground("custom", e.target.value);
    });

    // Hold to compare
    el.btnCompare.addEventListener("mousedown", startCompare);
    window.addEventListener("mouseup", endCompare);
    el.btnCompare.addEventListener("touchstart", (e) => {
      e.preventDefault();
      startCompare();
    });
    window.addEventListener("touchend", endCompare);

    // Zoom controls
    el.btnZoomIn.addEventListener("click", () => zoomStep(1.2));
    el.btnZoomOut.addEventListener("click", () => zoomStep(1 / 1.2));
    el.btnZoomFit.addEventListener("click", fitToViewport);

    // Canvas Pointer events on Focused Stage
    const vp = el.canvasViewport;
    vp.addEventListener("wheel", handleWheelZoom, { passive: false });
    vp.addEventListener("pointerdown", handleFocusedPointerDown);
    window.addEventListener("pointermove", handleGlobalPointerMove, { passive: false });
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
    if (el.viewCanvas) {
      el.viewCanvas.draggable = false;
      el.viewCanvas.addEventListener("dragstart", (e) => e.preventDefault());
    }

    vp.addEventListener("mouseenter", () => {
      if (!state.spaceDown && !state.isPanning) {
        el.brushCursor.style.display = "block";
      }
    });
    vp.addEventListener("mouseleave", () => {
      el.brushCursor.style.display = "none";
    });

    // Keyboard Shortcuts
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
  }

  // ==========================================
  // MULTI-IMAGE INTAKE & BACKGROUND REMOVAL
  // ==========================================

  async function handleIncomingFiles(fileList) {
    const validFiles = fileList.filter((f) =>
      f.type.match(/^image\/(png|jpeg|jpg|webp)$/i)
    );
    if (validFiles.length === 0) {
      alert("Please upload PNG, JPG, or WebP images.");
      return;
    }

    el.loadingOverlay.style.display = "flex";

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      el.loadingText.textContent = `Loading image (${i + 1} of ${validFiles.length})...`;
      el.loadingSubtext.textContent = `Preparing: ${file.name}`;

      try {
        await processSingleFile(file);
      } catch (err) {
        console.error("Error processing file:", file.name, err);
      }
    }

    el.loadingOverlay.style.display = "none";

    if (state.slides.length > 0) {
      // Transition to Editor screen
      el.uploadScreen.style.display = "none";
      el.editorScreen.style.display = "flex";
      el.editorControlsNav.style.display = "flex";
      el.btnAddSlide.style.display = "inline-flex";
      el.btnNewImage.style.display = "inline-flex";
      el.downloadWrapper.style.display = "inline-flex";
      el.slideBar.style.display = "flex";

      renderMultiCanvasGrid();
      renderSlideBar();
      updateSelectedSlideUI();
      setViewMode("grid");
      updateCursorDimensions();
      scheduleSessionSave();
    }
  }

  async function processSingleFile(file) {
    let data = null;

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/load-image", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        data = await res.json();
      }
    } catch (_) {
      // Backend not running (Cloudflare Pages static hosting)
    }

    if (data && data.image_url && data.mask_url) {
      const w = data.width;
      const h = data.height;

      if (data.model_used && data.model_used !== "none" && el.modelBadgeText) {
        el.modelBadgeText.textContent = data.model_used.includes("birefnet")
          ? "BiRefNet"
          : "U-2-Net";
      }

      const [origImg, maskImg] = await Promise.all([
        loadImageAsync(data.image_url),
        loadImageAsync(data.mask_url),
      ]);

      createSlideFromImages(file, w, h, origImg, maskImg, data.session_id);
    } else {
      // Instant Client-side loading (no backend required!)
      await loadFileLocally(file);
    }
  }

  function createSlideFromImages(file, w, h, origImg, maskImg, sessionId) {
    const slideId = "slide_" + Math.random().toString(36).substr(2, 9);
    const filename = file.name.replace(/\.[^/.]+$/, "");

    const oCanvas = document.createElement("canvas");
    oCanvas.width = w;
    oCanvas.height = h;
    const oCtx = oCanvas.getContext("2d", { willReadFrequently: true });
    oCtx.drawImage(origImg, 0, 0, w, h);
    const oData = oCtx.getImageData(0, 0, w, h);

    const mCanvas = document.createElement("canvas");
    mCanvas.width = w;
    mCanvas.height = h;
    const mCtx = mCanvas.getContext("2d", { willReadFrequently: true });
    mCtx.drawImage(maskImg, 0, 0, w, h);
    const mData = mCtx.getImageData(0, 0, w, h);

    const vCanvas = document.createElement("canvas");
    vCanvas.width = w;
    vCanvas.height = h;
    const vCtx = vCanvas.getContext("2d", { willReadFrequently: true });
    const vData = vCtx.createImageData(w, h);

    const slide = {
      id: slideId,
      sessionId: sessionId || slideId,
      filename: filename,
      width: w,
      height: h,
      origCanvas: oCanvas,
      origCtx: oCtx,
      origImageData: oData,
      maskCanvas: mCanvas,
      maskCtx: mCtx,
      maskImageData: mData,
      viewCanvas: vCanvas,
      viewCtx: vCtx,
      viewImageData: vData,
      undoStack: [],
      redoStack: [],
      zoom: 1.0,
      panX: 0,
      panY: 0,
    };

    compositeSlide(slide);
    state.slides.push(slide);
    state.activeSlideIndex = state.slides.length - 1;
  }

  async function loadFileLocally(file) {
    const objectUrl = URL.createObjectURL(file);
    const img = await loadImageAsync(objectUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    URL.revokeObjectURL(objectUrl);

    const slideId = "slide_" + Math.random().toString(36).substr(2, 9);
    const filename = file.name.replace(/\.[^/.]+$/, "");

    const oCanvas = document.createElement("canvas");
    oCanvas.width = w;
    oCanvas.height = h;
    const oCtx = oCanvas.getContext("2d", { willReadFrequently: true });
    oCtx.drawImage(img, 0, 0, w, h);
    const oData = oCtx.getImageData(0, 0, w, h);

    const mCanvas = document.createElement("canvas");
    mCanvas.width = w;
    mCanvas.height = h;
    const mCtx = mCanvas.getContext("2d", { willReadFrequently: true });
    mCtx.fillStyle = "#ffffff";
    mCtx.fillRect(0, 0, w, h);
    const mData = mCtx.getImageData(0, 0, w, h);

    const vCanvas = document.createElement("canvas");
    vCanvas.width = w;
    vCanvas.height = h;
    const vCtx = vCanvas.getContext("2d", { willReadFrequently: true });
    const vData = vCtx.createImageData(w, h);

    const slide = {
      id: slideId,
      sessionId: slideId,
      filename: filename,
      width: w,
      height: h,
      origCanvas: oCanvas,
      origCtx: oCtx,
      origImageData: oData,
      maskCanvas: mCanvas,
      maskCtx: mCtx,
      maskImageData: mData,
      viewCanvas: vCanvas,
      viewCtx: vCtx,
      viewImageData: vData,
      undoStack: [],
      redoStack: [],
      zoom: 1.0,
      panX: 0,
      panY: 0,
    };

    compositeSlide(slide);
    state.slides.push(slide);
    state.activeSlideIndex = state.slides.length - 1;

    if (el.modelBadgeText && !state.modelInfo) {
      el.modelBadgeText.textContent = "Web AI (Ready)";
    }
  }

  function loadImageAsync(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  // ==========================================
  // COMPOSITING ENGINE
  // ==========================================

  function compositeSlide(slide) {
    const oData = slide.origImageData.data;
    const mData = slide.maskImageData.data;
    const vData = slide.viewImageData.data;
    const len = oData.length;
    const isRestore = state.activeTool === "restore";
    const ghostAlpha = Math.round(state.ghostOpacity * 255);

    for (let i = 0; i < len; i += 4) {
      vData[i] = oData[i];
      vData[i + 1] = oData[i + 1];
      vData[i + 2] = oData[i + 2];
      const m = mData[i];
      vData[i + 3] = isRestore ? Math.max(m, ghostAlpha) : m;
    }

    slide.viewCtx.putImageData(slide.viewImageData, 0, 0);
  }

  function compositeSlideRegion(slide, x, y, w, h) {
    const minX = Math.max(0, Math.floor(x));
    const minY = Math.max(0, Math.floor(y));
    const maxX = Math.min(slide.width, Math.ceil(x + w));
    const maxY = Math.min(slide.height, Math.ceil(y + h));
    const rw = maxX - minX;
    const rh = maxY - minY;
    if (rw <= 0 || rh <= 0) return;

    const oData = slide.origImageData.data;
    const mData = slide.maskImageData.data;
    const vData = slide.viewImageData.data;
    const stride = slide.width * 4;
    const isRestore = state.activeTool === "restore";
    const ghostAlpha = Math.round(state.ghostOpacity * 255);

    for (let cy = minY; cy < maxY; cy++) {
      let rowOffset = cy * stride;
      for (let cx = minX; cx < maxX; cx++) {
        let i = rowOffset + (cx << 2);
        vData[i] = oData[i];
        vData[i + 1] = oData[i + 1];
        vData[i + 2] = oData[i + 2];
        const m = mData[i];
        vData[i + 3] = isRestore ? Math.max(m, ghostAlpha) : m;
      }
    }

    slide.viewCtx.putImageData(slide.viewImageData, 0, 0, minX, minY, rw, rh);
  }

  function compositeAllSlides() {
    state.slides.forEach((s) => compositeSlide(s));
  }

  // ==========================================
  // MULTI-CANVAS DRAGGABLE WORKSPACE & CARDS
  // ==========================================

  function bringCardToFront(card, slide) {
    state.maxZ = (state.maxZ || 20) + 1;
    card.style.zIndex = state.maxZ;
    if (slide) slide.zIndex = state.maxZ;
  }

  function getInitialSlidePosition(idx) {
    const container = el.multiCanvasGrid;
    const cWidth = container ? container.clientWidth || 1200 : 1200;
    const cHeight = container ? container.clientHeight || 700 : 700;

    const cardW = 480;
    const cardH = 390;
    const margin = 24;
    const gap = 24;

    // Single image uploaded: center the exact same draggable window frame (480x390) in the workspace
    if (state.slides.length === 1) {
      const x = Math.max(24, Math.round((cWidth - cardW) / 2));
      const y = Math.max(24, Math.round((cHeight - cardH) / 2) - 15);
      return { x, y, w: cardW, h: cardH };
    }

    const cols = Math.max(1, Math.floor((cWidth - margin * 2 + gap) / (cardW + gap)));
    const col = idx % cols;
    const row = Math.floor(idx / cols);

    const x = margin + col * (cardW + gap);
    const y = margin + row * (cardH + gap);
    return { x, y, w: cardW, h: cardH };
  }

  function arrangeBoxesInGrid() {
    // If currently in single canvas focus view, switch back to grid view first!
    if (state.viewMode !== "grid") {
      setViewMode("grid");
    }
    state.slides.forEach((slide, idx) => {
      const pos = getInitialSlidePosition(idx);
      slide.posX = pos.x;
      slide.posY = pos.y;
      slide.width_px = pos.w;
      slide.height_px = pos.h;
      slide.isMaximized = false;
    });
    renderMultiCanvasGrid();
    scheduleSessionSave();
  }

  function toggleSlideFullscreen(slide, card, btnFs) {
    const isNowFs = !card.classList.contains("fullscreen-box");
    if (isNowFs) {
      // Exit fullscreen on any other card first
      document.querySelectorAll(".slide-card.fullscreen-box").forEach((c) => {
        c.classList.remove("fullscreen-box");
        const sIdx = parseInt(c.dataset.slideIndex, 10);
        if (state.slides[sIdx]) state.slides[sIdx].isMaximized = false;
        const b = c.querySelector(".btn-fullscreen");
        if (b) {
          b.title = "Full Screen Box";
          b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
        }
      });

      card.classList.add("fullscreen-box");
      slide.isMaximized = true;
      if (btnFs) {
        btnFs.title = "Exit Full Screen (Esc)";
        btnFs.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
      }
    } else {
      card.classList.remove("fullscreen-box");
      slide.isMaximized = false;
      card.style.left = `${slide.posX}px`;
      card.style.top = `${slide.posY}px`;
      card.style.width = `${slide.width_px}px`;
      card.style.height = `${slide.height_px}px`;
      if (btnFs) {
        btnFs.title = "Full Screen Box";
        btnFs.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
      }
    }
    const idx = parseInt(card.dataset.slideIndex, 10);
    setActiveSlide(idx);
    bringCardToFront(card, slide);
    scheduleSessionSave();
  }

  function resetSlide(idx) {
    const slide = state.slides[idx];
    if (!slide) return;

    setActiveSlide(idx);

    // 1. Capture beforeTiles for Undo so this reset can be undone with Ctrl+Z!
    const beforeTiles = captureAllSlideTiles(slide);

    // 2. Revert mask to 100% opaque (255) for all pixels, restoring original image
    const mData = slide.maskImageData.data;
    const len = mData.length;
    for (let i = 0; i < len; i += 4) {
      mData[i] = 255;
      mData[i + 1] = 255;
      mData[i + 2] = 255;
      mData[i + 3] = 255;
    }
    slide.maskCtx.putImageData(slide.maskImageData, 0, 0);

    // 3. Reset zoom and pan for this slide
    slide.zoom = 1.0;
    slide.panX = 0;
    slide.panY = 0;
    if (slide.viewCanvas) {
      slide.viewCanvas.style.transform = "none";
    }

    // 4. Update zoom badge on the card
    const card = document.querySelector(`.slide-card[data-slide-index="${idx}"]`);
    if (card) {
      const zoomBadge = card.querySelector(".slide-zoom-badge");
      if (zoomBadge) zoomBadge.style.display = "none";
    }

    // 5. Re-composite slide view
    compositeSlide(slide);

    // 6. Push to undo stack
    pushWholeImageUndo(slide, beforeTiles);

    // 7. If in single view mode, refresh stage
    if (state.viewMode === "single") {
      fitToViewport();
    }

    // 8. Visual confirmation toast
    showRestoredToast(`Reset #${idx + 1} ${slide.filename} back to original`);

    // 9. Persist session
    scheduleSessionSave();
  }

  function renderMultiCanvasGrid() {
    const container = el.multiCanvasGrid;
    container.innerHTML = "";

    state.slides.forEach((slide, idx) => {
      const isActive = idx === state.activeSlideIndex;
      const card = document.createElement("div");
      card.className = `slide-card ${isActive ? "active" : ""}`;
      card.dataset.slideIndex = idx;

      // Assign position and size if not already set
      if (slide.posX == null || slide.posY == null) {
        const initPos = getInitialSlidePosition(idx);
        slide.posX = initPos.x;
        slide.posY = initPos.y;
        slide.width_px = initPos.w;
        slide.height_px = initPos.h;
      }

      if (slide.isMaximized) {
        card.classList.add("fullscreen-box");
      } else {
        card.style.left = `${slide.posX}px`;
        card.style.top = `${slide.posY}px`;
        card.style.width = `${slide.width_px}px`;
        card.style.height = `${slide.height_px}px`;
      }

      if (slide.zIndex) {
        card.style.zIndex = slide.zIndex;
      }

      card.innerHTML = `
        <div class="slide-card-header">
          <div class="slide-card-title">
            <span class="slide-drag-handle" title="Drag to move box">⠿</span>
            <input type="radio" name="slideRadioGroup" class="slide-radio" ${isActive ? "checked" : ""}>
            <span class="slide-name" title="${slide.filename}">#${idx + 1} ${slide.filename}</span>
            <span class="slide-res-tag">${slide.width}×${slide.height}</span>
          </div>
          <div class="slide-card-actions">
            <button class="slide-zoom-badge" style="display: none;" title="Current zoom level. Click to reset (100%)">100%</button>
            <button class="slide-action-btn btn-reset-slide" title="Reset image: Revert all edits and cutouts back to original">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
            </button>
            <button class="slide-action-btn btn-fullscreen" title="${slide.isMaximized ? "Exit Full Screen (Esc)" : "Full Screen Box"}">
              ${slide.isMaximized
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`
              }
            </button>
            <button class="slide-action-btn btn-focus" title="Expand to Dedicated Focus View">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="3"/><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>
            </button>
            <button class="slide-action-btn btn-dl" title="Download this Canvas">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button class="slide-action-btn btn-del" title="Remove Slide">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div class="slide-card-body"></div>
        <div class="slide-card-resize-handle" title="Drag to resize box"></div>
      `;

      const body = card.querySelector(".slide-card-body");
      const activeBgClass =
        state.activeBg === "checkerboard" ? "bg-checkerboard" :
        state.activeBg === "white" ? "bg-white" :
        state.activeBg === "black" ? "bg-black" : "bg-checkerboard";
      body.classList.add(activeBgClass);
      if (state.activeBg === "custom" && state.customBg) {
        body.style.backgroundColor = state.customBg;
      }
      // Mount this slide's canvas directly into the card body
      body.appendChild(slide.viewCanvas);

      const header = card.querySelector(".slide-card-header");
      const btnResetSlide = card.querySelector(".btn-reset-slide");
      const btnFs = card.querySelector(".btn-fullscreen");
      const btnFocus = card.querySelector(".btn-focus");
      const btnDl = card.querySelector(".btn-dl");
      const btnDel = card.querySelector(".btn-del");
      const resizeHandle = card.querySelector(".slide-card-resize-handle");

      // Reset all edits on this slide back to original
      btnResetSlide.addEventListener("click", (e) => {
        e.stopPropagation();
        resetSlide(idx);
      });

      // Clicking anywhere on card activates and brings to front
      card.addEventListener("pointerdown", () => {
        setActiveSlide(idx);
        bringCardToFront(card, slide);
      });

      // Fullscreen toggle
      btnFs.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleSlideFullscreen(slide, card, btnFs);
      });

      // Double-click header to toggle fullscreen
      header.addEventListener("dblclick", (e) => {
        if (e.target.closest("button") || e.target.closest("input")) return;
        toggleSlideFullscreen(slide, card, btnFs);
      });

      btnFocus.addEventListener("click", (e) => {
        e.stopPropagation();
        setActiveSlide(idx);
        setViewMode("single");
      });

      btnDl.addEventListener("click", (e) => {
        e.stopPropagation();
        setActiveSlide(idx);
        openDownloadMenu();
      });

      btnDel.addEventListener("click", (e) => {
        e.stopPropagation();
        removeSlide(idx);
      });

      // DRAGGABLE BOX BEHAVIOR (Dragging via header)
      header.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button") || e.target.closest("input")) return;
        if (card.classList.contains("fullscreen-box")) return;

        setActiveSlide(idx);
        bringCardToFront(card, slide);

        const startX = e.clientX;
        const startY = e.clientY;
        const initLeft = slide.posX;
        const initTop = slide.posY;

        card.classList.add("is-dragging");

        function onPointerMove(me) {
          const dx = me.clientX - startX;
          const dy = me.clientY - startY;

          let nextLeft = initLeft + dx;
          let nextTop = initTop + dy;

          // Viewport bounds clamp
          const minX = -slide.width_px + 80;
          const maxX = Math.max(10, container.clientWidth - 80);
          const minY = 0;
          const maxY = Math.max(10, container.clientHeight - 40);

          nextLeft = Math.max(minX, Math.min(maxX, nextLeft));
          nextTop = Math.max(minY, Math.min(maxY, nextTop));

          card.style.left = `${nextLeft}px`;
          card.style.top = `${nextTop}px`;
          slide.posX = nextLeft;
          slide.posY = nextTop;
        }

        function onPointerUp() {
          card.classList.remove("is-dragging");
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          scheduleSessionSave();
        }

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
      });

      // RESIZABLE BOX BEHAVIOR
      if (resizeHandle) {
        resizeHandle.addEventListener("pointerdown", (e) => {
          e.stopPropagation();
          if (card.classList.contains("fullscreen-box")) return;
          setActiveSlide(idx);
          bringCardToFront(card, slide);

          const startX = e.clientX;
          const startY = e.clientY;
          const initW = slide.width_px;
          const initH = slide.height_px;

          function onResizeMove(me) {
            let nw = Math.max(300, initW + (me.clientX - startX));
            let nh = Math.max(240, initH + (me.clientY - startY));

            // Shift key locks the card's aspect ratio to the original image!
            if (me.shiftKey || state.shiftDown) {
              const aspect = (slide.width || 1) / (slide.height || 1);
              nh = Math.max(240, Math.round(nw / aspect));
            }

            card.style.width = `${nw}px`;
            card.style.height = `${nh}px`;
            slide.width_px = nw;
            slide.height_px = nh;
          }

          function onResizeUp() {
            window.removeEventListener("pointermove", onResizeMove);
            window.removeEventListener("pointerup", onResizeUp);
            scheduleSessionSave();
          }

          window.addEventListener("pointermove", onResizeMove);
          window.addEventListener("pointerup", onResizeUp);
        });
      }

      // Slide frame Zoom & Pan setup
      slide.zoom = slide.zoom || 1.0;
      slide.panX = slide.panX || 0;
      slide.panY = slide.panY || 0;

      function updateSlideTransform() {
        if (!slide.viewCanvas) return;
        const z = slide.zoom || 1.0;
        const px = slide.panX || 0;
        const py = slide.panY || 0;
        slide.viewCanvas.style.transform = `translate(${px}px, ${py}px) scale(${z})`;
        slide.viewCanvas.style.transformOrigin = "center center";
      }

      function updateZoomBadge() {
        const badge = card.querySelector(".slide-zoom-badge");
        if (!badge) return;
        const z = slide.zoom || 1.0;
        if (Math.abs(z - 1.0) > 0.02) {
          badge.style.display = "inline-flex";
          badge.textContent = `${Math.round(z * 100)}%`;
        } else {
          badge.style.display = "none";
          badge.textContent = "100%";
        }
      }

      updateSlideTransform();
      updateZoomBadge();

      const zoomBadge = card.querySelector(".slide-zoom-badge");
      if (zoomBadge) {
        zoomBadge.addEventListener("click", (e) => {
          e.stopPropagation();
          slide.zoom = 1.0;
          slide.panX = 0;
          slide.panY = 0;
          updateSlideTransform();
          updateZoomBadge();
        });
      }

      // Wheel Zoom & Pan:
      // Ctrl + Wheel: Smoothly zooms the frame in/out without zooming the browser page
      // Shift + Wheel: Pans horizontally
      // Normal Wheel (when zoomed): Pans vertically
      card.addEventListener(
        "wheel",
        (e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            e.stopPropagation();

            const factor = e.deltaY < 0 ? 1.15 : 0.87;
            let nextZoom = (slide.zoom || 1.0) * factor;
            nextZoom = Math.max(0.2, Math.min(15.0, nextZoom));

            slide.zoom = nextZoom;
            if (Math.abs(slide.zoom - 1.0) < 0.04) {
              slide.zoom = 1.0;
              slide.panX = 0;
              slide.panY = 0;
            }

            updateSlideTransform();
            updateZoomBadge();
            scheduleSessionSave();
          } else if (e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            slide.panX = (slide.panX || 0) - e.deltaY;
            updateSlideTransform();
            scheduleSessionSave();
          } else if (slide.zoom > 1.0) {
            e.preventDefault();
            e.stopPropagation();
            slide.panY = (slide.panY || 0) - e.deltaY;
            updateSlideTransform();
            scheduleSessionSave();
          }
        },
        { passive: false }
      );

      // Pan & Pointer Drag handling on body
      let isCardPanning = false;
      let cardPanStart = { x: 0, y: 0 };

      body.addEventListener("pointerdown", (e) => {
        // Space+drag, middle click (1), or right click (2) when zoomed in allows panning
        if (state.spaceDown || e.button === 1 || (slide.zoom > 1.0 && e.button === 2)) {
          e.preventDefault();
          e.stopPropagation();
          isCardPanning = true;
          cardPanStart = { x: e.clientX - (slide.panX || 0), y: e.clientY - (slide.panY || 0) };
          body.style.cursor = "grabbing";

          function onPanMove(me) {
            if (!isCardPanning) return;
            slide.panX = me.clientX - cardPanStart.x;
            slide.panY = me.clientY - cardPanStart.y;
            updateSlideTransform();
          }

          function onPanUp() {
            isCardPanning = false;
            body.style.cursor = "";
            window.removeEventListener("pointermove", onPanMove);
            window.removeEventListener("pointerup", onPanUp);
          }

          window.addEventListener("pointermove", onPanMove);
          window.addEventListener("pointerup", onPanUp);
          return;
        }

        // AUTO COLOR TOOL: Click on image removes clicked color across whole image
        if (state.activeTool === "auto" && e.button === 0) {
          e.preventDefault();
          e.stopPropagation();
          setActiveSlide(idx);
          bringCardToFront(card, slide);
          const rect = slide.viewCanvas.getBoundingClientRect();
          const cx = Math.round((e.clientX - rect.left) * (slide.width / rect.width));
          const cy = Math.round((e.clientY - rect.top) * (slide.height / rect.height));
          if (cx >= 0 && cx < slide.width && cy >= 0 && cy < slide.height) {
            removeColorFromWholeImage(slide, cx, cy);
          }
          return;
        }
      });

      body.addEventListener("contextmenu", (e) => {
        if (slide.zoom > 1.0) e.preventDefault();
      });

      // Direct interactive brushing on canvas in the grid!
      slide.viewCanvas.draggable = false;
      slide.viewCanvas.addEventListener("dragstart", (e) => e.preventDefault());

      slide.viewCanvas.addEventListener("pointerdown", (e) => {
        if (state.spaceDown || e.button !== 0 || state.activeTool === "auto") return;
        e.preventDefault();
        e.stopPropagation();

        try {
          slide.viewCanvas.setPointerCapture(e.pointerId);
          activePointerCaptureTarget = slide.viewCanvas;
          activePointerId = e.pointerId;
        } catch (_) {}

        setActiveSlide(idx);
        bringCardToFront(card, slide);
        const rect = slide.viewCanvas.getBoundingClientRect();
        const pt = {
          x: Math.round((e.clientX - rect.left) * (slide.width / Math.max(1, rect.width))),
          y: Math.round((e.clientY - rect.top) * (slide.height / Math.max(1, rect.height))),
        };

        // SHIFT + CLICK: Draw a straight line from previous stroke end point to current click!
        if (e.shiftKey && slide.lastStrokeEndPt) {
          beginStroke(slide, slide.lastStrokeEndPt);
          continueStroke(slide, pt);
          endStroke();
        } else {
          beginStroke(slide, pt);
        }
      });

      slide.viewCanvas.addEventListener("pointerup", (e) => {
        try {
          slide.viewCanvas.releasePointerCapture(e.pointerId);
        } catch (_) {}
      });

      slide.viewCanvas.addEventListener("pointercancel", (e) => {
        try {
          slide.viewCanvas.releasePointerCapture(e.pointerId);
        } catch (_) {}
        handleGlobalPointerUp();
      });

      container.appendChild(card);
    });
  }

  function renderSlideBar() {
    el.slideList.innerHTML = "";
    state.slides.forEach((slide, idx) => {
      const isActive = idx === state.activeSlideIndex;
      const pill = document.createElement("button");
      pill.className = `slide-thumb-pill ${isActive ? "active" : ""}`;
      pill.innerHTML = `<span>#${idx + 1}</span> <span>${slide.filename}</span>`;
      pill.addEventListener("click", () => {
        setActiveSlide(idx);
      });
      el.slideList.appendChild(pill);
    });
  }

  function setActiveSlide(index) {
    if (index < 0 || index >= state.slides.length) return;
    state.activeSlideIndex = index;
    updateSelectedSlideUI();

    if (state.viewMode === "single") {
      mountActiveSlideInFocusView();
    }
  }

  function updateSelectedSlideUI() {
    const activeSlide = getActiveSlide();
    if (!activeSlide) return;

    // Update active class on grid cards
    document.querySelectorAll(".slide-card").forEach((c, idx) => {
      const isAct = idx === state.activeSlideIndex;
      c.classList.toggle("active", isAct);
      const radio = c.querySelector(".slide-radio");
      if (radio) radio.checked = isAct;
    });

    // Update active class on slide bar pills
    document.querySelectorAll(".slide-thumb-pill").forEach((p, idx) => {
      p.classList.toggle("active", idx === state.activeSlideIndex);
    });

    // Update download button text with selected canvas
    if (el.downloadBtnText) {
      el.downloadBtnText.textContent = `Download (#${state.activeSlideIndex + 1})`;
    }

    // Refresh resolution options menu for selected canvas
    buildResolutionOptions();

    // Update Undo/Redo button status
    updateUndoRedoButtons();
  }

  function removeSlide(index) {
    if (state.slides.length <= 1) {
      resetAll();
      return;
    }
    state.slides.splice(index, 1);
    if (state.activeSlideIndex >= state.slides.length) {
      state.activeSlideIndex = state.slides.length - 1;
    }
    renderMultiCanvasGrid();
    renderSlideBar();
    updateSelectedSlideUI();
    scheduleSessionSave();
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    if (el.btnViewGrid) el.btnViewGrid.classList.toggle("active", mode === "grid");
    if (el.btnViewSingle) el.btnViewSingle.classList.toggle("active", mode === "single");

    if (mode === "grid") {
      el.canvasStage.style.display = "none";
      el.canvasStage.innerHTML = "";
      el.multiCanvasGrid.style.display = "block";
      el.zoomGroup.style.display = "none";
      renderMultiCanvasGrid();
    } else {
      el.multiCanvasGrid.style.display = "none";
      el.canvasStage.style.display = "block";
      el.zoomGroup.style.display = "inline-flex";
      mountActiveSlideInFocusView();
      fitToViewport();
    }
  }

  function mountActiveSlideInFocusView() {
    const slide = getActiveSlide();
    if (!slide) return;
    el.canvasStage.innerHTML = "";
    el.canvasStage.appendChild(slide.viewCanvas);
    fitToViewport();
  }

  function getActiveSlide() {
    return state.slides[state.activeSlideIndex] || null;
  }

  // ==========================================
  // TILE-BASED UNDO / REDO (PER-SLIDE)
  // ==========================================

  function captureTile(slide, tx, ty) {
    const x = tx * TILE_SIZE;
    const y = ty * TILE_SIZE;
    const w = Math.min(TILE_SIZE, slide.width - x);
    const h = Math.min(TILE_SIZE, slide.height - y);
    if (w <= 0 || h <= 0) return null;

    const buffer = new Uint8Array(w * h);
    const mData = slide.maskImageData.data;
    const stride = slide.width * 4;
    let bIdx = 0;

    for (let row = 0; row < h; row++) {
      let offset = (y + row) * stride + (x << 2);
      for (let col = 0; col < w; col++) {
        buffer[bIdx++] = mData[offset + (col << 2)];
      }
    }

    return { tx, ty, x, y, w, h, data: buffer };
  }

  function applyTile(slide, tileRecord) {
    const { x, y, w, h, data } = tileRecord;
    const mData = slide.maskImageData.data;
    const stride = slide.width * 4;
    let bIdx = 0;

    for (let row = 0; row < h; row++) {
      let offset = (y + row) * stride + (x << 2);
      for (let col = 0; col < w; col++) {
        let alpha = data[bIdx++];
        let i = offset + (col << 2);
        mData[i] = alpha;
        mData[i + 1] = alpha;
        mData[i + 2] = alpha;
      }
    }

    compositeSlideRegion(slide, x, y, w, h);
  }

  function captureAllSlideTiles(slide) {
    const numTx = Math.ceil(slide.width / TILE_SIZE);
    const numTy = Math.ceil(slide.height / TILE_SIZE);
    const tiles = [];
    for (let ty = 0; ty < numTy; ty++) {
      for (let tx = 0; tx < numTx; tx++) {
        const tile = captureTile(slide, tx, ty);
        if (tile) tiles.push(tile);
      }
    }
    return tiles;
  }

  function pushWholeImageUndo(slide, beforeTiles) {
    const tileEntries = [];
    for (const bt of beforeTiles) {
      const at = captureTile(slide, bt.tx, bt.ty);
      if (at) {
        tileEntries.push({
          tx: bt.tx,
          ty: bt.ty,
          x: bt.x,
          y: bt.y,
          w: bt.w,
          h: bt.h,
          before: bt.data,
          after: at.data,
        });
      }
    }
    if (tileEntries.length > 0) {
      slide.undoStack.push(tileEntries);
      if (slide.undoStack.length > MAX_UNDO) slide.undoStack.shift();
      slide.redoStack = [];
      updateUndoRedoButtons();
      scheduleSessionSave();
    }
  }

  function removeColorFromWholeImage(slide, cx, cy) {
    if (!slide || !slide.origImageData || !slide.maskImageData) return;

    const clickIdx = (cy * slide.width + cx) * 4;
    const clickAlpha = slide.maskImageData.data[clickIdx];
    // If clicking an already cut-out / transparent area, do not sample invisible background color!
    if (clickAlpha < 10) return;

    const [sr, sg, sb] = getPixelColor(slide, cx, cy);
    const tol = state.magicTolerance;
    const tol2 = tol * tol;
    const softStart = 0.7 * tol;
    const softStart2 = softStart * softStart;
    const softRange = (tol - softStart) || 1;

    // Capture all tiles for undo
    const beforeTiles = captureAllSlideTiles(slide);

    const oData = slide.origImageData.data;
    const mData = slide.maskImageData.data;
    const totalPixels = slide.width * slide.height;
    let changed = 0;

    for (let p = 0; p < totalPixels; p++) {
      const i = p * 4;
      const pr = oData[i];
      const pg = oData[i + 1];
      const pb = oData[i + 2];

      const cDist2 =
        0.3 * (pr - sr) * (pr - sr) +
        0.59 * (pg - sg) * (pg - sg) +
        0.11 * (pb - sb) * (pb - sb);

      if (cDist2 <= tol2) {
        let w = 1.0;
        if (cDist2 > softStart2) {
          const cDist = Math.sqrt(cDist2);
          w = 0.5 * (1 + Math.cos((Math.PI * (cDist - softStart)) / softRange));
        }

        if (w > 0) {
          const curAlpha = mData[i];
          const newAlpha = Math.max(0, Math.round(curAlpha * (1.0 - w)));
          if (newAlpha !== curAlpha) {
            mData[i] = newAlpha;
            mData[i + 1] = newAlpha;
            mData[i + 2] = newAlpha;
            changed++;
          }
        }
      }
    }

    if (changed > 0) {
      slide.maskCtx.putImageData(slide.maskImageData, 0, 0);
      compositeSlide(slide);
      pushWholeImageUndo(slide, beforeTiles);
    }
  }

  let imglyModulePromise = null;

  async function getImglyModule(onProgress) {
    if (!imglyModulePromise) {
      if (onProgress) onProgress("Loading Web AI...");
      imglyModulePromise = import("https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.7/+esm")
        .then((m) => m.default || m.removeBackground || m)
        .catch((err) => {
          imglyModulePromise = null;
          throw err;
        });
    }
    return imglyModulePromise;
  }

  async function runInBrowserAiCutout(slide, onProgress) {
    const removeBackground = await getImglyModule(onProgress);

    const oBlob = await new Promise((res) => slide.origCanvas.toBlob(res, "image/png"));

    const config = {
      progress: (key, current, total) => {
        if (onProgress) {
          if (total > 0) {
            const pct = Math.round((current / total) * 100);
            onProgress(`AI: ${pct}%`);
          } else {
            onProgress("AI processing...");
          }
        }
      },
    };

    const resultBlob = await removeBackground(oBlob, config);
    const cutoutImg = await loadImageAsync(URL.createObjectURL(resultBlob));

    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = slide.width;
    tempCanvas.height = slide.height;
    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
    tempCtx.drawImage(cutoutImg, 0, 0, slide.width, slide.height);
    const cutoutData = tempCtx.getImageData(0, 0, slide.width, slide.height).data;

    const mData = slide.maskImageData.data;
    const total = slide.width * slide.height * 4;
    for (let i = 0; i < total; i += 4) {
      const alpha = cutoutData[i + 3];
      mData[i] = alpha;
      mData[i + 1] = alpha;
      mData[i + 2] = alpha;
      mData[i + 3] = 255;
    }

    slide.maskCtx.putImageData(slide.maskImageData, 0, 0);
    compositeSlide(slide);
  }

  async function runAiCutoutForActiveSlide() {
    const slide = getActiveSlide();
    if (!slide) return;

    if (!el.btnRunAi) return;
    const origHtml = el.btnRunAi.innerHTML;
    el.btnRunAi.disabled = true;
    el.btnRunAi.innerHTML = `
      <svg class="spin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;">
        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"/>
        <path d="M12 2a10 10 0 0 1 10 10"/>
      </svg>
      <span class="ai-status-text">Cutting out...</span>
    `;

    const setStatus = (txt) => {
      const elText = el.btnRunAi.querySelector(".ai-status-text");
      if (elText) elText.textContent = txt;
    };

    try {
      let cutoutDone = false;

      // 1. Try local/remote backend if reachable
      try {
        const fd = new FormData();
        if (slide.sessionId && !slide.sessionId.startsWith("slide_")) {
          fd.append("session_id", slide.sessionId);
        } else {
          const blob = await new Promise((res) => slide.origCanvas.toBlob(res, "image/png"));
          fd.append("file", blob, `${slide.filename || "image"}.png`);
        }

        let res = await fetch("/api/run-ai", {
          method: "POST",
          body: fd,
        });

        if (!res.ok && res.status === 404) {
          const fallbackFd = new FormData();
          const blob = await new Promise((res) => slide.origCanvas.toBlob(res, "image/png"));
          fallbackFd.append("file", blob, `${slide.filename || "image"}.png`);
          res = await fetch("/api/run-ai", {
            method: "POST",
            body: fallbackFd,
          });
        }

        if (res.ok) {
          const data = await res.json();
          slide.sessionId = data.session_id;

          if (data.model_used && el.modelBadgeText) {
            el.modelBadgeText.textContent = data.model_used.includes("birefnet")
              ? "BiRefNet"
              : "U-2-Net";
          }

          const newMaskImg = await loadImageAsync(data.mask_url + "?t=" + Date.now());
          const beforeTiles = captureAllSlideTiles(slide);

          slide.maskCtx.drawImage(newMaskImg, 0, 0, slide.width, slide.height);
          slide.maskImageData = slide.maskCtx.getImageData(0, 0, slide.width, slide.height);

          compositeSlide(slide);
          pushWholeImageUndo(slide, beforeTiles);
          scheduleSessionSave();
          cutoutDone = true;
        }
      } catch (_) {
        // Backend not available (e.g. running on Cloudflare Pages static hosting)
      }

      // 2. Client-side In-Browser Web AI (WebGPU/WASM) Fallback
      if (!cutoutDone) {
        setStatus("Loading Web AI...");
        if (el.modelBadgeText) el.modelBadgeText.textContent = "Web AI (RMBG)";
        const beforeTiles = captureAllSlideTiles(slide);
        await runInBrowserAiCutout(slide, setStatus);
        pushWholeImageUndo(slide, beforeTiles);
        scheduleSessionSave();
      }
    } catch (e) {
      console.error("AI Cutout error:", e);
      alert("AI Cutout failed: " + e.message);
    } finally {
      el.btnRunAi.disabled = false;
      el.btnRunAi.innerHTML = origHtml;
    }
  }

  function undoActiveSlide() {
    const slide = getActiveSlide();
    if (!slide || slide.undoStack.length === 0) return;
    const tiles = slide.undoStack.pop();
    tiles.forEach((t) => applyTile(slide, { ...t, data: t.before }));
    slide.redoStack.push(tiles);
    updateUndoRedoButtons();
    scheduleSessionSave();
  }

  function redoActiveSlide() {
    const slide = getActiveSlide();
    if (!slide || slide.redoStack.length === 0) return;
    const tiles = slide.redoStack.pop();
    tiles.forEach((t) => applyTile(slide, { ...t, data: t.after }));
    slide.undoStack.push(tiles);
    updateUndoRedoButtons();
    scheduleSessionSave();
  }

  function updateUndoRedoButtons() {
    const slide = getActiveSlide();
    el.btnUndo.disabled = !slide || slide.undoStack.length === 0;
    el.btnRedo.disabled = !slide || slide.redoStack.length === 0;
  }

  // ==========================================
  // BRUSH ENGINE & MAGIC COLOR DISCRIMINATION
  // ==========================================

  function getPixelColor(slide, x, y) {
    if (x < 0 || x >= slide.width || y < 0 || y >= slide.height) {
      return [0, 0, 0];
    }
    const idx = (y * slide.width + x) * 4;
    return [
      slide.origImageData.data[idx],
      slide.origImageData.data[idx + 1],
      slide.origImageData.data[idx + 2],
    ];
  }

  function beginStroke(slide, pt) {
    state.isDrawing = true;
    state.drawingSlide = slide;
    state.strokeStartPt = { ...pt };
    state.lastPt = { ...pt };
    state.strokeDirtyTiles = new Map();

    const isMagic = state.activeTool === "magic" || state.magic;
    const isRestore = state.activeTool === "restore";

    const mData = slide.maskImageData ? slide.maskImageData.data : null;
    const R = Math.max(1, Math.round(state.brushSize / 2));

    if (isMagic) {
      // Magic brush: Sample target color from a VISIBLE foreground pixel (currentAlpha >= 10).
      // If clicking directly on a visible pixel, lock that color code immediately!
      let samplePt = null;
      const clx = Math.max(0, Math.min(slide.width - 1, pt.x));
      const cly = Math.max(0, Math.min(slide.height - 1, pt.y));
      const idx = (cly * slide.width + clx) * 4;
      const centerAlpha = mData ? mData[idx] : 255;

      if (centerAlpha >= 10) {
        samplePt = { x: clx, y: cly };
      } else if (mData) {
        // Center pixel was already cut out or transparent.
        // Search outwards within brush radius for the closest visible pixel to latch onto!
        const minX = Math.max(0, pt.x - R);
        const maxX = Math.min(slide.width - 1, pt.x + R);
        const minY = Math.max(0, pt.y - R);
        const maxY = Math.min(slide.height - 1, pt.y + R);
        let bestDist2 = Infinity;

        for (let y = minY; y <= maxY; y++) {
          const dy = y - pt.y;
          const dy2 = dy * dy;
          const rowOffset = y * slide.width * 4;
          for (let x = minX; x <= maxX; x++) {
            const dx = x - pt.x;
            const d2 = dx * dx + dy2;
            if (d2 <= R * R && d2 < bestDist2) {
              const i = rowOffset + (x << 2);
              if (mData[i] >= 10) {
                bestDist2 = d2;
                samplePt = { x, y };
              }
            }
          }
        }
      }

      if (samplePt) {
        state.startColor = getPixelColor(slide, samplePt.x, samplePt.y);
      } else {
        // User clicked in empty cutout space; startColor will latch onto first visible pixel as they drag!
        state.startColor = null;
      }
    } else if (isRestore) {
      // Restore mode: sampling from original image is valid
      state.startColor = getPixelColor(slide, pt.x, pt.y);
    } else {
      // Standard eraser
      state.startColor = null;
    }

    // Apply first stamp if startColor is set (or for non-magic tools)
    if (!isMagic || state.startColor !== null) {
      applyBrushStamp(slide, pt.x, pt.y, false);
    }
  }

  function continueStroke(slide, rawPt) {
    if (!state.isDrawing || !state.lastPt || state.drawingSlide !== slide) return;

    const isMagic = state.activeTool === "magic" || state.magic;

    let currPt = { ...rawPt };

    // SHIFT CONSTRAINT: Holding Shift constrains stroke to a straight line (horizontal or vertical)!
    if (state.shiftDown && state.strokeStartPt) {
      const dx = Math.abs(currPt.x - state.strokeStartPt.x);
      const dy = Math.abs(currPt.y - state.strokeStartPt.y);
      if (dx >= dy) {
        currPt.y = state.strokeStartPt.y;
      } else {
        currPt.x = state.strokeStartPt.x;
      }
    }

    // If Magic mode was initiated on an already cut-out/transparent area,
    // latch onto the target color as soon as the brush touches any visible pixel!
    if (isMagic && state.startColor === null) {
      const R = Math.max(1, Math.round(state.brushSize / 2));
      const minX = Math.max(0, currPt.x - R);
      const maxX = Math.min(slide.width - 1, currPt.x + R);
      const minY = Math.max(0, currPt.y - R);
      const maxY = Math.min(slide.height - 1, currPt.y + R);
      const mData = slide.maskImageData ? slide.maskImageData.data : null;
      let foundPt = null;
      let bestDist2 = Infinity;

      if (mData) {
        for (let y = minY; y <= maxY; y++) {
          const dy = y - currPt.y;
          const dy2 = dy * dy;
          const rowOffset = y * slide.width * 4;
          for (let x = minX; x <= maxX; x++) {
            const dx = x - currPt.x;
            const d2 = dx * dx + dy2;
            if (d2 <= R * R && d2 < bestDist2) {
              const i = rowOffset + (x << 2);
              if (mData[i] >= 10) {
                bestDist2 = d2;
                foundPt = { x, y };
              }
            }
          }
        }
      }

      if (foundPt) {
        state.startColor = getPixelColor(slide, foundPt.x, foundPt.y);
      }
    }

    // If still in pure empty cutout space without touching any visible pixel, skip
    if (isMagic && state.startColor === null) {
      state.lastPt = currPt;
      return;
    }

    const dx = currPt.x - state.lastPt.x;
    const dy = currPt.y - state.lastPt.y;
    const dist = Math.hypot(dx, dy);

    const step = Math.max(1, Math.floor(state.brushSize / 4));
    const steps = Math.ceil(dist / step);

    let batchMinX = Infinity;
    let batchMinY = Infinity;
    let batchMaxX = -Infinity;
    let batchMaxY = -Infinity;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(state.lastPt.x + dx * t);
      const y = Math.round(state.lastPt.y + dy * t);
      const bounds = applyBrushStamp(slide, x, y, true);
      if (bounds) {
        if (bounds.minX < batchMinX) batchMinX = bounds.minX;
        if (bounds.minY < batchMinY) batchMinY = bounds.minY;
        if (bounds.maxX > batchMaxX) batchMaxX = bounds.maxX;
        if (bounds.maxY > batchMaxY) batchMaxY = bounds.maxY;
      }
    }

    // Composite the accumulated dirty region once per pointermove event for 60fps performance!
    if (batchMinX <= batchMaxX && batchMinY <= batchMaxY) {
      compositeSlideRegion(slide, batchMinX, batchMinY, batchMaxX - batchMinX + 1, batchMaxY - batchMinY + 1);
    }

    state.lastPt = currPt;
  }

  function endStroke() {
    if (!state.isDrawing) return;
    const slide = state.drawingSlide;
    if (slide && state.lastPt) {
      slide.lastStrokeEndPt = { ...state.lastPt };
    }
    state.isDrawing = false;
    state.drawingSlide = null;
    state.lastPt = null;
    state.strokeStartPt = null;

    if (slide && state.strokeDirtyTiles && state.strokeDirtyTiles.size > 0) {
      const tileEntries = [];
      state.strokeDirtyTiles.forEach((beforeTile) => {
        const afterTile = captureTile(slide, beforeTile.tx, beforeTile.ty);
        if (afterTile) {
          tileEntries.push({
            tx: beforeTile.tx,
            ty: beforeTile.ty,
            x: beforeTile.x,
            y: beforeTile.y,
            w: beforeTile.w,
            h: beforeTile.h,
            before: beforeTile.data,
            after: afterTile.data,
          });
        }
      });

      if (tileEntries.length > 0) {
        slide.undoStack.push(tileEntries);
        if (slide.undoStack.length > MAX_UNDO) slide.undoStack.shift();
        slide.redoStack = [];
        updateUndoRedoButtons();
        scheduleSessionSave();
      }
    }

    state.strokeDirtyTiles = null;
  }

  function applyBrushStamp(slide, cx, cy, skipRender = false) {
    const R = Math.max(1, Math.round(state.brushSize / 2));
    const R2 = R * R;
    const softness = state.brushSoftness;
    const innerR = R * (1.0 - softness);

    const minX = Math.max(0, cx - R);
    const maxX = Math.min(slide.width - 1, cx + R);
    const minY = Math.max(0, cy - R);
    const maxY = Math.min(slide.height - 1, cy + R);

    if (minX > maxX || minY > maxY) return null;

    // Track dirty tiles
    const minTx = Math.floor(minX / TILE_SIZE);
    const maxTx = Math.floor(maxX / TILE_SIZE);
    const minTy = Math.floor(minY / TILE_SIZE);
    const maxTy = Math.floor(maxY / TILE_SIZE);

    if (state.strokeDirtyTiles) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          const key = `${tx}_${ty}`;
          if (!state.strokeDirtyTiles.has(key)) {
            const tile = captureTile(slide, tx, ty);
            if (tile) state.strokeDirtyTiles.set(key, tile);
          }
        }
      }
    }

    const oData = slide.origImageData.data;
    const mData = slide.maskImageData.data;
    const stride = slide.width * 4;

    const isRestore = state.activeTool === "restore";
    const useMagic = state.activeTool === "magic" || state.magic;

    // If Magic tool is active and we don't have a valid sampled foreground color, do NOT erase anything!
    if (useMagic && !isRestore && !state.startColor) {
      return null;
    }

    const [sr, sg, sb] = state.startColor || [0, 0, 0];
    const tol = state.magicTolerance;
    const tol2 = tol * tol;

    for (let y = minY; y <= maxY; y++) {
      const dy = y - cy;
      const dy2 = dy * dy;
      const rowOffset = y * stride;

      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy2;
        if (d2 > R2) continue;

        const i = rowOffset + (x << 2);
        const currentAlpha = mData[i];

        // If already completely transparent on erase or magic mode, nothing to do
        if (!isRestore && currentAlpha < 10) continue;

        let wRad = 1.0;
        if (softness > 0) {
          const d = Math.sqrt(d2);
          if (d > innerR) {
            wRad = 0.5 * (1 + Math.cos((Math.PI * (d - innerR)) / (R - innerR)));
          }
        }

        let wCol = 1.0;
        if (useMagic) {
          const pr = oData[i];
          const pg = oData[i + 1];
          const pb = oData[i + 2];

          const cDist2 =
            0.3 * (pr - sr) * (pr - sr) +
            0.59 * (pg - sg) * (pg - sg) +
            0.11 * (pb - sb) * (pb - sb);

          if (cDist2 > tol2) continue;

          const cDist = Math.sqrt(cDist2);
          const softStart = 0.6 * tol;
          if (cDist > softStart) {
            wCol = 0.5 * (1 + Math.cos((Math.PI * (cDist - softStart)) / (0.4 * tol)));
          }
        }

        const W = wRad * wCol;
        if (W <= 0) continue;

        let newAlpha;
        if (isRestore) {
          newAlpha = Math.min(255, Math.round(currentAlpha + 255 * W));
        } else if (useMagic) {
          // Magic Eraser: Cleanly delete matching color code upon sweeping
          if (softness > 0 && wRad < 0.25) {
            newAlpha = Math.max(0, Math.round(currentAlpha - 255 * wRad));
          } else {
            newAlpha = 0;
          }
        } else {
          newAlpha = Math.max(0, Math.round(currentAlpha - 255 * W));
        }

        mData[i] = newAlpha;
        mData[i + 1] = newAlpha;
        mData[i + 2] = newAlpha;
      }
    }

    if (!skipRender) {
      compositeSlideRegion(slide, minX, minY, maxX - minX + 1, maxY - minY + 1);
    }

    return { minX, minY, maxX, maxY };
  }

  // ==========================================
  // POINTER & GLOBAL DRAG HANDLING
  // ==========================================

  function handleFocusedPointerDown(e) {
    if (state.viewMode !== "single") return;
    const slide = getActiveSlide();
    if (!slide) return;

    if (state.spaceDown || e.button === 1) {
      state.isPanning = true;
      state.panStart = { x: e.clientX - state.panX, y: e.clientY - state.panY };
      el.canvasViewport.classList.add("panning");
      el.brushCursor.style.display = "none";
      return;
    }

    if (e.button === 0 && !state.isComparing) {
      e.preventDefault();
      try {
        el.canvasViewport.setPointerCapture(e.pointerId);
        activePointerCaptureTarget = el.canvasViewport;
        activePointerId = e.pointerId;
      } catch (_) {}

      const pt = windowToFocusedCanvas(e.clientX, e.clientY, slide);
      if (state.activeTool === "auto") {
        if (pt.x >= 0 && pt.x < slide.width && pt.y >= 0 && pt.y < slide.height) {
          removeColorFromWholeImage(slide, pt.x, pt.y);
        }
        return;
      }
      if (e.shiftKey && slide.lastStrokeEndPt) {
        beginStroke(slide, slide.lastStrokeEndPt);
        continueStroke(slide, pt);
        endStroke();
      } else {
        beginStroke(slide, pt);
      }
    }
  }

  function handleGlobalPointerMove(e) {
    if (state.isDrawing) {
      e.preventDefault();
    }

    const vpRect = el.canvasViewport.getBoundingClientRect();
    const inVp =
      e.clientX >= vpRect.left &&
      e.clientX <= vpRect.right &&
      e.clientY >= vpRect.top &&
      e.clientY <= vpRect.bottom;

    if (inVp && !state.spaceDown && !state.isPanning && state.activeTool !== "auto") {
      el.brushCursor.style.display = "block";
      el.brushCursor.style.left = `${e.clientX - vpRect.left}px`;
      el.brushCursor.style.top = `${e.clientY - vpRect.top}px`;
    } else {
      el.brushCursor.style.display = "none";
    }

    if (state.isPanning) {
      state.panX = e.clientX - state.panStart.x;
      state.panY = e.clientY - state.panStart.y;
      applyStageTransform();
      return;
    }

    if (state.isDrawing && state.drawingSlide) {
      const slide = state.drawingSlide;
      let pt;
      if (state.viewMode === "single") {
        pt = windowToFocusedCanvas(e.clientX, e.clientY, slide);
      } else {
        const rect = slide.viewCanvas.getBoundingClientRect();
        pt = {
          x: Math.round((e.clientX - rect.left) * (slide.width / Math.max(1, rect.width))),
          y: Math.round((e.clientY - rect.top) * (slide.height / Math.max(1, rect.height))),
        };
      }
      continueStroke(slide, pt);
    }
  }

  function handleGlobalPointerUp(e) {
    if (activePointerCaptureTarget && activePointerId !== null) {
      try {
        activePointerCaptureTarget.releasePointerCapture(activePointerId);
      } catch (_) {}
      activePointerCaptureTarget = null;
      activePointerId = null;
    }

    if (state.isPanning) {
      state.isPanning = false;
      el.canvasViewport.classList.remove("panning");
      if (!state.spaceDown) el.brushCursor.style.display = "block";
    }
    if (state.isDrawing) {
      endStroke();
    }
  }

  function windowToFocusedCanvas(clientX, clientY, slide) {
    const vpRect = el.canvasViewport.getBoundingClientRect();
    const vpX = clientX - vpRect.left;
    const vpY = clientY - vpRect.top;

    const canvasX = (vpX - state.panX) / state.zoom;
    const canvasY = (vpY - state.panY) / state.zoom;

    return {
      x: Math.round(canvasX),
      y: Math.round(canvasY),
    };
  }

  function updateCursorDimensions() {
    let scale = 1.0;
    if (state.viewMode === "single") {
      scale = state.zoom;
    } else {
      const slide = getActiveSlide();
      if (slide && slide.viewCanvas) {
        const rect = slide.viewCanvas.getBoundingClientRect();
        if (rect.width > 0 && slide.width > 0) {
          scale = rect.width / slide.width;
        }
      }
    }

    const screenDiameter = Math.max(4, state.brushSize * scale);
    el.brushCursor.style.width = `${screenDiameter}px`;
    el.brushCursor.style.height = `${screenDiameter}px`;

    if (state.brushSoftness > 0) {
      const innerDiameter = screenDiameter * (1.0 - state.brushSoftness);
      el.brushCursorInner.style.width = `${innerDiameter}px`;
      el.brushCursorInner.style.height = `${innerDiameter}px`;
      el.brushCursorInner.style.display = "block";
    } else {
      el.brushCursorInner.style.display = "none";
    }
  }

  // ==========================================
  // VIEWPORT PAN & ZOOM (FOCUSED VIEW)
  // ==========================================

  function applyStageTransform() {
    el.canvasStage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    el.zoomLevelText.textContent = `${Math.round(state.zoom * 100)}%`;
    updateCursorDimensions();
  }

  function fitToViewport() {
    const slide = getActiveSlide();
    if (!slide) return;
    const vpRect = el.canvasViewport.getBoundingClientRect();
    const margin = 40;
    const availW = Math.max(100, vpRect.width - margin);
    const availH = Math.max(100, vpRect.height - margin);

    const scaleX = availW / slide.width;
    const scaleY = availH / slide.height;
    state.zoom = Math.min(1.0, scaleX, scaleY);

    state.panX = Math.round((vpRect.width - slide.width * state.zoom) / 2);
    state.panY = Math.round((vpRect.height - slide.height * state.zoom) / 2);

    applyStageTransform();
  }

  function zoomStep(factor) {
    if (state.viewMode !== "single") return;
    const vpRect = el.canvasViewport.getBoundingClientRect();
    const cx = vpRect.width / 2;
    const cy = vpRect.height / 2;
    zoomAt(cx, cy, state.zoom * factor);
  }

  function zoomAt(clientX, clientY, targetZoom) {
    const newZoom = Math.max(0.1, Math.min(10.0, targetZoom));
    const factor = newZoom / state.zoom;

    state.panX = clientX - (clientX - state.panX) * factor;
    state.panY = clientY - (clientY - state.panY) * factor;
    state.zoom = newZoom;

    applyStageTransform();
  }

  function handleWheelZoom(e) {
    if (state.viewMode !== "single") return;
    e.preventDefault();
    const vpRect = el.canvasViewport.getBoundingClientRect();
    const mouseX = e.clientX - vpRect.left;
    const mouseY = e.clientY - vpRect.top;

    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.15 : 1 / 1.15;
    zoomAt(mouseX, mouseY, state.zoom * factor);
  }

  // ==========================================
  // COMPARE ORIGINAL & BACKGROUNDS
  // ==========================================

  function startCompare() {
    if (state.isComparing) return;
    state.isComparing = true;
    el.btnCompare.classList.add("active");

    state.slides.forEach((slide) => {
      slide.viewCtx.drawImage(slide.origCanvas, 0, 0);
    });
  }

  function endCompare() {
    if (!state.isComparing) return;
    state.isComparing = false;
    el.btnCompare.classList.remove("active");
    compositeAllSlides();
  }

  function setPreviewBackground(type, customColor = null) {
    state.activeBg = type;
    const vp = el.canvasViewport;
    vp.classList.remove("bg-checkerboard", "bg-white", "bg-black");
    vp.style.backgroundColor = "";

    if (type === "checkerboard") {
      vp.classList.add("bg-checkerboard");
    } else if (type === "white") {
      vp.classList.add("bg-white");
    } else if (type === "black") {
      vp.classList.add("bg-black");
    } else if (type === "custom") {
      state.customBg = customColor || el.customBgColor.value;
      vp.style.backgroundColor = state.customBg;
    }

    // Also update all slide card bodies in grid view so transparent cutouts preview accurately!
    document.querySelectorAll(".slide-card-body").forEach((cardBody) => {
      cardBody.classList.remove("bg-checkerboard", "bg-white", "bg-black");
      cardBody.style.backgroundColor = "";
      if (type === "checkerboard") {
        cardBody.classList.add("bg-checkerboard");
      } else if (type === "white") {
        cardBody.classList.add("bg-white");
      } else if (type === "black") {
        cardBody.classList.add("bg-black");
      } else if (type === "custom") {
        cardBody.style.backgroundColor = state.customBg;
      }
    });

    if (state.slides.length > 0) {
      scheduleSessionSave();
    }
  }

  // ==========================================
  // TOOL SELECTION & GHOST GUIDE
  // ==========================================

  function updateToleranceSliderVisibility() {
    if (!el.magicToleranceGroup) return;
    const isVisible = state.activeTool === "magic" || state.activeTool === "auto";
    el.magicToleranceGroup.style.display = isVisible ? "flex" : "none";
  }

  function setTool(toolName) {
    state.activeTool = toolName;
    state.magic = (toolName === "magic");

    if (el.toolRestore) el.toolRestore.classList.toggle("active", toolName === "restore");
    if (el.toolErase) el.toolErase.classList.toggle("active", toolName === "erase");
    if (el.toolMagic) el.toolMagic.classList.toggle("active", toolName === "magic");
    if (el.toolAutoColor) el.toolAutoColor.classList.toggle("active", toolName === "auto");

    if (el.ghostOpacityGroup) {
      el.ghostOpacityGroup.style.display = toolName === "restore" ? "flex" : "none";
    }

    updateToleranceSliderVisibility();

    if (toolName === "auto") {
      el.brushCursor.style.display = "none";
      if (el.canvasViewport) el.canvasViewport.style.cursor = "crosshair";
    } else {
      if (el.canvasViewport) el.canvasViewport.style.cursor = "";
    }

    compositeAllSlides();
    scheduleSessionSave();
  }

  // ==========================================
  // MULTI-RESOLUTION DOWNLOAD & BATCH EXPORT
  // ==========================================

  function toggleDownloadMenu() {
    if (!el.downloadMenu) return;
    const isVisible = el.downloadMenu.style.display === "flex";
    if (isVisible) {
      closeDownloadMenu();
    } else {
      openDownloadMenu();
    }
  }

  function openDownloadMenu() {
    if (!el.downloadMenu) return;
    const slide = getActiveSlide();
    if (!slide) return;

    // Default to Presets view
    backToPresetsView();

    if (el.downloadSlideInfo) {
      el.downloadSlideInfo.textContent = `#${state.activeSlideIndex + 1} ${slide.filename}`;
      el.downloadSlideInfo.title = `${slide.filename} (${slide.width}×${slide.height}px)`;
    }

    buildResolutionOptions();
    el.downloadMenu.style.display = "flex";
    if (el.downloadWrapper) el.downloadWrapper.classList.add("open");
  }

  function closeDownloadMenu() {
    if (!el.downloadMenu) return;
    el.downloadMenu.style.display = "none";
    if (el.downloadWrapper) el.downloadWrapper.classList.remove("open");
  }

  function buildResolutionOptions() {
    if (!el.resolutionOptions) return;
    const slide = getActiveSlide();
    if (!slide) return;

    const w = slide.width;
    const h = slide.height;
    const maxDim = Math.max(w, h);
    const aspect = w / h;

    const options = [
      {
        name: "Original Resolution",
        width: w,
        height: h,
        badge: "Original 100%",
        badgeClass: "badge-orig",
        desc: `${w} × ${h} px • Pristine Quality`,
        isUpscale: false,
      },
      {
        name: "2× Super HD",
        width: w * 2,
        height: h * 2,
        badge: "✨ 2× Upscale",
        badgeClass: "badge-upscale",
        desc: `${w * 2} × ${h * 2} px • Enhanced Clarity`,
        isUpscale: true,
      },
      {
        name: "4× Ultra HD",
        width: w * 4,
        height: h * 4,
        badge: "✨ 4× Ultra",
        badgeClass: "badge-upscale",
        desc: `${w * 4} × ${h * 4} px • High Precision Details`,
        isUpscale: true,
      },
    ];

    if (maxDim > 1920 * 1.15) {
      const tw = w >= h ? 1920 : Math.round(1920 * aspect);
      const th = w >= h ? Math.round(1920 / aspect) : 1920;
      options.push({
        name: "Full HD (1080p)",
        width: tw,
        height: th,
        badge: "1080p",
        badgeClass: "",
        desc: `${tw} × ${th} px • Standard Display`,
        isUpscale: false,
      });
    }

    options.push({
      name: "Half Size (50%)",
      width: Math.max(16, Math.round(w * 0.5)),
      height: Math.max(16, Math.round(h * 0.5)),
      badge: "50% Web",
      badgeClass: "",
      desc: `${Math.round(w * 0.5)} × ${Math.round(h * 0.5)} px • Fast Loading`,
      isUpscale: false,
    });

    el.resolutionOptions.innerHTML = "";

    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "resolution-opt-btn";
      btn.innerHTML = `
        <div class="res-info">
          <div class="res-title">
            <span>${opt.name}</span>
            <span class="res-badge ${opt.badgeClass || ""}">${opt.badge}</span>
          </div>
          <div class="res-dim">${opt.desc}</div>
        </div>
        <svg class="res-arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      `;

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeDownloadMenu();
        exportSlide(slide, opt.width, opt.height, "png", opt.isUpscale);
      });

      el.resolutionOptions.appendChild(btn);
    });

    // Populate Batch ZIP export if multiple slides exist
    if (el.batchDownloadContainer) {
      el.batchDownloadContainer.innerHTML = "";
      if (state.slides.length > 1) {
        const divider = document.createElement("div");
        divider.style.cssText = "height:1px; background:var(--border-color); margin:0.35rem 0;";
        el.batchDownloadContainer.appendChild(divider);

        const batchBtn = document.createElement("button");
        batchBtn.type = "button";
        batchBtn.className = "resolution-opt-btn";
        batchBtn.innerHTML = `
          <div class="res-info">
            <div class="res-title">
              <span>📦 Download All Slides</span>
              <span class="res-badge badge-orig">${state.slides.length} Cutouts</span>
            </div>
            <div class="res-dim">Full resolution ZIP archive</div>
          </div>
          <svg class="res-arrow-icon" style="color:var(--accent);" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        `;

        batchBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          closeDownloadMenu();
          exportAllSlidesBatch();
        });

        el.batchDownloadContainer.appendChild(batchBtn);
      }
    }
  }

  // ==========================================
  // CUSTOM RESOLUTION & QUALITY UPSCALE
  // ==========================================

  function openCustomResolutionView() {
    const slide = getActiveSlide();
    if (!slide) return;

    if (el.downloadPresetsView) el.downloadPresetsView.style.display = "none";
    if (el.downloadCustomView) el.downloadCustomView.style.display = "flex";

    state.customRes.width = slide.width;
    state.customRes.height = slide.height;
    state.customRes.scale = 1.0;
    state.customRes.aspectLocked = true;
    state.customRes.format = "png";
    state.customRes.enhance = true;

    if (el.customResWidth) el.customResWidth.value = slide.width;
    if (el.customResHeight) el.customResHeight.value = slide.height;
    if (el.chkCustomEnhance) el.chkCustomEnhance.checked = true;

    updateAspectLockButtonUI();
    updateScalePillsUI(1.0);
    updateFormatChipsUI("png");
    updateCustomDownloadButtonUI();
  }

  function backToPresetsView() {
    if (el.downloadCustomView) el.downloadCustomView.style.display = "none";
    if (el.downloadPresetsView) el.downloadPresetsView.style.display = "flex";
  }

  function applyScalePreset(scale) {
    const slide = getActiveSlide();
    if (!slide) return;
    state.customRes.scale = scale;
    const nw = Math.max(16, Math.round(slide.width * scale));
    const nh = Math.max(16, Math.round(slide.height * scale));
    state.customRes.width = nw;
    state.customRes.height = nh;
    if (el.customResWidth) el.customResWidth.value = nw;
    if (el.customResHeight) el.customResHeight.value = nh;
    updateScalePillsUI(scale);
    updateCustomDownloadButtonUI();
  }

  function onCustomWidthInput() {
    const slide = getActiveSlide();
    if (!slide) return;
    const w = parseInt(el.customResWidth.value, 10);
    if (isNaN(w) || w <= 0) return;
    state.customRes.width = w;

    if (state.customRes.aspectLocked) {
      const aspect = slide.width / slide.height;
      const h = Math.max(16, Math.round(w / aspect));
      state.customRes.height = h;
      if (el.customResHeight) el.customResHeight.value = h;
    }
    updateScalePillsUI(null);
    updateCustomDownloadButtonUI();
  }

  function onCustomHeightInput() {
    const slide = getActiveSlide();
    if (!slide) return;
    const h = parseInt(el.customResHeight.value, 10);
    if (isNaN(h) || h <= 0) return;
    state.customRes.height = h;

    if (state.customRes.aspectLocked) {
      const aspect = slide.width / slide.height;
      const w = Math.max(16, Math.round(h * aspect));
      state.customRes.width = w;
      if (el.customResWidth) el.customResWidth.value = w;
    }
    updateScalePillsUI(null);
    updateCustomDownloadButtonUI();
  }

  function toggleAspectLock() {
    state.customRes.aspectLocked = !state.customRes.aspectLocked;
    updateAspectLockButtonUI();
  }

  function updateAspectLockButtonUI() {
    if (!el.btnToggleAspectLock) return;
    const locked = state.customRes.aspectLocked;
    el.btnToggleAspectLock.classList.toggle("active", locked);
    el.btnToggleAspectLock.title = locked
      ? "Aspect Ratio Locked (Proportional width & height)"
      : "Aspect Ratio Unlocked (Free independent width & height)";
    if (el.aspectLockIcon) {
      el.aspectLockIcon.innerHTML = locked
        ? `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`
        : `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>`;
    }
  }

  function updateScalePillsUI(activeScale) {
    document.querySelectorAll(".scale-pill").forEach((pill) => {
      const sc = parseFloat(pill.dataset.scale);
      pill.classList.toggle("active", activeScale != null && Math.abs(sc - activeScale) < 0.05);
    });
  }

  function setCustomFormat(fmt) {
    state.customRes.format = fmt;
    updateFormatChipsUI(fmt);
    updateCustomDownloadButtonUI();
  }

  function updateFormatChipsUI(fmt) {
    document.querySelectorAll(".format-chip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.format === fmt);
    });
  }

  function updateCustomDownloadButtonUI() {
    const slide = getActiveSlide();
    if (!slide) return;
    const w = state.customRes.width || slide.width;
    const h = state.customRes.height || slide.height;
    const fmt = (state.customRes.format || "png").toUpperCase();
    const isUpscaled = w > slide.width || h > slide.height;

    if (el.btnDownloadCustomText) {
      el.btnDownloadCustomText.textContent = `Download Cutout (${w} × ${h} px • ${fmt})`;
    }

    if (el.upscaleNote) {
      if (isUpscaled) {
        const factor = (Math.max(w / slide.width, h / slide.height)).toFixed(1);
        el.upscaleNote.textContent = `✨ Upscaling ${factor}×: Lanczos sinc + adaptive detail sharpening active.`;
        el.upscaleNote.style.color = "var(--accent)";
      } else {
        el.upscaleNote.textContent = `Standard export: Full color defringing and alpha mask preservation.`;
        el.upscaleNote.style.color = "var(--text-muted)";
      }
    }
  }

  function downloadCustomResolution() {
    const slide = getActiveSlide();
    if (!slide) return;
    const w = state.customRes.width || slide.width;
    const h = state.customRes.height || slide.height;
    const fmt = state.customRes.format || "png";
    const enhance = el.chkCustomEnhance ? el.chkCustomEnhance.checked : true;

    closeDownloadMenu();
    exportSlide(slide, w, h, fmt, enhance);
  }

  async function exportSlide(slide, targetWidth = null, targetHeight = null, format = "png", enhance = true) {
    if (!slide) return;

    el.btnDownload.disabled = true;
    const prevText = el.downloadBtnText ? el.downloadBtnText.textContent : "Download";
    if (el.downloadBtnText) el.downloadBtnText.textContent = "Exporting...";

    try {
      slide.maskCtx.putImageData(slide.maskImageData, 0, 0);
      let exported = false;

      // 1. Try backend export if available
      try {
        const maskBlob = await new Promise((resolve) =>
          slide.maskCanvas.toBlob(resolve, "image/png")
        );

        const formData = new FormData();
        formData.append("session_id", slide.sessionId);
        formData.append("mask_file", maskBlob, "mask.png");
        if (targetWidth && targetHeight) {
          formData.append("width", targetWidth);
          formData.append("height", targetHeight);
        }
        formData.append("format", format || "png");
        formData.append("enhance", enhance ? "true" : "false");

        const res = await fetch("/api/export", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          const blob = await res.blob();
          triggerDownload(blob, slide, targetWidth, targetHeight, format);
          exported = true;
        }
      } catch (_) {
        // Backend not available (Cloudflare Pages static hosting)
      }

      // 2. Client-side fallback: high-quality canvas export
      if (!exported) {
        await exportSlideCutoutLocally(slide, targetWidth, targetHeight, format, enhance);
      }
    } catch (err) {
      console.error(err);
      alert("Export failed: " + err.message);
    } finally {
      el.btnDownload.disabled = false;
      if (el.downloadBtnText) el.downloadBtnText.textContent = prevText;
    }
  }

  async function exportSlideCutoutLocally(slide, targetWidth, targetHeight, format, enhance) {
    const tw = targetWidth || slide.width;
    const th = targetHeight || slide.height;

    const outCanvas = document.createElement("canvas");
    outCanvas.width = tw;
    outCanvas.height = th;
    const ctx = outCanvas.getContext("2d");

    // Create composited source canvas
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = slide.width;
    tempCanvas.height = slide.height;
    const tempCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
    const imgData = tempCtx.createImageData(slide.width, slide.height);
    const oD = slide.origImageData.data;
    const mD = slide.maskImageData.data;
    const dD = imgData.data;
    const total = slide.width * slide.height * 4;

    for (let i = 0; i < total; i += 4) {
      dD[i] = oD[i];
      dD[i + 1] = oD[i + 1];
      dD[i + 2] = oD[i + 2];
      dD[i + 3] = mD[i];
    }
    tempCtx.putImageData(imgData, 0, 0);

    if (format === "jpg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, tw, th);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(tempCanvas, 0, 0, tw, th);

    const mime = format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
    const quality = (format === "jpg" || format === "webp") ? 0.95 : undefined;
    const blob = await new Promise((res) => outCanvas.toBlob(res, mime, quality));

    triggerDownload(blob, slide, tw, th, format);
  }

  function triggerDownload(blob, slide, targetWidth, targetHeight, format) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const dimSuffix =
      targetWidth && targetHeight
        ? `_${targetWidth}x${targetHeight}`
        : `_${slide.width}x${slide.height}`;
    const ext = format === "jpg" ? "jpg" : format === "webp" ? "webp" : "png";
    link.download = `${slide.filename}${dimSuffix}_cutout.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportAllSlidesBatch() {
    if (state.slides.length === 0) return;

    el.btnDownload.disabled = true;
    const prevText = el.downloadBtnText ? el.downloadBtnText.textContent : "Download";
    if (el.downloadBtnText) el.downloadBtnText.textContent = "Packing ZIP...";

    try {
      let exported = false;

      // 1. Try backend export if available
      try {
        const formData = new FormData();
        const sids = state.slides.map((s) => s.sessionId).join(",");
        formData.append("session_ids", sids);

        for (const s of state.slides) {
          s.maskCtx.putImageData(s.maskImageData, 0, 0);
          const maskBlob = await new Promise((resolve) =>
            s.maskCanvas.toBlob(resolve, "image/png")
          );
          formData.append(`mask_${s.sessionId}`, maskBlob, `mask_${s.sessionId}.png`);
        }

        const res = await fetch("/api/export-batch", {
          method: "POST",
          body: formData,
        });

        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "cutout_slides_all.zip";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          exported = true;
        }
      } catch (_) {
        // Backend not available (Cloudflare Pages static hosting)
      }

      // 2. Client-side ZIP export fallback
      if (!exported) {
        await exportAllSlidesBatchLocally();
      }
    } catch (err) {
      console.error(err);
      alert("Batch export error: " + err.message);
    } finally {
      el.btnDownload.disabled = false;
      if (el.downloadBtnText) el.downloadBtnText.textContent = prevText;
    }
  }

  async function exportAllSlidesBatchLocally() {
    if (typeof JSZip === "undefined") {
      // If JSZip not loaded, download each slide individually
      for (const s of state.slides) {
        await exportSlideCutoutLocally(s, s.width, s.height, "png", false);
      }
      return;
    }

    const zip = new JSZip();
    for (const s of state.slides) {
      const outCanvas = document.createElement("canvas");
      outCanvas.width = s.width;
      outCanvas.height = s.height;
      const ctx = outCanvas.getContext("2d");
      const imgData = ctx.createImageData(s.width, s.height);
      const oD = s.origImageData.data;
      const mD = s.maskImageData.data;
      const dD = imgData.data;
      const total = s.width * s.height * 4;
      for (let i = 0; i < total; i += 4) {
        dD[i] = oD[i];
        dD[i + 1] = oD[i + 1];
        dD[i + 2] = oD[i + 2];
        dD[i + 3] = mD[i];
      }
      ctx.putImageData(imgData, 0, 0);
      const blob = await new Promise((res) => outCanvas.toBlob(res, "image/png"));
      zip.file(`${s.filename}_cutout.png`, blob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "cutout_slides_all.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ==========================================
  // RESET ALL SLIDES
  // ==========================================

  async function resetAll() {
    if (state.slides.length > 0) {
      if (!confirm("Start fresh? All loaded images and edits will be cleared.")) {
        return;
      }
    }
    await clearSessionDB();
    state.slides = [];
    state.activeSlideIndex = 0;

    el.editorScreen.style.display = "none";
    el.editorControlsNav.style.display = "none";
    el.btnAddSlide.style.display = "none";
    el.btnNewImage.style.display = "none";
    el.downloadWrapper.style.display = "none";
    el.slideBar.style.display = "none";
    closeDownloadMenu();

    el.uploadScreen.style.display = "flex";
    el.fileInput.value = "";
    el.addMoreInput.value = "";
  }

  // ==========================================
  // KEYBOARD SHORTCUTS
  // ==========================================

  function handleKeyDown(e) {
    if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;

    if (e.key === "Escape") {
      const fsCard = document.querySelector(".slide-card.fullscreen-box");
      if (fsCard) {
        const sIdx = parseInt(fsCard.dataset.slideIndex, 10);
        if (state.slides[sIdx]) {
          toggleSlideFullscreen(state.slides[sIdx], fsCard, fsCard.querySelector(".btn-fullscreen"));
          e.preventDefault();
          return;
        }
      }
    }

    if (e.key === "Shift") {
      state.shiftDown = true;
      el.body.classList.add("shift-held");
    }
    if (e.key === "Control" || e.key === "Meta") {
      state.ctrlDown = true;
    }

    if (e.code === "Space" && !state.spaceDown) {
      state.spaceDown = true;
      if (state.viewMode === "single") {
        el.canvasViewport.classList.add("panning");
        el.brushCursor.style.display = "none";
      }
      e.preventDefault();
      return;
    }

    if ((e.key === "c" || e.key === "C" || e.key === "\\") && !e.repeat) {
      startCompare();
      return;
    }

    // Ctrl + S: Quick Download active cutout without browser Save HTML dialog
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      downloadPresetResolution(1.0);
      return;
    }

    // Ctrl + 0: Fit / Reset Zoom on active canvas
    if ((e.ctrlKey || e.metaKey) && e.key === "0") {
      e.preventDefault();
      resetActiveSlideZoom();
      return;
    }

    // Ctrl + = / Ctrl + +: Zoom In
    if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      zoomActiveSlideStep(1.2);
      return;
    }

    // Ctrl + -: Zoom Out
    if ((e.ctrlKey || e.metaKey) && e.key === "-") {
      e.preventDefault();
      zoomActiveSlideStep(1 / 1.2);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === "z" || e.key === "Z")) {
      e.preventDefault();
      undoActiveSlide();
      return;
    }

    if (
      ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "z" || e.key === "Z")) ||
      ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y"))
    ) {
      e.preventDefault();
      redoActiveSlide();
      return;
    }

    if (e.key === "e" || e.key === "E") setTool("erase");
    if (e.key === "r" || e.key === "R") setTool("restore");
    if (e.key === "m" || e.key === "M") setTool("magic");
    if (e.key === "a" || e.key === "A") setTool("auto");
    if (e.key === "0") resetActiveSlideZoom();

    if (e.key === "[") {
      el.brushSize.value = Math.max(4, state.brushSize - 5);
      el.brushSize.dispatchEvent(new Event("input"));
    } else if (e.key === "]") {
      el.brushSize.value = Math.min(250, state.brushSize + 5);
      el.brushSize.dispatchEvent(new Event("input"));
    }

    if (e.key === "=" || e.key === "+") zoomActiveSlideStep(1.2);
    if (e.key === "-") zoomActiveSlideStep(1 / 1.2);
  }

  function handleKeyUp(e) {
    if (e.key === "Shift") {
      state.shiftDown = false;
      el.body.classList.remove("shift-held");
    }
    if (e.key === "Control" || e.key === "Meta") {
      state.ctrlDown = false;
    }
    if (e.code === "Space") {
      state.spaceDown = false;
      if (!state.isPanning) {
        el.canvasViewport.classList.remove("panning");
        el.brushCursor.style.display = "block";
      }
    }
    if (e.key === "c" || e.key === "C" || e.key === "\\") {
      endCompare();
    }
  }

  window.addEventListener("blur", () => {
    state.shiftDown = false;
    state.ctrlDown = false;
    state.spaceDown = false;
    el.body.classList.remove("shift-held");
  });

  function zoomActiveSlideStep(factor) {
    const slide = getActiveSlide();
    if (!slide) return;
    if (state.viewMode === "single") {
      zoomStep(factor);
    } else {
      slide.zoom = Math.max(0.2, Math.min(15.0, (slide.zoom || 1.0) * factor));
      if (Math.abs(slide.zoom - 1.0) < 0.04) slide.zoom = 1.0;
      const card = document.querySelector(`.slide-card[data-slide-index="${state.activeSlideIndex}"]`);
      if (card) {
        const vc = card.querySelector("canvas");
        if (vc) vc.style.transform = `translate(${slide.panX || 0}px, ${slide.panY || 0}px) scale(${slide.zoom})`;
        const badge = card.querySelector(".slide-zoom-badge");
        if (badge) {
          if (slide.zoom !== 1.0) {
            badge.style.display = "inline-flex";
            badge.textContent = `${Math.round(slide.zoom * 100)}%`;
          } else {
            badge.style.display = "none";
          }
        }
      }
      scheduleSessionSave();
    }
  }

  function resetActiveSlideZoom() {
    const slide = getActiveSlide();
    if (!slide) return;
    if (state.viewMode === "single") {
      fitToViewport();
    } else {
      slide.zoom = 1.0;
      slide.panX = 0;
      slide.panY = 0;
      const card = document.querySelector(`.slide-card[data-slide-index="${state.activeSlideIndex}"]`);
      if (card) {
        const vc = card.querySelector("canvas");
        if (vc) vc.style.transform = "translate(0px, 0px) scale(1)";
        const badge = card.querySelector(".slide-zoom-badge");
        if (badge) badge.style.display = "none";
      }
      scheduleSessionSave();
    }
  }

  // ==========================================
  // MODEL INFO MODAL
  // ==========================================

  function showModelInfoModal() {
    const info = state.modelInfo || {
      model_name: "birefnet-general",
      display_name: "BiRefNet",
      license: "MIT",
      commercial_use: true,
      notes: "Commercial use allowed.",
    };

    el.modalTitle.textContent = `${info.display_name} — Licensing & Commercial Use`;
    el.modalContent.innerHTML = `
      <p style="margin-bottom: 0.75rem;">
        <strong>Active Model:</strong> ${info.display_name} (<code>${info.model_name}</code>)
      </p>
      <p style="margin-bottom: 0.75rem;">
        <strong>License:</strong> <span class="badge" style="display:inline-flex; font-size: 0.75rem;">${info.license}</span>
      </p>
      <p style="margin-bottom: 0.75rem;">
        <strong>Commercial Use:</strong>
        <span style="color: #10b981; font-weight: 700;">
          ${info.commercial_use ? "Allowed ✓" : "Restricted ✗"}
        </span>
      </p>
      <p style="margin-bottom: 0.75rem;">
        ${info.notes}
      </p>
      <p style="font-size: 0.8125rem; color: var(--text-muted); border-top: 1px solid var(--border-color); padding-top: 0.75rem; margin-top: 0.75rem;">
        Everything runs 100% locally on your machine with zero external network calls or cloud dependencies.
      </p>
    `;
    el.infoModal.style.display = "flex";
  }

  document.addEventListener("DOMContentLoaded", init);
})();
