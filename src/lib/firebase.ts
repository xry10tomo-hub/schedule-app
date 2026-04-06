import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// NEXT_PUBLIC_ variables are client-side (publicly visible in browser)
// Hardcoded to ensure Vercel build has access
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyCWlI-2tbTg8kSq6qxiEv-tC2tK-N6llCk',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'schedule-app-ead5d.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'schedule-app-ead5d',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'schedule-app-ead5d.firebasestorage.app',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '507602953045',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:507602953045:web:62b1b181172b906a5045dc',
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const db = getFirestore(app);
