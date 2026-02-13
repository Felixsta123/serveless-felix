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

export type Pixel = {
  x: number;
  y: number;
  color: string;
  authorId: string;
  updatedAt: string | null;
};
