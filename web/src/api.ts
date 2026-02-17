import { config } from './config';

const authFetch = (input: string, init: RequestInit = {}) =>
  fetch(input, {
    ...init,
    credentials: 'include',
  });

const REQUEST_POLL_INTERVAL_MS = 250;
const REQUEST_POLL_TIMEOUT_MS = 10000;

type PendingRequestResponse = {
  requestId?: unknown;
  status?: unknown;
};

type RequestStatusResponse = {
  status?: unknown;
  payload?: unknown;
  error?: unknown;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const parseHttpError = async (res: Response): Promise<Error> => {
  const err = await res.json().catch(() => ({} as Record<string, unknown>));
  const message = typeof err.error === 'string' ? err.error : `HTTP ${res.status}`;
  return new Error(message);
};

const waitForRequestResult = async <T>(requestId: string): Promise<T> => {
  const deadline = Date.now() + REQUEST_POLL_TIMEOUT_MS;
  const statusUrl = `${config.apiGateway}/web/request/${encodeURIComponent(requestId)}`;

  while (Date.now() < deadline) {
    const res = await authFetch(statusUrl, { method: 'GET' });

    if (res.status === 404) {
      await sleep(REQUEST_POLL_INTERVAL_MS);
      continue;
    }

    if (!res.ok) {
      throw await parseHttpError(res);
    }

    const body = (await res.json().catch(() => ({} as RequestStatusResponse))) as RequestStatusResponse;
    const status =
      body.status === 'pending' || body.status === 'ready' || body.status === 'error'
        ? body.status
        : 'pending';

    if (status === 'pending') {
      await sleep(REQUEST_POLL_INTERVAL_MS);
      continue;
    }

    if (status === 'error') {
      throw new Error(typeof body.error === 'string' ? body.error : 'Request failed');
    }

    return body.payload as T;
  }

  throw new Error('Timed out while waiting for request result');
};

const getOrWaitPayload = async <T>(url: string): Promise<T> => {
  const res = await authFetch(url, { method: 'GET' });

  if (res.status === 202) {
    const body = (await res.json().catch(() => ({} as PendingRequestResponse))) as PendingRequestResponse;
    const requestId = typeof body.requestId === 'string' ? body.requestId : null;
    if (!requestId) {
      throw new Error('Missing request id in async response');
    }
    return waitForRequestResult<T>(requestId);
  }

  if (!res.ok) {
    throw await parseHttpError(res);
  }

  return (await res.json()) as T;
};

export const drawPixel = async (x: number, y: number, color: string): Promise<void> => {
  const res = await authFetch(`${config.apiGateway}/web/draw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ x, y, color }),
  });

  if (!res.ok) {
    throw await parseHttpError(res);
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

export const getActiveArea = async (): Promise<ActiveArea> =>
  getOrWaitPayload<ActiveArea>(`${config.apiGateway}/web/active-area`);

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
  return getOrWaitPayload<CanvasWindowResponse>(
    `${config.apiGateway}/web/canvas?${params.toString()}`,
  );
};

export const getRealtimeToken = async (): Promise<string | null> => {
  const body = await getOrWaitPayload<{ token?: unknown }>(
    `${config.apiGateway}/web/realtime-token`,
  );
  return typeof body.token === 'string' ? body.token : null;
};
