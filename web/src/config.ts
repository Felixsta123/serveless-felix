const toNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toNonEmptyString = (value: string | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const apiGatewayBase =
  toNonEmptyString(import.meta.env.VITE_API_GATEWAY_URL) ??
  'https://serverless-felix-dev-gateway-e0uxaqsd.ew.gateway.dev';
const apiGatewayKey = toNonEmptyString(import.meta.env.VITE_API_GATEWAY_KEY);

const joinGatewayPath = (path: string): string => {
  const normalizedBase = apiGatewayBase.endsWith('/')
    ? apiGatewayBase.slice(0, -1)
    : apiGatewayBase;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};

const gatewayUrl = (
  path: string,
  query: Record<string, string | number | null | undefined> = {},
): string => {
  const url = new URL(joinGatewayPath(path));
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  if (apiGatewayKey && !url.searchParams.has('key')) {
    url.searchParams.set('key', apiGatewayKey);
  }
  return url.toString();
};

export const config = {
  apiGateway: apiGatewayBase,
  apiGatewayKey,
  gatewayUrl,
  chunkSize: toNumber(import.meta.env.VITE_CANVAS_CHUNK_SIZE, 50),
  pixelSize: toNumber(import.meta.env.VITE_CANVAS_PIXEL_SIZE, 10),
  canvasSize: toNumber(import.meta.env.VITE_CANVAS_SIZE, 500),
  firebase: {
    apiKey:
      import.meta.env.VITE_FIREBASE_API_KEY ?? 'AIzaSyDtV-y83u0o8xvp3ChbMsKSMeFrta8F0lI',
    authDomain:
      import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'serverless-felix-dev.firebaseapp.com',
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'serverless-felix-dev',
    appId:
      import.meta.env.VITE_FIREBASE_APP_ID ??
      '1:1098968211229:web:e418b9a850b112a9528bf4',
    storageBucket:
      import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ??
      'serverless-felix-dev.firebasestorage.app',
    messagingSenderId:
      import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '1098968211229',
  },
};
