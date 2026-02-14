import { config } from './config';
import { getToken } from './auth';

const getAuthHeaders = (): Record<string, string> => {
  const token = getToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return {
    'Content-Type': 'application/json',
    'X-Session-Token': token,
  };
};

// Draw a pixel via API
export const drawPixel = async (x: number, y: number, color: string): Promise<void> => {
  const res = await fetch(`${config.apiGateway}/web/draw`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ x, y, color }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
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
  const res = await fetch(`${config.apiGateway}/web/active-area`, {
    method: 'GET',
    headers: {
      'X-Session-Token': getToken() ?? '',
    },
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
  const res = await fetch(`${config.apiGateway}/web/canvas?${params.toString()}`, {
    method: 'GET',
    headers: {
      'X-Session-Token': getToken() ?? '',
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return (await res.json()) as CanvasWindowResponse;
};
