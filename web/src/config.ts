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
