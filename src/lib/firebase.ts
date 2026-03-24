import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

function readConfig() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const storageBucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    (projectId ? `${projectId}.firebasestorage.app` : undefined);

  if (!projectId || !apiKey || !authDomain || !storageBucket) return null;
  return { projectId, apiKey, authDomain, storageBucket };
}

function getFirebaseApp(): FirebaseApp | null {
  if (typeof window === 'undefined') return null;
  if (app) return app;
  const config = readConfig();
  if (!config) return null;
  const apps = getApps();
  app = apps.length ? apps[0] : initializeApp(config);
  return app;
}

export function getFirestoreDb(): Firestore | null {
  if (typeof window === 'undefined') return null;
  if (db) return db;
  const current = getFirebaseApp();
  if (!current) return null;
  db = getFirestore(current);
  return db;
}

export function getStorageService(): FirebaseStorage | null {
  if (typeof window === 'undefined') return null;
  if (storage) return storage;
  const current = getFirebaseApp();
  if (!current) return null;
  storage = getStorage(current);
  return storage;
}

