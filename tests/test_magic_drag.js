const fs = require("fs");
const path = require("path");

let appJs = fs.readFileSync(path.join(__dirname, "../static/app.js"), "utf8");
appJs = appJs.replace(/^\(function\s*\(\)\s*\{/m, "");
appJs = appJs.replace(/\}\)\(\);\s*$/m, "");

const mockElem = () => ({
  style: {},
  classList: { add: () => {}, remove: () => {}, toggle: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  appendChild: () => {},
  querySelector: () => mockElem(),
  querySelectorAll: () => [],
});

const window = {
  addEventListener: () => {},
  removeEventListener: () => {},
};
const document = {
  body: mockElem(),
  getElementById: () => mockElem(),
  querySelector: () => mockElem(),
  querySelectorAll: () => [],
  addEventListener: () => {},
  createElement: () => mockElem(),
};
const localStorage = { getItem: () => null, setItem: () => {} };
const sessionStorage = { getItem: () => "mock-tab", setItem: () => {} };

const vm = require("vm");
const context = {
  window,
  document,
  localStorage,
  sessionStorage,
  console,
  Math,
  setTimeout,
  clearTimeout,
  Infinity,
  Map,
};
vm.createContext(context);
vm.runInContext(appJs, context);

vm.runInContext(
  `
  const width = 100, height = 100;
  const total = width * height * 4;
  const origData = new Uint8ClampedArray(total);
  const maskData = new Uint8ClampedArray(total);
  const viewData = new Uint8ClampedArray(total);

  // Left half: #1323 (19, 35, 100)
  // Right half: Red (220, 20, 20)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (x < 50) {
        origData[idx] = 19; origData[idx+1] = 35; origData[idx+2] = 100;
      } else {
        origData[idx] = 220; origData[idx+1] = 20; origData[idx+2] = 20;
      }
      origData[idx+3] = 255;
      maskData[idx] = 255; maskData[idx+1] = 255; maskData[idx+2] = 255; maskData[idx+3] = 255;
    }
  }

  const slide = {
    width, height,
    origImageData: { data: origData },
    maskImageData: { data: maskData },
    viewImageData: { data: viewData },
    viewCtx: { putImageData: () => {} },
    undoStack: [],
    redoStack: [],
  };

  state.slides = [slide];
  state.activeSlideIndex = 0;
  state.activeTool = "magic";
  state.magic = true;
  state.brushSize = 20;
  state.magicTolerance = 35;
  state.brushSoftness = 0;

  // 1. Click on (25, 25) which is color #1323
  beginStroke(slide, { x: 25, y: 25 });
  if (!state.startColor || state.startColor[0] !== 19 || state.startColor[1] !== 35) {
    throw new Error("Failed to sample startColor on click!");
  }

  const clickIdx = (25 * width + 25) * 4;
  if (maskData[clickIdx] !== 0) {
    throw new Error("Initial click stamp failed to erase target pixel!");
  }

  // 2. Continuous drag along y from 25 to 75 at x = 25
  for (let y = 26; y <= 75; y += 5) {
    continueStroke(slide, { x: 25, y });
  }

  for (let y = 25; y <= 75; y++) {
    const idx = (y * width + 25) * 4;
    if (maskData[idx] !== 0) {
      throw new Error("Pixel along drag path was not erased at y=" + y + " alpha=" + maskData[idx]);
    }
  }
  console.log("[PASS] Continuous drag erasing over target color verified.");

  // 3. Drag across into the red side (x = 75, y = 50)
  continueStroke(slide, { x: 75, y: 50 });
  const redIdx = (50 * width + 75) * 4;
  if (maskData[redIdx] !== 255) {
    throw new Error("Red pixel was improperly erased! Alpha=" + maskData[redIdx]);
  }
  console.log("[PASS] Dragging over non-matching color preserves it untouched.");

  // 4. Drag back into target color side (x = 25, y = 85)
  continueStroke(slide, { x: 25, y: 85 });
  const backIdx = (85 * width + 25) * 4;
  if (maskData[backIdx] !== 0) {
    throw new Error("Dragging back into target color failed to erase! Alpha=" + maskData[backIdx]);
  }
  console.log("[PASS] Dragging back into target color erases continuously without releasing mouse.");

  endStroke();
  console.log("[PASS] endStroke committed undo state: stack length =", slide.undoStack.length);

  // 5. Test starting drag on a transparent pixel and latching
  for (let dy = -10; dy <= 10; dy++) {
    for (let dx = -10; dx <= 10; dx++) {
      const idx = ((10 + dy) * width + (10 + dx)) * 4;
      if (idx >= 0 && idx < maskData.length) maskData[idx] = 0;
    }
  }
  beginStroke(slide, { x: 10, y: 10 });
  continueStroke(slide, { x: 10, y: 40 });
  if (!state.startColor) {
    throw new Error("Failed to latch startColor when dragging from transparent to visible!");
  }
  console.log("[PASS] Successfully latched startColor when entering visible image:", state.startColor);
  endStroke();
`,
  context
);
