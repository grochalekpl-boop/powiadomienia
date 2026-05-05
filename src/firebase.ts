/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const messaging = typeof window !== 'undefined' ? getMessaging(app) : null;
export const googleProvider = new GoogleAuthProvider();

// Funkcja do rejestracji tokena FCM
export async function registerFCMToken(user: User) {
  if (!messaging || typeof window === 'undefined') return;

  try {
    // Rejestrujemy Service Worker jawnie
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
      scope: '/'
    });
    
    // Pobieramy token powiązany z Service Workerem
    const token = await getToken(messaging, {
      serviceWorkerRegistration: registration,
      vapidKey: 'BAGM04s9laNJDgnIgk2jJetfsmI0NGcLx5j4lOn-b48xTzdmLNjB8oyePaXCODsoJPShvhrZ3_sBYDsAWswh-6M'
    });
    
    if (token) {
      await setDoc(doc(db, 'tokens', user.uid), {
        token,
        updatedAt: new Date(),
        email: user.email
      });
      console.log('Token FCM zarejestrowany pomyślnie.');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('permission-blocked')) {
      console.warn('Powiadomienia są zablokowane w przeglądarce użytkownika.');
    } else {
      console.error('Błąd rejestracji tokena FCM:', error);
    }
  }
}

// Test połączenia
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Proszę sprawdź konfigurację Firebase.");
    }
  }
}
testConnection();

export { signInWithPopup, onAuthStateChanged };
export type { User };
