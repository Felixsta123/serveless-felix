const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  apiGateway:
    import.meta.env.VITE_API_GATEWAY_URL ??
    'https://serverless-felix-dev-gateway-e0uxaqsd.ew.gateway.dev',
  chunkSize: toNumber(import.meta.env.VITE_CANVAS_CHUNK_SIZE, 50),
  pixelSize: toNumber(import.meta.env.VITE_CANVAS_PIXEL_SIZE, 10),
  canvasSize: toNumber(import.meta.env.VITE_CANVAS_SIZE, 500),
};
