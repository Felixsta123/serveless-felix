import './style.css';
import { config } from './config';
import { getUser, setUser, clearSession, startLogin, pollSession, User } from './auth';
import { drawPixel, logoutSession, Pixel } from './api';
import {
  initCanvas,
  unsubscribeAll,
  getState,
  setOffset,
  getPixelAt,
  getActiveArea,
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

    drawBtn.disabled = getState().selected === null;
  } else {
    loginBtn.style.display = 'block';
    userInfo.style.display = 'none';
    drawBtn.disabled = true;
  }
};

const updatePixelInfo = (x: number, y: number, pixel: Pixel | null): void => {
  coordsEl.textContent = `Position : (${x}, ${y})`;

  if (pixel) {
    authorEl.textContent = `Auteur : ${pixel.authorId}`;
    updatedEl.textContent = pixel.updatedAt
      ? `Mis à jour : ${new Date(pixel.updatedAt).toLocaleString('fr-FR')}`
      : 'Mis à jour : Inconnue';
    colorPicker.value = pixel.color;
  } else {
    authorEl.textContent = 'Auteur : (vide)';
    updatedEl.textContent = '';
  }

  if (currentUser) {
    drawBtn.disabled = false;
  }
};

const setStatus = (msg: string, type: 'info' | 'error' | 'success' = 'info'): void => {
  statusEl.textContent = msg;
  statusEl.className = type === 'info' ? '' : type;
};

const updateViewportInfo = (): void => {
  const { offsetX, offsetY } = getState();
  viewportEl.textContent = `Origine : (${offsetX}, ${offsetY})`;
};

const handleDraw = async (): Promise<void> => {
  const selected = getState().selected;
  if (!selected || !currentUser) return;

  const color = colorPicker.value;
  drawBtn.disabled = true;
  setStatus('Dessin en cours...');

  try {
    await drawPixel(selected.x, selected.y, color);
    setStatus('Pixel dessiné', 'success');
  } catch (err) {
    setStatus(`Erreur : ${err instanceof Error ? err.message : 'Inconnue'}`, 'error');
  } finally {
    if (currentUser) {
      drawBtn.disabled = false;
    }
  }
};

const handleOAuthCallback = async (): Promise<boolean> => {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('oauth_state');
  if (!state) return false;

  setStatus('Connexion en cours...');

  const result = await pollSession(state);
  if (result) {
    try {
      setUser(result.user);
      updateAuthUI(result.user);
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    } catch (error) {
      console.error('Failed to complete session setup', error);
      clearSession();
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
  if (window.location.search.includes('oauth_state')) {
    await handleOAuthCallback();
  }

  const user = getUser();
  if (user) {
    updateAuthUI(user);
  } else {
    clearSession();
    updateAuthUI(null);
  }

  initCanvas(canvasEl);

  if (!currentUser) {
    setOffset(0, 0, false);
    setStatus('Connexion requise');
  } else {
    try {
      const area = await getActiveArea();
      const offsetX = getInitialOffset(area.minX, area.maxX);
      const offsetY = getInitialOffset(area.minY, area.maxY);
      setOffset(offsetX, offsetY);
      setStatus('Connecté', 'success');
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('HTTP 401') || error.message.includes('HTTP 403'))
      ) {
        clearSession();
        updateAuthUI(null);
        setOffset(0, 0, false);
        setStatus('Connexion requise');
      } else {
        setOffset(0, 0);
        setStatus('Connecté (nouveau canvas)', 'success');
      }
    }
  }

  loginBtn.addEventListener('click', startLogin);

  logoutBtn.addEventListener('click', async () => {
    try {
      await logoutSession();
    } catch (error) {
      console.error('Logout failed', error);
    }
    clearSession();
    updateAuthUI(null);
    unsubscribeAll();
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

  window.addEventListener('canvasError', ((e: CustomEvent) => {
    setStatus(`Erreur canvas : ${e.detail.error}`, 'error');
  }) as EventListener);
};

init().catch((err) => {
  console.error('Init failed:', err);
  setStatus("Échec d'initialisation", 'error');
});
