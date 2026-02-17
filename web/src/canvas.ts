import { config } from './config';
import { getActiveArea as fetchActiveArea, getCanvasWindow } from './api';
import type { ActiveArea, Pixel } from './api';
import {
  ensureRealtimeAuth,
  setRealtimeCustomToken,
  signOutRealtime,
  watchActiveArea,
  watchChunkPixels,
} from './realtime';

type CanvasState = {
  pixels: Map<string, Pixel>;
  offsetX: number;
  offsetY: number;
  selected: { x: number; y: number } | null;
  activeRoundId: string | null;
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
let viewportFetchTimer: number | null = null;
let fallbackPollTimer: number | null = null;
let realtimePrimeTimer: number | null = null;
let activeAreaUnsubscribe: (() => void) | null = null;
let realtimeStartPromise: Promise<boolean> | null = null;
let realtimeEnabled = false;
let realtimeErrors = 0;
const chunkUnsubById = new Map<string, () => void>();
const chunkCache = new Map<string, Map<string, Pixel>>();

let isPanning = false;
let dragMoved = false;
let suppressClick = false;
let panStartMouseX = 0;
let panStartMouseY = 0;
let panStartOffsetX = 0;
let panStartOffsetY = 0;
let renderQueued = false;

const VIEWPORT_FETCH_DEBOUNCE_MS = 100;
const REALTIME_PRIME_DELAY_MS = 150;
const FALLBACK_POLL_INTERVAL_MS = 3000;
const MAX_REALTIME_ERRORS = 5;
const SUBSCRIPTION_MARGIN_CHUNKS = 1;
const DRAG_THRESHOLD_PX = 3;
const KEY_PAN_STEP = 5;
const CANVAS_BG_COLOR = '#09090b';
const GRID_COLOR = '#27272a';
const SELECTION_COLOR = '#fafafa';

const key = (x: number, y: number) => `${x}_${y}`;
const chunkIdFor = (x: number, y: number) =>
  `${Math.floor(x / config.chunkSize)}_${Math.floor(y / config.chunkSize)}`;

const toIso = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    try {
      return ((value as { toDate: () => Date }).toDate()).toISOString();
    } catch {
      return null;
    }
  }
  return null;
};

const toInt = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
};

const parsePixel = (data: Record<string, unknown>): Pixel | null => {
  const x = toInt(data.x);
  const y = toInt(data.y);
  const color = typeof data.color === 'string' ? data.color : null;
  const authorId = typeof data.authorId === 'string' ? data.authorId : null;
  if (x === null || y === null || !color || !authorId) {
    return null;
  }
  return {
    x,
    y,
    color,
    authorId,
    updatedAt: toIso(data.updatedAt),
  };
};

const applyRoundId = (nextRoundId: string | null): boolean => {
  if (state.activeRoundId === nextRoundId) {
    return false;
  }
  state.activeRoundId = nextRoundId;
  state.pixels.clear();
  chunkCache.clear();
  return true;
};

const getViewSize = (): number => Math.max(1, Math.floor(config.canvasSize / config.pixelSize));

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

const chunkIdsForWindow = (marginChunks = 0): string[] => {
  const { minX, minY, maxX, maxY } = getWindowBounds();
  const minChunkX = Math.floor(minX / config.chunkSize) - marginChunks;
  const minChunkY = Math.floor(minY / config.chunkSize) - marginChunks;
  const maxChunkX = Math.floor(maxX / config.chunkSize) + marginChunks;
  const maxChunkY = Math.floor(maxY / config.chunkSize) + marginChunks;

  const ids: string[] = [];
  for (let cx = minChunkX; cx <= maxChunkX; cx++) {
    for (let cy = minChunkY; cy <= maxChunkY; cy++) {
      ids.push(`${cx}_${cy}`);
    }
  }
  return ids;
};

const hasVisibleChunkCoverage = (): boolean => {
  const required = chunkIdsForWindow(0);
  for (const chunkId of required) {
    if (!chunkCache.has(chunkId)) {
      return false;
    }
  }
  return true;
};

const scheduleRender = (): void => {
  if (renderQueued) {
    return;
  }
  renderQueued = true;
  window.requestAnimationFrame(() => {
    renderQueued = false;
    render();
    window.dispatchEvent(new CustomEvent('canvasUpdated'));
  });
};

const repaintVisibleFromCache = (): void => {
  const bounds = getWindowBounds();
  const next = new Map<string, Pixel>();

  for (const chunkId of chunkIdsForWindow()) {
    const chunk = chunkCache.get(chunkId);
    if (!chunk) {
      continue;
    }
    for (const pixel of chunk.values()) {
      if (
        pixel.x >= bounds.minX &&
        pixel.x <= bounds.maxX &&
        pixel.y >= bounds.minY &&
        pixel.y <= bounds.maxY
      ) {
        next.set(key(pixel.x, pixel.y), pixel);
      }
    }
  }

  state.pixels = next;
  scheduleRender();
};

const stopFallbackPolling = (): void => {
  if (fallbackPollTimer !== null) {
    window.clearInterval(fallbackPollTimer);
    fallbackPollTimer = null;
  }
};

const stopRealtimePrime = (): void => {
  if (realtimePrimeTimer !== null) {
    window.clearTimeout(realtimePrimeTimer);
    realtimePrimeTimer = null;
  }
};

const stopChunkListeners = (): void => {
  for (const unsub of chunkUnsubById.values()) {
    unsub();
  }
  chunkUnsubById.clear();
};

const disableRealtime = (): void => {
  realtimeEnabled = false;
  stopChunkListeners();
  if (activeAreaUnsubscribe) {
    activeAreaUnsubscribe();
    activeAreaUnsubscribe = null;
  }
};

const notifyRealtimeError = (error: unknown): void => {
  realtimeErrors += 1;
  if (realtimeErrors < MAX_REALTIME_ERRORS) {
    return;
  }
  console.error('Realtime disabled after repeated errors', error);
  disableRealtime();
  startFallbackPolling();
};

const refreshVisibleFromApi = async (): Promise<void> => {
  try {
    const bounds = getWindowBounds();
    const payload = await getCanvasWindow(bounds.minX, bounds.minY, bounds.size);

    if (applyRoundId(payload.roundId)) {
      stopChunkListeners();
      if (realtimeEnabled) {
        syncChunkSubscriptions();
      }
    }

    const freshVisible = new Map<string, Pixel>();
    for (const pixel of payload.pixels) {
      const pixelKey = key(pixel.x, pixel.y);
      freshVisible.set(pixelKey, pixel);

      const chunkId = chunkIdFor(pixel.x, pixel.y);
      let chunk = chunkCache.get(chunkId);
      if (!chunk) {
        chunk = new Map<string, Pixel>();
        chunkCache.set(chunkId, chunk);
      }
      chunk.set(pixelKey, pixel);
    }

    state.pixels = freshVisible;
    scheduleRender();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    window.dispatchEvent(new CustomEvent('canvasError', { detail: { error: message } }));
  }
};

const scheduleViewportFetch = (delayMs = VIEWPORT_FETCH_DEBOUNCE_MS): void => {
  if (viewportFetchTimer !== null) {
    window.clearTimeout(viewportFetchTimer);
  }
  viewportFetchTimer = window.setTimeout(() => {
    viewportFetchTimer = null;
    void refreshVisibleFromApi();
  }, delayMs);
};

const startFallbackPolling = (): void => {
  if (fallbackPollTimer !== null) {
    return;
  }
  stopRealtimePrime();
  scheduleViewportFetch(0);
  fallbackPollTimer = window.setInterval(() => {
    void refreshVisibleFromApi();
  }, FALLBACK_POLL_INTERVAL_MS);
};

const scheduleRealtimePrime = (): void => {
  if (!realtimeEnabled) {
    return;
  }
  stopRealtimePrime();
  realtimePrimeTimer = window.setTimeout(() => {
    realtimePrimeTimer = null;
    if (!hasVisibleChunkCoverage()) {
      void refreshVisibleFromApi();
    }
  }, REALTIME_PRIME_DELAY_MS);
};

const applyChunkSnapshot = (
  chunkId: string,
  changes: Array<{
    type: 'added' | 'modified' | 'removed';
    data: Record<string, unknown>;
  }>,
): void => {
  let chunk = chunkCache.get(chunkId);
  if (!chunk) {
    chunk = new Map<string, Pixel>();
  }

  for (const change of changes) {
    const pixel = parsePixel(change.data);
    if (!pixel) {
      continue;
    }
    const pixelKey = key(pixel.x, pixel.y);

    if (change.type === 'removed') {
      chunk.delete(pixelKey);
      if (pixelInsideWindow(pixel.x, pixel.y)) {
        state.pixels.delete(pixelKey);
      }
      continue;
    }

    chunk.set(pixelKey, pixel);
    if (pixelInsideWindow(pixel.x, pixel.y)) {
      state.pixels.set(pixelKey, pixel);
    }
  }

  if (chunk.size === 0) {
    chunkCache.delete(chunkId);
  } else {
    chunkCache.set(chunkId, chunk);
  }

  realtimeErrors = 0;
  stopRealtimePrime();
  scheduleRender();
};

const syncChunkSubscriptions = (): void => {
  if (!realtimeEnabled) {
    return;
  }

  const needed = new Set(chunkIdsForWindow(SUBSCRIPTION_MARGIN_CHUNKS));

  for (const [chunkId, unsub] of chunkUnsubById.entries()) {
    if (!needed.has(chunkId)) {
      unsub();
      chunkUnsubById.delete(chunkId);
    }
  }

  for (const chunkId of needed) {
    if (chunkUnsubById.has(chunkId)) {
      continue;
    }

    const unsub = watchChunkPixels(
      chunkId,
      state.activeRoundId,
      (snapshot) => {
        realtimeErrors = 0;
        const changes = snapshot.docChanges().map((change) => ({
          type: change.type,
          data: change.doc.data() as Record<string, unknown>,
        }));
        applyChunkSnapshot(chunkId, changes);
      },
      (error) => {
        notifyRealtimeError(error);
      },
    );

    chunkUnsubById.set(chunkId, unsub);
  }
};

const startRealtime = async (): Promise<boolean> => {
  if (realtimeEnabled) {
    return true;
  }

  if (realtimeStartPromise) {
    return realtimeStartPromise;
  }

  realtimeStartPromise = (async () => {
    try {
      const authed = await ensureRealtimeAuth();
      if (!authed) {
        startFallbackPolling();
        return false;
      }

      realtimeEnabled = true;
      realtimeErrors = 0;
      stopFallbackPolling();

      if (!activeAreaUnsubscribe) {
        activeAreaUnsubscribe = watchActiveArea(
          (data) => {
            realtimeErrors = 0;
            const nextRoundId =
              data && typeof data.roundId === 'string' && data.roundId.trim() !== ''
                ? data.roundId
                : null;
            if (applyRoundId(nextRoundId)) {
              stopChunkListeners();
              repaintVisibleFromCache();
              syncChunkSubscriptions();
              scheduleRealtimePrime();
            }
          },
          (error) => {
            notifyRealtimeError(error);
          },
        );
      }

      repaintVisibleFromCache();
      syncChunkSubscriptions();
      scheduleRealtimePrime();
      return true;
    } catch (error) {
      notifyRealtimeError(error);
      return false;
    } finally {
      realtimeStartPromise = null;
    }
  })();

  return realtimeStartPromise;
};

export const setRealtimeToken = (token: string | null): void => {
  setRealtimeCustomToken(token);
};

export const signOutRealtimeClient = async (): Promise<void> => {
  disableRealtime();
  stopFallbackPolling();
  stopRealtimePrime();
  await signOutRealtime();
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
    if (realtimeEnabled) {
      repaintVisibleFromCache();
      syncChunkSubscriptions();
      scheduleRealtimePrime();
    } else {
      void startRealtime().then((started) => {
        if (started) {
          repaintVisibleFromCache();
          syncChunkSubscriptions();
          scheduleRealtimePrime();
        } else {
          scheduleViewportFetch(0);
        }
      });
    }
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

export const upsertPixel = (pixel: Pixel): void => {
  const pixelKey = key(pixel.x, pixel.y);
  const chunkId = chunkIdFor(pixel.x, pixel.y);

  let chunk = chunkCache.get(chunkId);
  if (!chunk) {
    chunk = new Map<string, Pixel>();
    chunkCache.set(chunkId, chunk);
  }
  chunk.set(pixelKey, pixel);

  if (pixelInsideWindow(pixel.x, pixel.y)) {
    state.pixels.set(pixelKey, pixel);
    scheduleRender();
  }
};

export const getActiveArea = async (): Promise<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  roundId: string | null;
}> => {
  const area = await fetchActiveArea();
  if (applyRoundId(area.roundId)) {
    stopChunkListeners();
  }

  const started = await startRealtime();
  if (started) {
    repaintVisibleFromCache();
    syncChunkSubscriptions();
    scheduleRealtimePrime();
  } else {
    scheduleViewportFetch(0);
  }

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
    }),
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
  disableRealtime();
  stopFallbackPolling();
  stopRealtimePrime();

  if (viewportFetchTimer !== null) {
    window.clearTimeout(viewportFetchTimer);
    viewportFetchTimer = null;
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
