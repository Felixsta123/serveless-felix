import './style.css';
import {
  getToken,
  getUser,
  setToken,
  setUser,
  clearSession,
  startLogin,
  pollSession,
  signInFirebase,
  signOutFirebase,
  isFirebaseAuthenticated,
  waitForFirebaseAuth,
  User,
} from './auth';
import { drawPixel, Pixel } from './api';
import {
  initCanvas,
  unsubscribeAll,
  getState,
  setOffset,
  getPixelAt,
  getActiveArea,
} from './canvas';

// DOM elements
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
const canvasEl = document.getElementById('canvas') as HTMLCanvasElement;

let currentUser: User | null = null;

// Update UI based on auth state
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

    // Enable draw if pixel selected
    drawBtn.disabled = getState().selected === null;
  } else {
    loginBtn.style.display = 'block';
    userInfo.style.display = 'none';
    drawBtn.disabled = true;
  }
};

// Update pixel info display
const updatePixelInfo = (x: number, y: number, pixel: Pixel | null): void => {
  coordsEl.textContent = `Position: (${x}, ${y})`;

  if (pixel) {
    authorEl.textContent = `Author: ${pixel.authorId}`;
    updatedEl.textContent = pixel.updatedAt
      ? `Updated: ${new Date(pixel.updatedAt).toLocaleString()}`
      : 'Updated: Unknown';
    colorPicker.value = pixel.color;
  } else {
    authorEl.textContent = 'Author: (empty)';
    updatedEl.textContent = '';
  }

  if (currentUser) {
    drawBtn.disabled = false;
  }
};

// Set status message
const setStatus = (msg: string, type: 'info' | 'error' | 'success' = 'info'): void => {
  statusEl.textContent = msg;
  statusEl.className = type === 'info' ? '' : type;
};

// Handle draw button click
const handleDraw = async (): Promise<void> => {
  const selected = getState().selected;
  if (!selected || !currentUser) return;

  const color = colorPicker.value;
  drawBtn.disabled = true;
  setStatus('Drawing...');

  try {
    await drawPixel(selected.x, selected.y, color);
    setStatus('Pixel drawn!', 'success');
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : 'Unknown'}`, 'error');
  } finally {
    if (currentUser) {
      drawBtn.disabled = false;
    }
  }
};

// Handle OAuth callback
const handleOAuthCallback = async (): Promise<boolean> => {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('oauth_state');
  if (!state) return false;

  setStatus('Completing login...');

  const result = await pollSession(state);
  if (result) {
    try {
      await signInFirebase(result.firebaseToken);
      setToken(result.apiToken);
      setUser(result.user);
      updateAuthUI(result.user);
      // Clear URL params
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    } catch (error) {
      console.error('Failed to sign in with Firebase custom token', error);
      clearSession();
      setStatus('Login failed', 'error');
      window.history.replaceState({}, '', window.location.pathname);
      return false;
    }
  }

  setStatus('Login failed', 'error');
  window.history.replaceState({}, '', window.location.pathname);
  return false;
};

// Initialize app
const init = async (): Promise<void> => {
  await waitForFirebaseAuth();

  // Check OAuth callback
  if (window.location.search.includes('oauth_state')) {
    await handleOAuthCallback();
  }

  // Restore session
  const token = getToken();
  const user = getUser();
  if (token && user && isFirebaseAuthenticated()) {
    updateAuthUI(user);
  } else {
    clearSession();
    updateAuthUI(null);
  }

  // Initialize canvas
  initCanvas(canvasEl);

  if (!currentUser) {
    setOffset(0, 0, false);
    setStatus('Login required to access the canvas');
  } else {
    // Get active area and center view
    try {
      const area = await getActiveArea();
      const centerX = Math.floor((area.minX + area.maxX) / 2) - 25;
      const centerY = Math.floor((area.minY + area.maxY) / 2) - 25;
      setOffset(Math.max(0, centerX), Math.max(0, centerY));
      setStatus('Connected', 'success');
    } catch {
      setOffset(0, 0);
      setStatus('Connected (new canvas)', 'success');
    }
  }

  // Event listeners
  loginBtn.addEventListener('click', startLogin);

  logoutBtn.addEventListener('click', async () => {
    await signOutFirebase();
    clearSession();
    updateAuthUI(null);
    unsubscribeAll();
    setStatus('Logged out');
  });

  drawBtn.addEventListener('click', handleDraw);

  // Canvas events
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

  window.addEventListener('canvasError', ((e: CustomEvent) => {
    setStatus(`Canvas error: ${e.detail.error}`, 'error');
  }) as EventListener);
};

// Start
init().catch((err) => {
  console.error('Init failed:', err);
  setStatus('Failed to initialize', 'error');
});
