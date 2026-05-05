import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Funkcja pomocnicza do bezpiecznego wczytywania konfiguracji
function getFirebaseConfig() {
  try {
    const configPath = path.join(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Błąd wczytywania firebase-applet-config.json:', e);
  }
  return null;
}

let messaging: any = null;
let db: any = null;

async function initFirebaseAdmin() {
  if (admin.apps.length > 0) return;

  const config = getFirebaseConfig();
  if (!config) return;

  try {
    const app = admin.initializeApp({
      projectId: config.projectId,
    });
    db = getFirestore(app, config.firestoreDatabaseId);
    messaging = getMessaging(app);
    console.log('Firebase Admin zainicjalizowany pomyślnie.');
  } catch (error) {
    console.warn('Nie udało się zainicjalizować Firebase Admin (prawdopodobnie brak uprawnień):', error);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API do rozsyłania powiadomień przez FCM (True Push)
  app.post('/api/broadcast', async (req, res) => {
    const { message, senderEmail, senderId } = req.body;

    if (!message || !senderEmail || !senderId) {
      return res.status(400).json({ error: 'Brakujące dane' });
    }

    try {
      await initFirebaseAdmin();
      
      if (!messaging || !db) {
        return res.status(503).json({ error: 'Usługa PUSH niedostępna na tym serwerze (brak admin SDK)' });
      }

      // Pobieramy wszystkie aktywne tokeny
      const tokensSnapshot = await db.collection('tokens').get();
      const tokens = tokensSnapshot.docs
        .map(doc => doc.data().token)
        .filter(token => token && typeof token === 'string');

      if (tokens.length === 0) {
        return res.json({ success: true, message: 'Brak zarejestrowanych urządzeń' });
      }

      const payload = {
        notification: {
          title: 'Nowe powiadomienie!',
          body: `${senderEmail}: ${message}`,
        },
        data: {
          senderId,
          url: '/'
        },
        tokens: tokens.slice(0, 500), // Limit FCM multicast
      };

      const response = await messaging.sendEachForMulticast(payload);
      
      res.json({ 
        success: true, 
        sentCount: response.successCount, 
        failureCount: response.failureCount 
      });
    } catch (error) {
      console.error('Błąd FCM API:', error);
      res.status(500).json({ error: 'Błąd serwera podczas wysyłki PUSH' });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== 'production') {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.error('Błąd inicjalizacji Vite middleware:', e);
    }
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serwer działa na http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Krytyczny błąd startu serwera:', err);
});
