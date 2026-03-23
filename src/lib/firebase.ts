import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

function readConfig() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;

  if (!projectId || !apiKey || !authDomain) return null;
  return { projectId, apiKey, authDomain };
}

export function getFirestoreDb(): Firestore | null {
  if (typeof window === 'undefined') return null;
  if (db) return db;

  const config = readConfig();
  if (!config) return null;

  const apps = getApps();
  app = apps.length ? apps[0] : initializeApp(config);
  db = getFirestore(app);
  return db;
}

