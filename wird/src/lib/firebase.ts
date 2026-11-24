import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { UserPreferencesState } from './storage';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

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
        auth.currentUser?.providerData?.map((provider) => ({
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

export async function testConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore client is currently offline — using local persistence.');
    }
    return false;
  }
}

export function subscribeToAuth(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function signInWithGoogle(): Promise<User | null> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const user = result.user;

  if (user) {
    const userPath = `users/${user.uid}`;
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          uid: user.uid,
          displayName: (user.displayName || 'مستخدم وِرد').slice(0, 80),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, userPath);
    }

    if (user.email) {
      const privatePath = `users/${user.uid}/private/info`;
      try {
        await setDoc(
          doc(db, 'users', user.uid, 'private', 'info'),
          {
            uid: user.uid,
            email: user.email.slice(0, 254),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, privatePath);
      }
    }
  }

  return user;
}

export async function signOutGoogle(): Promise<void> {
  await signOut(auth);
}

export async function syncFavoriteToCloud(userId: string, dhikrId: string, isFav: boolean): Promise<void> {
  const favId = `${userId}_${dhikrId}`.slice(0, 128);
  const path = `favorites/${favId}`;
  try {
    if (isFav) {
      await setDoc(doc(db, 'favorites', favId), {
        userId,
        dhikrId,
        createdAt: serverTimestamp(),
      });
    } else {
      await deleteDoc(doc(db, 'favorites', favId));
    }
  } catch (err) {
    handleFirestoreError(err, isFav ? OperationType.CREATE : OperationType.DELETE, path);
  }
}

export async function fetchCloudFavorites(userId: string): Promise<string[]> {
  const path = 'favorites';
  try {
    const q = query(collection(db, 'favorites'), where('userId', '==', userId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => String(d.data().dhikrId));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function syncSessionToCloud(
  userId: string,
  session: {
    period: 'morning' | 'evening';
    dateKey: string;
    currentIndex: number;
    counts: Record<string, number>;
    completedIds: string[];
    skippedIds: string[];
    isCompleted: boolean;
  }
): Promise<void> {
  const sessionId = `${userId}_${session.period}_${session.dateKey}`.slice(0, 128);
  const path = `readingSessions/${sessionId}`;
  try {
    await setDoc(
      doc(db, 'readingSessions', sessionId),
      {
        userId,
        period: session.period,
        dateKey: session.dateKey,
        currentIndex: session.currentIndex,
        counts: session.counts,
        completedIds: session.completedIds.slice(0, 60),
        skippedIds: session.skippedIds.slice(0, 60),
        isCompleted: session.isCompleted,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function sanitizePrefsForFirestore(prefs: UserPreferencesState) {
  const safeTime = (t: string, fallback: string) => (TIME_PATTERN.test(t) ? t : fallback);
  const tz = (prefs.timezone || 'Asia/Riyadh').trim().slice(0, 64);
  return {
    theme: prefs.theme === 'dark' || prefs.theme === 'system' ? prefs.theme : 'light',
    fontSize:
      prefs.fontSize === 'sm' || prefs.fontSize === 'md' || prefs.fontSize === 'xl'
        ? prefs.fontSize
        : 'lg',
    hapticsEnabled: Boolean(prefs.hapticsEnabled),
    reducedMotion: Boolean(prefs.reducedMotion),
    quietModeDefault: Boolean(prefs.quietModeDefault),
    morningEnabled: Boolean(prefs.morningEnabled),
    eveningEnabled: Boolean(prefs.eveningEnabled),
    morningTime: safeTime(prefs.morningTime, '06:00'),
    eveningTime: safeTime(prefs.eveningTime, '17:30'),
    timezone: tz.length >= 2 ? tz : 'UTC',
    quietHoursEnabled: Boolean(prefs.quietHoursEnabled),
    quietHoursStart: safeTime(prefs.quietHoursStart, '23:00'),
    quietHoursEnd: safeTime(prefs.quietHoursEnd, '04:30'),
  };
}

export async function fetchCloudPreferences(
  userId: string
): Promise<Partial<UserPreferencesState> | null> {
  const path = `userPreferences/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'userPreferences', userId));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      theme: d.theme,
      fontSize: d.fontSize,
      hapticsEnabled: d.hapticsEnabled,
      reducedMotion: d.reducedMotion,
      quietModeDefault: d.quietModeDefault,
      morningEnabled: d.morningEnabled,
      eveningEnabled: d.eveningEnabled,
      morningTime: d.morningTime,
      eveningTime: d.eveningTime,
      timezone: d.timezone,
      quietHoursEnabled: d.quietHoursEnabled,
      quietHoursStart: d.quietHoursStart,
      quietHoursEnd: d.quietHoursEnd,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

export async function syncPreferencesToCloud(
  userId: string,
  prefs: UserPreferencesState
): Promise<void> {
  const path = `userPreferences/${userId}`;
  const ref = doc(db, 'userPreferences', userId);
  const payload = sanitizePrefsForFirestore(prefs);
  try {
    const existing = await getDoc(ref);
    if (existing.exists()) {
      await updateDoc(ref, {
        ...payload,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        userId,
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}
