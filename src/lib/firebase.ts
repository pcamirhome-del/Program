import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { PlatformType, SavedSoftwareRecord, SearchHistoryRecord } from '../types.ts';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Validate connection to Firestore on boot as required
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validation & Sanitization Constants synced verbatim with firebase-blueprint.json & firestore.rules
export const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-]+$/;

export function sanitizeId(raw: string, maxLen = 120): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const fallback = cleaned || 'pkg-item';
  return fallback.slice(0, maxLen);
}

export function clampString(val: string | undefined | null, maxLen: number, fallback = ''): string {
  const str = (val ?? fallback).trim();
  return str.slice(0, maxLen);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

export async function signOutUser() {
  return firebaseSignOut(auth);
}

export function formatFirestoreTimestamp(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (typeof val === 'string') {
    return val;
  }
  return new Date().toISOString();
}

export async function saveSoftwareToFirestore(
  userId: string,
  record: Omit<SavedSoftwareRecord, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<void> {
  const safeUserId = sanitizeId(userId, 128);
  const safeAppKey = sanitizeId(record.appKey, 120);
  const docPath = `users/${safeUserId}/savedApps/${safeAppKey}`;

  const validPlatform: PlatformType =
    record.platform === 'pc' || record.platform === 'android' || record.platform === 'ios'
      ? record.platform
      : 'pc';

  const payload = {
    appKey: safeAppKey,
    ownerId: safeUserId,
    platform: validPlatform,
    name: clampString(record.name, 160, 'Software Package'),
    developer: clampString(record.developer, 160, 'Official Publisher'),
    iconUrl: clampString(record.iconUrl, 1024, ''),
    primaryUrl: clampString(record.primaryUrl, 1024, 'https://apps.apple.com'),
    secondaryUrl: clampString(record.secondaryUrl, 1024, ''),
    category: clampString(record.category, 80, 'Software'),
    license: clampString(record.license, 80, 'Standard'),
    version: clampString(record.version, 64, 'Latest'),
    notes: clampString(record.notes, 500, ''),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', safeUserId, 'savedApps', safeAppKey), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function updateSavedSoftwareNotesInFirestore(
  userId: string,
  appKey: string,
  notes: string
): Promise<void> {
  const safeUserId = sanitizeId(userId, 128);
  const safeAppKey = sanitizeId(appKey, 120);
  const docPath = `users/${safeUserId}/savedApps/${safeAppKey}`;

  try {
    await updateDoc(doc(db, 'users', safeUserId, 'savedApps', safeAppKey), {
      notes: clampString(notes, 500, ''),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function deleteSavedSoftwareFromFirestore(
  userId: string,
  appKey: string
): Promise<void> {
  const safeUserId = sanitizeId(userId, 128);
  const safeAppKey = sanitizeId(appKey, 120);
  const docPath = `users/${safeUserId}/savedApps/${safeAppKey}`;

  try {
    await deleteDoc(doc(db, 'users', safeUserId, 'savedApps', safeAppKey));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}

export async function logSearchToFirestore(
  userId: string,
  entry: Omit<SearchHistoryRecord, 'id' | 'ownerId' | 'createdAt'>
): Promise<void> {
  const safeUserId = sanitizeId(userId, 128);
  const historyId = sanitizeId(`${entry.platform}-${entry.query.toLowerCase()}-${Date.now()}`, 120);
  const docPath = `users/${safeUserId}/searchHistory/${historyId}`;

  const validPlatform: PlatformType =
    entry.platform === 'pc' || entry.platform === 'android' || entry.platform === 'ios'
      ? entry.platform
      : 'pc';

  const safeCount = Math.max(0, Math.min(500, Math.floor(entry.resultCount || 0)));

  const payload = {
    query: clampString(entry.query, 140, 'search'),
    platform: validPlatform,
    ownerId: safeUserId,
    resultCount: safeCount,
    topResultName: clampString(entry.topResultName, 160, ''),
    topResultIcon: clampString(entry.topResultIcon, 1024, ''),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', safeUserId, 'searchHistory', historyId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function deleteSearchHistoryFromFirestore(
  userId: string,
  historyId: string
): Promise<void> {
  const safeUserId = sanitizeId(userId, 128);
  const safeHistoryId = sanitizeId(historyId, 128);
  const docPath = `users/${safeUserId}/searchHistory/${safeHistoryId}`;

  try {
    await deleteDoc(doc(db, 'users', safeUserId, 'searchHistory', safeHistoryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}
