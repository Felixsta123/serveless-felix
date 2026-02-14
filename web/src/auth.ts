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
};

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
  window.location.href = `${config.apiGateway}/oauth?action=login`;
};

export const pollSession = async (state: string): Promise<SessionReady | null> => {
  const maxAttempts = 30;
  const interval = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${config.apiGateway}/web/session?state=${state}`, {
        credentials: 'include',
      });
      const data = await res.json();

      if (data.status === 'ready') {
        return {
          user: data.user,
        };
      }
      if (data.status === 'error') {
        console.error('OAuth error:', data.error);
        return null;
      }
      await new Promise((r) => setTimeout(r, interval));
    } catch (err) {
      console.error('Poll error:', err);
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  return null;
};
