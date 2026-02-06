import { config } from './config';
import { getToken } from './auth';

// Draw a pixel via API
export const drawPixel = async (x: number, y: number, color: string): Promise<void> => {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');

  const res = await fetch(`${config.apiGateway}/web/draw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-Token': token,
    },
    body: JSON.stringify({ x, y, color }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
};

// Get active area bounds
export const getActiveArea = async (): Promise<{ minX: number; minY: number; maxX: number; maxY: number }> => {
  const res = await fetch(`${config.apiGateway}/web/canvas`);
  if (!res.ok) throw new Error('Failed to fetch canvas info');
  return res.json();
};

// Get pixels for a chunk (used as fallback if Firestore unavailable)
export const getChunkPixels = async (chunkX: number, chunkY: number): Promise<Pixel[]> => {
  const res = await fetch(`${config.apiGateway}/web/pixels?chunk=${chunkX}_${chunkY}`);
  if (!res.ok) throw new Error('Failed to fetch pixels');
  const data = await res.json();
  return data.pixels || [];
};

export type Pixel = {
  x: number;
  y: number;
  color: string;
  authorId: string;
  updatedAt: string | null;
};
