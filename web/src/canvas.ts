import {
  doc,
  getDoc,
  collection,
  onSnapshot,
  query,
  where,
  Unsubscribe,
  Timestamp,
} from 'firebase/firestore';
import { config } from './config';
import { db } from './firebase';
import type { Pixel } from './api';

// Canvas state
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
const chunkSubscriptions: Unsubscribe[] = [];
let activeAreaSubscription: Unsubscribe | null = null;

const key = (x: number, y: number) => `${x}_${y}`;
const toRoundId = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null;
const unsubscribeChunks = (): void => {
  chunkSubscriptions.forEach((unsub) => unsub());
  chunkSubscriptions.length = 0;
};
const applyRoundId = (nextRoundId: string | null): boolean => {
  if (state.activeRoundId === nextRoundId) {
    return false;
  }
  state.activeRoundId = nextRoundId;
  state.pixels.clear();
  return true;
};
const ensureActiveAreaSubscription = (): void => {
  if (activeAreaSubscription) {
    return;
  }
  activeAreaSubscription = onSnapshot(
    doc(db, 'activeArea/current'),
    (snapshot) => {
      const nextRoundId = snapshot.exists() ? toRoundId(snapshot.data().roundId) : null;
      if (!applyRoundId(nextRoundId)) {
        return;
      }
      unsubscribeChunks();
      subscribeVisible();
      render();
      window.dispatchEvent(new CustomEvent('canvasUpdated'));
    },
    (error) => {
      console.error('Active area listener error:', error);
      window.dispatchEvent(new CustomEvent('canvasError', { detail: { error: error.message } }));
    }
  );
};

// Initialize canvas element
export const initCanvas = (el: HTMLCanvasElement): void => {
  canvas = el;
  ctx = canvas.getContext('2d');
  canvas.width = config.canvasSize;
  canvas.height = config.canvasSize;
  canvas.addEventListener('click', handleClick);
  render();
};

// Get canvas state
export const getState = () => state;

// Set view offset
export const setOffset = (x: number, y: number, resubscribe = true): void => {
  state.offsetX = x;
  state.offsetY = y;
  unsubscribeChunks();
  if (resubscribe) {
    subscribeVisible();
  }
  render();
};

// Get pixel at position
export const getPixelAt = (x: number, y: number): Pixel | null => {
  return state.pixels.get(key(x, y)) || null;
};

// Read active area bounds from Firestore
export const getActiveArea = async (): Promise<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  roundId: string | null;
}> => {
  const snap = await getDoc(doc(db, 'activeArea/current'));
  if (!snap.exists()) {
    applyRoundId(null);
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, roundId: null };
  }
  const data = snap.data();
  applyRoundId(toRoundId(data.roundId));
  return {
    minX: data.minX ?? 0,
    minY: data.minY ?? 0,
    maxX: data.maxX ?? 0,
    maxY: data.maxY ?? 0,
    roundId: state.activeRoundId,
  };
};

// Handle canvas click
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

  // Emit event for UI
  const pixel = state.pixels.get(key(pixelX, pixelY));
  window.dispatchEvent(
    new CustomEvent('pixelSelected', {
      detail: { x: pixelX, y: pixelY, pixel: pixel || null },
    })
  );
  render();
};

// Render canvas
const render = (): void => {
  if (!ctx || !canvas) return;

  // Clear
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid
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

  // Pixels
  for (const [, pixel] of state.pixels) {
    const screenX = (pixel.x - state.offsetX) * config.pixelSize;
    const screenY = (pixel.y - state.offsetY) * config.pixelSize;

    if (screenX >= 0 && screenX < canvas.width && screenY >= 0 && screenY < canvas.height) {
      ctx.fillStyle = pixel.color;
      ctx.fillRect(screenX, screenY, config.pixelSize, config.pixelSize);
    }
  }

  // Selection highlight
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

// Calculate visible chunks
const getVisibleChunks = (): Array<{ cx: number; cy: number }> => {
  const chunks: Array<{ cx: number; cy: number }> = [];
  const viewPixels = config.canvasSize / config.pixelSize;

  const startChunkX = Math.floor(state.offsetX / config.chunkSize);
  const startChunkY = Math.floor(state.offsetY / config.chunkSize);
  const endChunkX = Math.floor((state.offsetX + viewPixels) / config.chunkSize);
  const endChunkY = Math.floor((state.offsetY + viewPixels) / config.chunkSize);

  for (let cx = startChunkX; cx <= endChunkX; cx++) {
    for (let cy = startChunkY; cy <= endChunkY; cy++) {
      chunks.push({ cx, cy });
    }
  }
  return chunks;
};

// Subscribe to visible chunks (real-time Firestore)
export const subscribeVisible = (): void => {
  ensureActiveAreaSubscription();
  unsubscribeChunks();
  const chunks = getVisibleChunks();

  for (const { cx, cy } of chunks) {
    const chunkId = `${cx}_${cy}`;
    const pixelsRef = collection(db, `chunks/${chunkId}/pixels`);
    const q = state.activeRoundId
      ? query(pixelsRef, where('roundId', '==', state.activeRoundId))
      : query(pixelsRef);

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          const pixel: Pixel = {
            x: data.x,
            y: data.y,
            color: data.color,
            authorId: data.authorId,
            updatedAt: data.updatedAt instanceof Timestamp 
              ? data.updatedAt.toDate().toISOString() 
              : null,
          };

          if (change.type === 'removed') {
            state.pixels.delete(key(pixel.x, pixel.y));
          } else {
            state.pixels.set(key(pixel.x, pixel.y), pixel);
          }
        });
        render();
        window.dispatchEvent(new CustomEvent('canvasUpdated'));
      },
      (error) => {
        console.error('Firestore error:', error);
        window.dispatchEvent(new CustomEvent('canvasError', { detail: { error: error.message } }));
      }
    );

    chunkSubscriptions.push(unsub);
  }
};

// Unsubscribe all
export const unsubscribeAll = (): void => {
  unsubscribeChunks();
  if (activeAreaSubscription) {
    activeAreaSubscription();
    activeAreaSubscription = null;
  }
};
