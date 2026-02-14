import { config } from './config';

const authFetch = (input: string, init: RequestInit = {}) =>
  fetch(input, {
    ...init,
    credentials: 'include',
  });

export const drawPixel = async (x: number, y: number, color: string): Promise<void> => {
  const res = await authFetch(`${config.apiGateway}/web/draw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ x, y, color }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
};

export const logoutSession = async (): Promise<void> => {
  await authFetch(`${config.apiGateway}/web/logout`, {
    method: 'POST',
  });
};

export type Pixel = {
  x: number;
  y: number;
  color: string;
  authorId: string;
  updatedAt: string | null;
};

export type ActiveArea = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  roundId: string | null;
};

export type CanvasWindowResponse = {
  roundId: string | null;
  window: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    size: number;
  };
  activeArea: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  pixels: Pixel[];
};

export const getActiveArea = async (): Promise<ActiveArea> => {
  const res = await authFetch(`${config.apiGateway}/web/active-area`, {
    method: 'GET',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return (await res.json()) as ActiveArea;
};

export const getCanvasWindow = async (
  offsetX: number,
  offsetY: number,
  size: number,
): Promise<CanvasWindowResponse> => {
  const params = new URLSearchParams({
    offsetX: String(offsetX),
    offsetY: String(offsetY),
    size: String(size),
  });
  const res = await authFetch(`${config.apiGateway}/web/canvas?${params.toString()}`, {
    method: 'GET',
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return (await res.json()) as CanvasWindowResponse;
};
