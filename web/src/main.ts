import './style.css';
import { config } from './config';
import { getUser, setUser, clearSession, startLogin, pollSession, User } from './auth';
import { drawPixel, getRealtimeToken, logoutSession, Pixel } from './api';
import { hasPersistedRealtimeAuth } from './realtime';
import {
  initCanvas,
  unsubscribeAll,
  getState,
  setOffset,
  getPixelAt,
  getActiveArea,
  upsertPixel,
  setRealtimeToken,
  signOutRealtimeClient,
} from './canvas';

const loginBtn = document.getElementById('login-btn') as HTMLButtonElement;
const logoutBtn = document.getElementById('logout-btn') as HTMLButtonElement;
const userInfo = document.getElementById('user-info') as HTMLDivElement;
const userAvatar = document.getElementById('user-avatar') as HTMLImageElement;
const userName = document.getElementById('user-name') as HTMLSpanElement;
const coordsEl = document.getElementById('coords') as HTMLParagraphElement;
const authorEl = document.getElementById('author') as HTMLParagraphElement;
const updatedEl = document.getElementById('updated') as HTMLParagraphElement;
const colorPicker = document.getElementById('color-picker') as HTMLInputElement;
const drawBtn = document.getElementById('draw-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const viewportEl = document.getElementById('viewport') as HTMLParagraphElement;
const canvasEl = document.getElementById('canvas') as HTMLCanvasElement;

let currentUser: User | null = null;
let oauthRealtimeToken: string | null = null;
let canvasSyncMode: 'unknown' | 'connecting' | 'realtime' | 'fallback' | 'disabled' = 'unknown';

const isConnectionReady = (): boolean => canvasSyncMode === 'realtime' || canvasSyncMode === 'fallback';

const updateDrawAvailability = (): void => {
  drawBtn.disabled = !(currentUser && isConnectionReady());
};

const getInitialOffset = (min: number, max: number): number => {
  const viewPixels = Math.max(1, Math.floor(config.canvasSize / config.pixelSize));
  return Math.round((min + max - (viewPixels - 1)) / 2);
};

const updateAuthUI = (user: User | null): void => {
  currentUser = user;

  if (user) {
    loginBtn.style.display = 'none';
    userInfo.style.display = 'flex';
    userName.textContent = user.username;

    if (user.avatar) {
      userAvatar.src = `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`;
      userAvatar.style.display = 'block';
    } else {
      userAvatar.style.display = 'none';
    }

  } else {
    loginBtn.style.display = 'block';
    userInfo.style.display = 'none';
  }
  updateDrawAvailability();
};

const updatePixelInfo = (x: number, y: number, pixel: Pixel | null): void => {
  coordsEl.textContent = `Position : (${x}, ${y})`;

  if (pixel) {
    const authorLabel =
      typeof pixel.authorUsername === 'string' && pixel.authorUsername.trim() !== ''
        ? pixel.authorUsername
        : pixel.authorId;
    authorEl.textContent = `Auteur : ${authorLabel}`;
    updatedEl.textContent = pixel.updatedAt
      ? `Mis à jour : ${new Date(pixel.updatedAt).toLocaleString('fr-FR')}`
      : 'Mis à jour : Inconnue';
    colorPicker.value = pixel.color;
  } else {
    authorEl.textContent = 'Auteur : (vide)';
    updatedEl.textContent = '';
  }

  updateDrawAvailability();
};

const setStatus = (msg: string, type: 'info' | 'error' | 'success' = 'info'): void => {
  statusEl.textContent = msg;
  statusEl.className = type === 'info' ? '' : type;
};

const setConnectivityStatus = (): void => {
  if (!currentUser) {
    setStatus('Connexion requise');
    updateDrawAvailability();
    return;
  }

  if (canvasSyncMode === 'realtime') {
    setStatus('Connecté', 'success');
    updateDrawAvailability();
    return;
  }

  if (canvasSyncMode === 'fallback') {
    setStatus('Connecté (dégradé)');
    updateDrawAvailability();
    return;
  }

  setStatus('Connexion en cours...');
  updateDrawAvailability();
};

const updateViewportInfo = (): void => {
  const { offsetX, offsetY } = getState();
  viewportEl.textContent = `Origine : (${offsetX}, ${offsetY})`;
};

const handleDraw = async (): Promise<void> => {
  if (!currentUser) {
    setStatus('Connexion requise');
    updateDrawAvailability();
    return;
  }

  if (!isConnectionReady()) {
    setStatus('Connexion en cours...');
    updateDrawAvailability();
    return;
  }

  const selected = getState().selected;
  if (!selected) {
    setStatus('Sélectionnez un pixel sur le canvas.');
    return;
  }

  const color = colorPicker.value;
  drawBtn.disabled = true;
  setStatus('Dessin en cours...');

  try {
    upsertPixel({
      x: selected.x,
      y: selected.y,
      color,
      authorId: currentUser.id,
      authorUsername: currentUser.username,
      updatedAt: new Date().toISOString(),
    });
    await drawPixel(selected.x, selected.y, color);
    setStatus('Pixel dessiné', 'success');
    window.setTimeout(() => {
      setConnectivityStatus();
    }, 1200);
  } catch (err) {
    setStatus(`Erreur : ${err instanceof Error ? err.message : 'Inconnue'}`, 'error');
  } finally {
    updateDrawAvailability();
  }
};

const fetchRealtimeTokenInBackground = (): void => {
  void getRealtimeToken()
    .then((token) => {
      if (!getUser()) {
        return;
      }
      setRealtimeToken(token);
    })
    .catch((error) => {
      if (!getUser() || isConnectionReady()) {
        return;
      }
      console.warn('Failed to fetch realtime token', error);
    });
};

const handleOAuthCallback = async (): Promise<boolean> => {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('oauth_state');
  if (!state) return false;

  setStatus('Connexion en cours...');

  const result = await pollSession(state);
  if (result) {
    try {
      oauthRealtimeToken = result.firebaseCustomToken;
      setRealtimeToken(oauthRealtimeToken);
      setUser(result.user);
      updateAuthUI(result.user);
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    } catch (error) {
      console.error('Failed to complete session setup', error);
      clearSession();
      oauthRealtimeToken = null;
      setRealtimeToken(null);
      setStatus('Échec de connexion', 'error');
      window.history.replaceState({}, '', window.location.pathname);
      return false;
    }
  }

  setStatus('Échec de connexion', 'error');
  window.history.replaceState({}, '', window.location.pathname);
  return false;
};

const init = async (): Promise<void> => {
  oauthRealtimeToken = null;

  if (window.location.search.includes('oauth_state')) {
    await handleOAuthCallback();
  }

  const user = getUser();
  if (user) {
    setStatus('Connexion en cours...');
    updateAuthUI(user);
    if (oauthRealtimeToken) {
      setRealtimeToken(oauthRealtimeToken);
    } else {
      setRealtimeToken(null);
      void hasPersistedRealtimeAuth()
        .then((persistedAuth) => {
          if (!getUser() || persistedAuth) {
            return;
          }
          fetchRealtimeTokenInBackground();
        })
        .catch(() => {
          if (!getUser()) {
            return;
          }
          fetchRealtimeTokenInBackground();
        });
    }
  } else {
    clearSession();
    oauthRealtimeToken = null;
    setRealtimeToken(null);
    updateAuthUI(null);
  }

  initCanvas(canvasEl);

  window.addEventListener('canvasError', ((e: CustomEvent) => {
    const message = typeof e.detail?.error === 'string' ? e.detail.error : 'Erreur inconnue';
    if (canvasSyncMode === 'realtime' && message.includes('Timed out while waiting for request result')) {
      return;
    }
    setStatus(`Erreur canvas : ${message}`, 'error');
  }) as EventListener);

  window.addEventListener('canvasModeChanged', ((e: CustomEvent) => {
    const mode = e.detail?.mode;
    if (mode === 'connecting' || mode === 'realtime' || mode === 'fallback' || mode === 'disabled') {
      canvasSyncMode = mode;
    } else {
      canvasSyncMode = 'unknown';
    }
    setConnectivityStatus();
  }) as EventListener);

  if (!currentUser) {
    setOffset(0, 0, false);
    setConnectivityStatus();
  } else {
    const initialUserId = currentUser.id;
    setOffset(0, 0);
    void getActiveArea()
      .then((area) => {
        const sessionUser = getUser();
        if (!sessionUser || sessionUser.id !== initialUserId) {
          return;
        }
        const offsetX = getInitialOffset(area.minX, area.maxX);
        const offsetY = getInitialOffset(area.minY, area.maxY);
        setOffset(offsetX, offsetY);
      })
      .catch((error) => {
        const sessionUser = getUser();
        if (!sessionUser || sessionUser.id !== initialUserId) {
          return;
        }
        if (
          error instanceof Error &&
          (error.message.includes('HTTP 401') || error.message.includes('HTTP 403'))
        ) {
          clearSession();
          updateAuthUI(null);
          setOffset(0, 0, false);
          setConnectivityStatus();
        }
      });
    setConnectivityStatus();
  }

  loginBtn.addEventListener('click', startLogin);

  logoutBtn.addEventListener('click', async () => {
    try {
      await logoutSession();
    } catch (error) {
      console.error('Logout failed', error);
    }
    try {
      await signOutRealtimeClient();
    } catch (error) {
      console.error('Realtime logout failed', error);
    }
    setRealtimeToken(null);
    clearSession();
    updateAuthUI(null);
    unsubscribeAll();
    canvasSyncMode = 'unknown';
    setStatus('Déconnecté');
  });

  drawBtn.addEventListener('click', handleDraw);

  window.addEventListener('pixelSelected', ((e: CustomEvent) => {
    const { x, y, pixel } = e.detail;
    updatePixelInfo(x, y, pixel);
  }) as EventListener);

  window.addEventListener('canvasUpdated', () => {
    const selected = getState().selected;
    if (selected) {
      const pixel = getPixelAt(selected.x, selected.y);
      updatePixelInfo(selected.x, selected.y, pixel);
    }
  });

  window.addEventListener('viewportChanged', () => {
    updateViewportInfo();
  });

  updateViewportInfo();
};

init().catch((err) => {
  console.error('Init failed:', err);
  setStatus("Échec d'initialisation", 'error');
});
