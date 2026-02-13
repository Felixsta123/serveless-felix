import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { config } from './config';

const app = initializeApp(config.firebase);

export const auth = getAuth(app);
export const db = getFirestore(app);
