const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const requiredEnv = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
};

export const config = {
  apiGateway: requiredEnv(
    'VITE_API_GATEWAY_URL',
    import.meta.env.VITE_API_GATEWAY_URL,
  ),
  chunkSize: toNumber(import.meta.env.VITE_CANVAS_CHUNK_SIZE, 50),
  pixelSize: toNumber(import.meta.env.VITE_CANVAS_PIXEL_SIZE, 10),
  canvasSize: toNumber(import.meta.env.VITE_CANVAS_SIZE, 500),
};
