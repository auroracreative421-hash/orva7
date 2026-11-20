import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const OperationType = Object.freeze({
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
});

export function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId || null,
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

function clampString(val, maxLen) {
  return String(val || '').trim().slice(0, maxLen);
}

function clampWishlist(list) {
  if (!Array.isArray(list)) return [];
  const unique = [];
  for (const item of list) {
    const clean = String(item || '').trim().slice(0, 64);
    if (clean && !unique.includes(clean)) {
      unique.push(clean);
      if (unique.length >= 50) break;
    }
  }
  return unique;
}

export async function signInWithGooglePopup() {
  const credential = await signInWithPopup(auth, googleProvider);
  const idToken = await credential.user.getIdToken();
  return { user: credential.user, idToken };
}

export async function signOutFirebase() {
  try {
    await signOut(auth);
  } catch {
    // ignore if already signed out
  }
}

export function subscribeFirebaseAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function readSyncedCloudProfile(uid) {
  if (!uid) return null;
  const docPath = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists() ? snap.data() : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, docPath);
    return null;
  }
}

export async function upsertSyncedCloudProfile({
  user,
  name,
  phone = '',
  address = '',
  wishlistIds = [],
  authProvider = 'google',
}) {
  if (!user?.uid || !user?.email) return null;
  const docPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);

  const safeName = clampString(name || user.displayName || user.email.split('@')[0] || 'عميل ORVA 7', 120);
  const safeEmail = clampString(user.email, 200);
  const safePhoto = clampString(user.photoURL || '', 500);
  const safePhone = clampString(phone, 40);
  const safeAddress = clampString(address, 300);
  const safeWishlist = clampWishlist(wishlistIds);
  const safeProvider = authProvider === 'password' ? 'password' : 'google';

  try {
    const existingSnap = await getDoc(userRef);
    if (!existingSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        name: safeName,
        email: safeEmail,
        photoUrl: safePhoto,
        phone: safePhone,
        address: safeAddress,
        authProvider: safeProvider,
        wishlistIds: safeWishlist,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        name: safeName,
        photoUrl: safePhoto,
        phone: safePhone,
        address: safeAddress,
        authProvider: safeProvider,
        wishlistIds: safeWishlist,
        updatedAt: serverTimestamp(),
      });
    }
    return {
      uid: user.uid,
      name: safeName,
      email: safeEmail,
      photoUrl: safePhoto,
      phone: safePhone,
      address: safeAddress,
      wishlistIds: safeWishlist,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, docPath);
    return null;
  }
}

export async function syncWishlistToFirestore(uid, wishlistIds) {
  if (!uid || auth.currentUser?.uid !== uid) return;
  const docPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      wishlistIds: clampWishlist(wishlistIds),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}
