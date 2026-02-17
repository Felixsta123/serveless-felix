import { config } from './config';
import { getActiveArea as fetchActiveArea, getCanvasWindow } from './api';
import type { ActiveArea, Pixel } from './api';

type CanvasState = {
  pixels: Map<string, Pixel>;
  offsetX: number;
  offsetY: number;
  selected: { x: number; y: number } | null;
  activeRoundId: string | null;
};

type StreamSnapshotPayload = {
  roundId: string | null;
  window: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    size: number;
  };
  activeArea: ActiveArea;
  pixels: Pixel[];
};

const state: CanvasState = {
  pixels: new Map(),
  offsetX: 0,
  offsetY: 0,
  selected: null,
  activeRoundId: null,
};

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let stream: EventSource | null = null;
let viewportRefreshTimer: number | null = null;
let isPanning = false;
let dragMoved = false;
let suppressClick = false;
let panStartMouseX = 0;
let panStartMouseY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;
let lastStreamErrorAt = 0;
let streamErrorCount = 0;
let fallbackPollTimer: number | null = null;

const VIEWPORT_REFRESH_DEBOUNCE_MS = 250;
const FALLBACK_POLL_INTERVAL_MS = 2500;
const DRAG_THRESHOLD_PX = 3;
const KEY_PAN_STEP = 5;
const CANVAS_BG_COLOR = '#09090b';
const GRID_COLOR = '#27272a';
const SELECTION_COLOR = '#fafafa';

const key = (x: number, y: number) => `${x}_${y}`;

const applyRoundId = (nextRoundId: string | null): boolean => {
  if (state.activeRoundId === nextRoundId) {
    return false;
  }
  state.activeRoundId = nextRoundId;
  state.pixels.clear();
  return true;
};

const getViewSize = (): number => {
  return Math.max(1, Math.floor(config.canvasSize / config.pixelSize));
};

const parseStreamPayload = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const getWindowBounds = () => {
  const size = getViewSize();
  return {
    minX: state.offsetX,
    minY: state.offsetY,
    maxX: state.offsetX + size - 1,
    maxY: state.offsetY + size - 1,
    size,
  };
};

const pixelInsideWindow = (x: number, y: number): boolean => {
  const bounds = getWindowBounds();
  return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
};

const applySnapshot = (payload: StreamSnapshotPayload): void => {
  const roundChanged = applyRoundId(payload.roundId);

  if (roundChanged) {
    state.selected = null;
  }

  state.pixels.clear();
  for (const pixel of payload.pixels) {
    state.pixels.set(key(pixel.x, pixel.y), pixel);
  }

  render();
  window.dispatchEvent(new CustomEvent('canvasUpdated'));
};

const applyPixelUpdate = (pixel: Pixel): void => {
  if (!pixelInsideWindow(pixel.x, pixel.y)) {
    return;
  }
  state.pixels.set(key(pixel.x, pixel.y), pixel);
  render();
  window.dispatchEvent(new CustomEvent('canvasUpdated'));
};

const refreshVisibleFromApi = async (): Promise<void> => {
  try {
    const bounds = getWindowBounds();
    const payload = await getCanvasWindow(bounds.minX, bounds.minY, bounds.size);
    applySnapshot({
      ...payload,
      activeArea: {
        ...payload.activeArea,
        roundId: payload.roundId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    window.dispatchEvent(new CustomEvent('canvasError', { detail: { error: message } }));
  }
};

const stopFallbackPolling = (): void => {
  if (fallbackPollTimer !== null) {
    window.clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
};

const ensureFallbackPolling = (): void => {
  if (fallbackPollTimer !== null) {
    return;
  }
  void refreshVisibleFromApi();
  fallbackPollTimer = window.setInterval(() => {
    void refreshVisibleFromApi();
  }, FALLBACK_POLL_INTERVAL_MS);
};

const scheduleViewportRefresh = (): void => {
  if (viewportRefreshTimer !== null) {
    window.clearTimeout(viewportRefreshTimer);
  }
  viewportRefreshTimer = window.setTimeout(() => {
    viewportRefreshTimer = null;
    void refreshVisibleFromApi();
  }, VIEWPORT_REFRESH_DEBOUNCE_MS);
};

const closeStream = (): void => {
  if (stream) {
    stream.close();
    stream = null;
  }
};

const openStream = (): void => {
  closeStream();

  const bounds = getWindowBounds();
  const params = new URLSearchParams({
    offsetX: String(bounds.minX),
    offsetY: String(bounds.minY),
    size: String(bounds.size),
  });

  stream = new EventSource(`${config.apiGateway}/web/stream?${params.toString()}`, {
    withCredentials: true,
  });

  stream.addEventListener('snapshot', (event) => {
    if (!(event instanceof MessageEvent) || typeof event.data !== 'string') {
      return;
    }
    const payload = parseStreamPayload<StreamSnapshotPayload>(event.data);
    if (!payload) {
      return;
    }
    streamErrorCount = 0;
    stopFallbackPolling();
    applySnapshot(payload);
  });

  stream.addEventListener('pixel', (event) => {
    if (!(event instanceof MessageEvent) || typeof event.data !== 'string') {
      return;
    }
    const payload = parseStreamPayload<Pixel>(event.data);
    if (!payload) {
      return;
    }
    applyPixelUpdate(payload);
  });

  stream.addEventListener('active_area', (event) => {
    if (!(event instanceof MessageEvent) || typeof event.data !== 'string') {
      return;
    }
    const payload = parseStreamPayload<ActiveArea>(event.data);
    if (!payload) {
      return;
    }
    const roundChanged = applyRoundId(payload.roundId);
    if (roundChanged) {
      state.selected = null;
      state.pixels.clear();
      render();
      window.dispatchEvent(new CustomEvent('canvasUpdated'));
      scheduleViewportRefresh();
    }
  });

  stream.onerror = () => {
    streamErrorCount += 1;
    const now = Date.now();
    if (now - lastStreamErrorAt > 5000) {
      lastStreamErrorAt = now;
      window.dispatchEvent(
        new CustomEvent('canvasError', {
          detail: { error: 'Flux temps réel interrompu, reconnexion automatique...' },
        }),
      );
    }
    if (streamErrorCount >= 3) {
      closeStream();
      ensureFallbackPolling();
    }
  };
};

export const initCanvas = (el: HTMLCanvasElement): void => {
  canvas = el;
  ctx = canvas.getContext('2d');
  canvas.width = config.canvasSize;
  canvas.height = config.canvasSize;
  canvas.tabIndex = 0;
  canvas.addEventListener('click', handleClick);
  canvas.addEventListener('mousedown', handleMouseDown);
  canvas.addEventListener('wheel', handleWheel, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('keydown', handleKeyDown);
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  render();
};

export const getState = () => state;

export const setOffset = (x: number, y: number, resubscribe = true): void => {
  state.offsetX = Math.round(x);
  state.offsetY = Math.round(y);
  if (resubscribe) {
    if (!stream) {
      openStream();
    }
    scheduleViewportRefresh();
  }
  render();
  window.dispatchEvent(
    new CustomEvent('viewportChanged', {
      detail: { offsetX: state.offsetX, offsetY: state.offsetY },
    }),
  );
};

export const getPixelAt = (x: number, y: number): Pixel | null => {
  return state.pixels.get(key(x, y)) || null;
};

export const getActiveArea = async (): Promise<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  roundId: string | null;
}> => {
  const area = await fetchActiveArea();
  applyRoundId(area.roundId);
  return area;
};

const handleClick = (e: MouseEvent): void => {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const canvasX = (e.clientX - rect.left) * scaleX;
  const canvasY = (e.clientY - rect.top) * scaleY;

  const pixelX = Math.floor(canvasX / config.pixelSize) + state.offsetX;
  const pixelY = Math.floor(canvasY / config.pixelSize) + state.offsetY;

  state.selected = { x: pixelX, y: pixelY };

  const pixel = state.pixels.get(key(pixelX, pixelY));
  window.dispatchEvent(
    new CustomEvent('pixelSelected', {
      detail: { x: pixelX, y: pixelY, pixel: pixel || null },
    })
  );
  render();
};

const handleMouseDown = (event: MouseEvent): void => {
  if (!canvas) {
    return;
  }
  if (event.button !== 1 && !(event.button === 0 && event.shiftKey)) {
    return;
  }
  event.preventDefault();
  isPanning = true;
  dragMoved = false;
  panStartMouseX = event.clientX;
  panStartMouseY = event.clientY;
  panStartOffsetX = state.offsetX;
  panStartOffsetY = state.offsetY;
  canvas.style.cursor = 'grabbing';
};

const handleMouseMove = (event: MouseEvent): void => {
  if (!isPanning) {
    return;
  }
  const dx = event.clientX - panStartMouseX;
  const dy = event.clientY - panStartMouseY;
  if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
    dragMoved = true;
  }

  const worldDx = Math.round(dx / config.pixelSize);
  const worldDy = Math.round(dy / config.pixelSize);
  setOffset(panStartOffsetX - worldDx, panStartOffsetY - worldDy);
};

const handleMouseUp = (): void => {
  if (!isPanning) {
    return;
  }
  isPanning = false;
  if (canvas) {
    canvas.style.cursor = 'crosshair';
  }
  if (dragMoved) {
    suppressClick = true;
  }
};

const handleWheel = (event: WheelEvent): void => {
  if (!canvas) {
    return;
  }
  event.preventDefault();
  const worldDx = Math.round(event.deltaX / config.pixelSize);
  const worldDy = Math.round(event.deltaY / config.pixelSize);
  if (worldDx === 0 && worldDy === 0) {
    return;
  }
  setOffset(state.offsetX + worldDx, state.offsetY + worldDy);
};

const handleKeyDown = (event: KeyboardEvent): void => {
  let dx = 0;
  let dy = 0;
  switch (event.key) {
    case 'ArrowLeft':
      dx = -KEY_PAN_STEP;
      break;
    case 'ArrowRight':
      dx = KEY_PAN_STEP;
      break;
    case 'ArrowUp':
      dy = -KEY_PAN_STEP;
      break;
    case 'ArrowDown':
      dy = KEY_PAN_STEP;
      break;
    default:
      return;
  }
  event.preventDefault();
  setOffset(state.offsetX + dx, state.offsetY + dy);
};

const render = (): void => {
  if (!ctx || !canvas) return;

  ctx.fillStyle = CANVAS_BG_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 0.5;
  const viewPixels = config.canvasSize / config.pixelSize;
  for (let i = 0; i <= viewPixels; i++) {
    const pos = i * config.pixelSize;
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(canvas.width, pos);
    ctx.stroke();
  }

  for (const [, pixel] of state.pixels) {
    const screenX = (pixel.x - state.offsetX) * config.pixelSize;
    const screenY = (pixel.y - state.offsetY) * config.pixelSize;

    if (screenX >= 0 && screenX < canvas.width && screenY >= 0 && screenY < canvas.height) {
      ctx.fillStyle = pixel.color;
      ctx.fillRect(screenX, screenY, config.pixelSize, config.pixelSize);
    }
  }

  if (state.selected) {
    const selX = (state.selected.x - state.offsetX) * config.pixelSize;
    const selY = (state.selected.y - state.offsetY) * config.pixelSize;
    if (selX >= 0 && selX < canvas.width && selY >= 0 && selY < canvas.height) {
      ctx.strokeStyle = SELECTION_COLOR;
      ctx.lineWidth = 2;
      ctx.strokeRect(selX, selY, config.pixelSize, config.pixelSize);
    }
  }
};

export const unsubscribeAll = (): void => {
  closeStream();
  stopFallbackPolling();
  if (viewportRefreshTimer !== null) {
    window.clearTimeout(viewportRefreshTimer);
    viewportRefreshTimer = null;
  }
  if (canvas) {
    canvas.removeEventListener('click', handleClick);
    canvas.removeEventListener('mousedown', handleMouseDown);
    canvas.removeEventListener('wheel', handleWheel);
    canvas.removeEventListener('keydown', handleKeyDown);
  }
  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
};
