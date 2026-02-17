import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInWithCustomToken,
  signOut,
  type Auth,
} from 'firebase/auth';
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
  type Firestore,
} from 'firebase/firestore';
import { config } from './config';

let auth: Auth | null = null;
let db: Firestore | null = null;
let persistenceReady: Promise<void> | null = null;
let customToken: string | null = null;

const ensureClients = (): { auth: Auth; db: Firestore } => {
  const app =
    getApps().length > 0
      ? getApp()
      : initializeApp({
          apiKey: config.firebase.apiKey,
          authDomain: config.firebase.authDomain,
          projectId: config.firebase.projectId,
          appId: config.firebase.appId,
          storageBucket: config.firebase.storageBucket,
          messagingSenderId: config.firebase.messagingSenderId,
        });

  if (!auth) {
    auth = getAuth(app);
  }
  if (!db) {
    db = getFirestore(app);
  }
  if (!persistenceReady) {
    persistenceReady = setPersistence(auth, browserLocalPersistence).catch(() => undefined);
  }
  return { auth, db };
};

export const setRealtimeCustomToken = (token: string | null): void => {
  customToken = token;
};

export const hasPersistedRealtimeAuth = async (): Promise<boolean> => {
  const { auth } = ensureClients();
  await persistenceReady;
  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady();
  }
  return Boolean(auth.currentUser);
};

export const ensureRealtimeAuth = async (): Promise<boolean> => {
  const { auth } = ensureClients();
  await persistenceReady;
  if (typeof auth.authStateReady === 'function') {
    await auth.authStateReady();
  }

  if (auth.currentUser) {
    return true;
  }

  if (customToken) {
    await signInWithCustomToken(auth, customToken);
    return true;
  }

  return false;
};

export const signOutRealtime = async (): Promise<void> => {
  const { auth } = ensureClients();
  customToken = null;
  if (auth.currentUser) {
    await signOut(auth);
  }
};

export const watchActiveArea = (
  onData: (data: DocumentData | null) => void,
  onError: (error: unknown) => void,
): Unsubscribe => {
  const { db } = ensureClients();
  return onSnapshot(
    doc(db, 'activeArea/current'),
    (snapshot) => {
      onData(snapshot.exists() ? snapshot.data() : null);
    },
    onError,
  );
};

export const watchChunkPixels = (
  chunkId: string,
  roundId: string | null,
  onData: (snapshot: QuerySnapshot<DocumentData>) => void,
  onError: (error: unknown) => void,
): Unsubscribe => {
  const { db } = ensureClients();
  const colRef = collection(db, `chunks/${chunkId}/pixels`);
  const target = roundId ? query(colRef, where('roundId', '==', roundId)) : colRef;
  return onSnapshot(target, onData, onError);
};
