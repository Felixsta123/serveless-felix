import { config } from './config';

const STORAGE_KEYS = {
  token: 'pixel_canvas_token',
  user: 'pixel_canvas_user',
};

export type User = {
  id: string;
  username: string;
  avatar: string | null;
};

export type SessionReady = {
  apiToken: string;
  user: User;
};

// Get stored session token
export const getToken = (): string | null => {
  return localStorage.getItem(STORAGE_KEYS.token);
};

// Store session token
export const setToken = (token: string): void => {
  localStorage.setItem(STORAGE_KEYS.token, token);
};

// Get stored user data
export const getUser = (): User | null => {
  const data = localStorage.getItem(STORAGE_KEYS.user);
  if (!data) return null;
  try {
    return JSON.parse(data) as User;
  } catch {
    return null;
  }
};

// Store user data
export const setUser = (user: User): void => {
  localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
};

// Clear session
export const clearSession = (): void => {
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.user);
};

// Start Discord OAuth flow
export const startLogin = (): void => {
  window.location.href = `${config.apiGateway}/oauth?action=login`;
};

// Poll for session after OAuth callback
export const pollSession = async (state: string): Promise<SessionReady | null> => {
  const maxAttempts = 30;
  const interval = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${config.apiGateway}/web/session?state=${state}`);
      const data = await res.json();

      if (data.status === 'ready') {
        return {
          apiToken: data.apiToken,
          user: data.user,
        };
      }
      if (data.status === 'error') {
        console.error('OAuth error:', data.error);
        return null;
      }
      // Still pending, wait
      await new Promise((r) => setTimeout(r, interval));
    } catch (err) {
      console.error('Poll error:', err);
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  return null;
};
