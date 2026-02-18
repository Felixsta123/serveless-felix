import { config } from './config';

const STORAGE_KEYS = {
  user: 'pixel_canvas_user',
};

export type User = {
  id: string;
  username: string;
  avatar: string | null;
};

export type SessionReady = {
  user: User;
  firebaseCustomToken: string | null;
};

type SessionPollResult = SessionReady | null;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const nextDelayMs = (previous: number): number => Math.min(15000, Math.round(previous * 1.8));

export const getUser = (): User | null => {
  const data = localStorage.getItem(STORAGE_KEYS.user);
  if (!data) return null;
  try {
    return JSON.parse(data) as User;
  } catch {
    return null;
  }
};

export const setUser = (user: User): void => {
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
};

export const clearSession = (): void => {
  localStorage.removeItem(STORAGE_KEYS.user);
};

export const startLogin = (): void => {
  window.location.href = config.gatewayUrl('/oauth', { action: 'login' });
};

export const pollSession = async (state: string): Promise<SessionPollResult> => {
  const maxAttempts = 20;
  let delayMs = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(config.gatewayUrl('/web/session', { state }), {
        credentials: 'include',
      });

      if (res.status === 429) {
        const retryAfterHeader = res.headers.get('retry-after');
        const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
        const retryDelayMs =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? Math.floor(retryAfterSeconds * 1000)
            : nextDelayMs(delayMs);
        console.warn(`Session polling throttled (429), retry in ${retryDelayMs}ms`);
        await sleep(retryDelayMs);
        delayMs = nextDelayMs(retryDelayMs);
        continue;
      }

      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const status = typeof data.status === 'string' ? data.status : null;

      if (status === 'ready' && data.user && typeof data.user === 'object') {
        return {
          user: data.user as User,
          firebaseCustomToken:
            typeof data.firebaseCustomToken === 'string' ? data.firebaseCustomToken : null,
        };
      }
      if (status === 'error') {
        console.error('OAuth error:', data.error);
        return null;
      }

      await sleep(delayMs);
      delayMs = nextDelayMs(delayMs);
    } catch (err) {
      console.error('Poll error:', err);
      await sleep(delayMs);
      delayMs = nextDelayMs(delayMs);
    }
  }
  return null;
};
