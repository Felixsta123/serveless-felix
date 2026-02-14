import { config } from './config';
import { getActiveArea as fetchActiveArea, getCanvasWindow } from './api';
import type { Pixel } from './api';

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
let pollTimer: number | null = null;
let inFlight = false;

const POLL_INTERVAL_MS = 1000;

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
  return config.canvasSize / config.pixelSize;
};

const refreshVisible = async (): Promise<void> => {
  if (inFlight) {
    return;
  }
  inFlight = true;
  try {
    const size = getViewSize();
    const payload = await getCanvasWindow(state.offsetX, state.offsetY, size);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    window.dispatchEvent(new CustomEvent('canvasError', { detail: { error: message } }));
  } finally {
    inFlight = false;
  }
};

const ensurePolling = (): void => {
  if (pollTimer !== null) {
    return;
  }
  void refreshVisible();
  pollTimer = window.setInterval(() => {
    void refreshVisible();
  }, POLL_INTERVAL_MS);
};

export const initCanvas = (el: HTMLCanvasElement): void => {
  canvas = el;
  ctx = canvas.getContext('2d');
  canvas.width = config.canvasSize;
  canvas.height = config.canvasSize;
  canvas.addEventListener('click', handleClick);
  render();
};

export const getState = () => state;

export const setOffset = (x: number, y: number, resubscribe = true): void => {
  state.offsetX = x;
  state.offsetY = y;
  if (resubscribe) {
    ensurePolling();
    void refreshVisible();
  }
  render();
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

const render = (): void => {
  if (!ctx || !canvas) return;

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#333';
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
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(selX, selY, config.pixelSize, config.pixelSize);
    }
  }
};

export const subscribeVisible = (): void => {
  ensurePolling();
};

export const unsubscribeAll = (): void => {
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
};
