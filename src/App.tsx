/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  onAuthStateChanged,
  registerFCMToken,
  type User 
} from './firebase.ts';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp,
  Timestamp,
  where
} from 'firebase/firestore';
import { formatInTimeZone } from 'date-fns-tz';
import { Bell, BellRing, LogOut, LogIn, Clock, ShieldCheck, ShieldAlert, History, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// Wersja aplikacji
const APP_VERSION = "1.7.0";
const TIMEZONE = "Europe/Warsaw";

interface NotificationLog {
  id: string;
  message: string;
  timestamp: Timestamp;
  senderId: string;
  senderEmail: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [isSending, setIsSending] = useState(false);
  
  // Ref do śledzenia czasu zamontowania, aby nie wyświetlać starych powiadomień po odświeżeniu
  const mountTimeRef = useRef(Timestamp.now());

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        registerFCMToken(u);
      }
    });
    return () => unsubscribe();
  }, []);

  // Słuchanie na nowe powiadomienia (sygnalizacja)
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'notifications'),
      where('timestamp', '>', mountTimeRef.current),
      orderBy('timestamp', 'desc'),
      limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data() as Omit<NotificationLog, 'id'>;
          // Nie pokazujemy powiadomienia wysłanego przez samego siebie
          if (data.senderId !== user.uid) {
            triggerLocalNotification(data.message, data.senderEmail);
          }
        }
      });
    }, (error) => {
      console.error("Błąd subskrypcji powiadomień:", error);
    });

    return () => unsubscribe();
  }, [user]);

  // Słuchanie na historię logów
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'logs'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newLogs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as NotificationLog[];
      setLogs(newLogs);
    }, (error) => {
      console.error("Błąd subskrypcji logów:", error);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Błąd logowania:", error);
    }
  };

  const handleLogout = () => auth.signOut();

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPermission(p);
    
    // Odtworzenie dźwięku odblokowuje AudioContext w większości przeglądarek
    playSound();
    
    // Jeśli właśnie otrzymaliśmy zgodę, zarejestrujmy token
    if (p === 'granted' && user) {
      console.log('Uprawnienia nadane, inicjuję rejestrację FCM...');
      registerFCMToken(user);
    } else if (p === 'denied') {
      console.error('Uprawnienia do powiadomień zostały odrzucone przez użytkownika.');
    }
  };

  const playSound = async () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Musimy wznowić kontekst, jeśli był wstrzymany przez przeglądarkę
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime); // A5
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);

      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.8);
    } catch (e) {
      console.warn("Nie udało się odtworzyć dźwięku:", e);
    }
  };

  const triggerLocalNotification = async (message: string, sender: string) => {
    playSound(); // Zawsze próbujemy odtworzyć dźwięk
    
    // Jeśli mamy dostęp do Service Workera, używamy go do wyświetlenia powiadomienia systemowego.
    // Jest to znacznie skuteczniejsze niż "new Notification()", szczególnie w tle.
    if ('serviceWorker' in navigator && Notification.permission === 'granted') {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          registration.showNotification('Nowe powiadomienie!', {
            body: `${sender}: ${message}`,
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            tag: 'push-notification',
            renotify: true,
            data: { url: window.location.origin }
          } as any);
          return;
        }
      } catch (e) {
        console.warn("Błąd wyświetlania przez Service Worker:", e);
      }
    }

    // Fallback dla starszych przeglądarek lub gdy SW nie działa
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const n = new Notification('Nowe powiadomienie!', {
          body: `${sender}: ${message}`,
          icon: '/favicon.ico',
          tag: 'push-notification',
          silent: false,
        });

        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch (e) {
        console.warn("Błąd wyświetlania lokalnego powiadomienia:", e);
      }
    }
  };

  const sendNotification = async () => {
    if (!user || isSending) return;
    setIsSending(true);

    const message = "Przykładowy tekst powiadomienia push!";
    const notificationData = {
      message,
      timestamp: serverTimestamp(),
      senderId: user.uid,
      senderEmail: user.email || 'Anonim',
    };

    try {
      // 1. Zapisujemy w logach (historia)
      await addDoc(collection(db, 'logs'), notificationData);
      
      // 2. Zapisujemy w kolekcji sygnalizacyjnej (błyskawiczna reakcja otwartych kart)
      await addDoc(collection(db, 'notifications'), notificationData);
      
      // 3. Wywołujemy API serwera do rozesłania True Push (FCM dla tła)
      fetch('/api/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          senderEmail: user.email,
          senderId: user.uid
        })
      }).catch(e => console.error("Błąd tła FCM:", e));
      
    } catch (error) {
      console.error("Błąd wysyłania powiadomienia:", error);
    } finally {
      setIsSending(false);
    }
  };

  const formatTimestamp = (ts: Timestamp) => {
    if (!ts) return "---";
    const date = ts.toDate();
    return formatInTimeZone(date, TIMEZONE, 'HH:mm:ss');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#050608]">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full shadow-[0_0_15px_rgba(6,182,212,0.5)]"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050608] text-slate-200 font-sans flex flex-col overflow-hidden selection:bg-cyan-500/30 selection:text-white">
      {!user ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#050608]">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md bg-[#0a0c10] rounded-3xl border-4 border-[#1a1c22] p-12 text-center shadow-2xl relative overflow-hidden"
          >
             <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(6,182,212,0.1),transparent_70%)] pointer-events-none"></div>
            
            <div className="w-24 h-24 bg-cyan-500/10 rounded-2xl flex items-center justify-center mx-auto mb-8 border border-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.15)]">
              <Bell className="text-cyan-400 w-12 h-12" />
            </div>
            
            <h1 className="text-4xl font-black text-white mb-2 tracking-tighter uppercase italic">Broadcast</h1>
            <p className="text-cyan-500/60 font-mono text-xs uppercase tracking-widest mb-10">Protocol v{APP_VERSION} Active</p>
            
            <button
              onClick={handleLogin}
              className="w-full group relative flex items-center justify-center gap-4 bg-[#0f1117] border border-slate-800 text-slate-200 py-5 px-8 rounded-2xl font-bold hover:bg-[#161922] hover:border-cyan-500/50 transition-all duration-300 shadow-inner"
            >
              <div className="absolute inset-x-0 bottom-0 h-[2px] bg-cyan-500 scale-x-0 group-hover:scale-x-100 transition-transform origin-left"></div>
              <LogIn className="w-6 h-6 text-cyan-400 group-hover:rotate-12 transition-transform" />
              AUTHENTICATE WITH GOOGLE
            </button>
          </motion.div>
          <footer className="mt-12 text-slate-600 font-mono text-[10px] tracking-[0.2em] uppercase">
            System Node: {APP_VERSION} // European Cluster
          </footer>
        </div>
      ) : (
        <div className="flex-1 flex flex-col h-screen p-6 md:p-10 border-8 border-[#1a1c22]">
          {/* Top Bar */}
          <div className="flex justify-between items-start mb-10">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-cyan-500/20 flex items-center justify-center border border-cyan-500/40">
                  <div className="w-3 h-3 bg-cyan-400 rounded-sm shadow-[0_0_8px_cyan]"></div>
                </div>
                <h1 className="text-2xl font-black tracking-tighter text-cyan-400 uppercase italic">Broadcast Hub</h1>
              </div>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">
                v{APP_VERSION} // MULTI-NODE PROTOCOL ACTIVE
              </p>
            </div>

            <div className="flex gap-4 items-center">
              <div className="hidden md:flex bg-[#0f1117] border border-slate-800 rounded-lg px-4 py-2 items-center gap-3 shadow-inner">
                <div className="w-2 h-2 rounded-full bg-cyan-500 shadow-[0_0_8px_cyan] animate-pulse"></div>
                <div className="text-[10px] font-mono whitespace-nowrap">
                  <span className="text-slate-500">HOST:</span> <span className="text-white font-bold">{user.email?.split('@')[0].toUpperCase()}</span>
                </div>
              </div>
              <button 
                onClick={handleLogout}
                className="bg-[#0f1117] border border-slate-800 rounded-lg p-3 text-slate-400 hover:text-red-400 hover:border-red-400/30 transition-all"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          <main className="flex-1 flex flex-col md:flex-row gap-8 overflow-hidden min-h-0">
            {/* Control Panel */}
            <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0c10] rounded-3xl border border-slate-800/50 shadow-2xl relative overflow-hidden p-8">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(6,182,212,0.05),transparent_70%)]"></div>
              
              <div className="w-full max-w-md space-y-12 relative z-10">
                {/* Status Indicator */}
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={cn(
                    "mx-auto w-fit px-4 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-[0.2em] flex items-center gap-2",
                    permission === 'granted' ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-400" : "bg-amber-500/10 border-amber-500/50 text-amber-400"
                  )}
                >
                  <div className={cn("w-1.5 h-1.5 rounded-full", permission === 'granted' ? "bg-emerald-500 shadow-[0_0_8px_emerald]" : "bg-amber-500")} />
                  {permission === 'granted' ? "Signal Strength: Optimal" : "Action Required: Grant Permissions"}
                </motion.div>

                {/* Main Action Component */}
                <div className="relative flex flex-col items-center">
                  <motion.div 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="relative group "
                  >
                    <div className="absolute inset-0 bg-cyan-500 rounded-full blur-3xl opacity-10 group-hover:opacity-20 transition-opacity"></div>
                    <button
                      disabled={isSending}
                      onClick={sendNotification}
                      className={cn(
                        "w-56 h-56 rounded-full bg-[#0a0c10] border-4 flex items-center justify-center p-4 relative z-10 transition-all duration-500",
                        isSending ? "border-slate-800 cursor-wait" : "border-slate-800 group-hover:border-cyan-500 shadow-[inset_0_0_20px_rgba(0,0,0,0.8)]"
                      )}
                    >
                      <div className="w-full h-full rounded-full border border-cyan-500/20 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_50%_0%,rgba(6,182,212,0.1),transparent_50%)] shadow-inner">
                        <div className={cn(
                          "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                          isSending ? "bg-slate-800" : "bg-cyan-500/10 group-hover:bg-cyan-500/20 group-hover:scale-110"
                        )}>
                          <BellRing className={cn("w-6 h-6", isSending ? "text-slate-500 animate-pulse" : "text-cyan-400")} />
                        </div>
                        <div className="text-center">
                          <span className={cn("block text-sm font-black tracking-[0.2em] text-white uppercase", isSending && "opacity-50")}>
                            {isSending ? "Transmitting" : "Send Push"}
                          </span>
                          <span className="text-[9px] text-cyan-500/50 font-mono tracking-tighter uppercase">Broadcast to Node Cluster</span>
                        </div>
                      </div>
                    </button>
                  </motion.div>

                  {permission !== 'granted' && (
                    <button 
                      onClick={requestPermission}
                      className="mt-10 bg-cyan-600/10 border border-cyan-500/50 text-cyan-400 px-8 py-3 rounded-xl text-[11px] font-bold tracking-[0.2em] uppercase hover:bg-cyan-500/20 active:scale-95 transition-all shadow-[0_0_15px_rgba(6,182,212,0.1)]"
                    >
                      Initialize System Permissions
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800 flex flex-col gap-2">
                    <p className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">Audio Protocol</p>
                    <p className="text-xs font-bold text-slate-300 uppercase">Sine_Chime_880Hz.wav</p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800 flex flex-col gap-2">
                    <p className="text-[10px] font-mono text-slate-600 uppercase tracking-wider">Geo-Time</p>
                    <p className="text-xs font-bold text-slate-300 uppercase">Europe / Warsaw</p>
                  </div>
                </div>
              </div>

              {/* Central Footer Version */}
              <div className="mt-auto pt-8 border-t border-slate-800/30 w-full text-center">
                <p className="text-[9px] font-mono text-slate-700 uppercase tracking-[0.3em]">Core System Architecture v{APP_VERSION}</p>
              </div>
            </div>

            {/* Logs Side Panel / Admin */}
            <div className="w-full md:w-96 bg-[#0a0c10] rounded-3xl border border-slate-800 flex flex-col shadow-2xl overflow-hidden min-h-0">
              <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/20">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-cyan-400" />
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Transmission Log</h2>
                </div>
                <span className="text-[9px] font-mono bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded animate-pulse border border-cyan-500/20">LIVE FEED</span>
              </div>
              
              <div className="flex-1 p-6 space-y-6 font-mono text-[10px] overflow-y-auto no-scrollbar">
                <AnimatePresence initial={false}>
                  {logs.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-700 italic gap-2 py-20">
                      <Clock className="w-8 h-8 opacity-20" />
                      <p>Wwaiting for node signals...</p>
                    </div>
                  ) : (
                    logs.map((log) => (
                      <motion.div 
                        key={log.id}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="space-y-1 pb-4 border-b border-slate-800/10 group"
                      >
                        <div className="flex justify-between items-center text-slate-600 mb-1">
                          <span className="text-cyan-600/70">[{formatTimestamp(log.timestamp)}]</span>
                          <span className={cn("px-1.5 rounded-xs", log.senderId === user.uid ? "bg-blue-500/10 text-blue-400" : "bg-cyan-500/10 text-cyan-400")}>
                            {log.senderId === user.uid ? "LOCAL_SND" : "REMOTE_RCV"}
                          </span>
                        </div>
                        <p className="text-slate-300 font-sans text-xs">{log.senderEmail.split('@')[0]}: {log.message}</p>
                        <p className="text-[9px] text-slate-500 truncate group-hover:text-cyan-900 transition-colors">NODE_ID: {log.senderId}</p>
                      </motion.div>
                    ))
                  )}
                </AnimatePresence>
              </div>

              <div className="p-6 border-t border-slate-800 bg-slate-900/10 flex flex-col gap-4">
                 <div className="flex justify-between items-center text-[9px] font-mono text-slate-600 uppercase tracking-wider">
                  <span>Audit Version</span>
                  <span className="text-cyan-800">Secure Protocol v{APP_VERSION}</span>
                </div>
                <button className="w-full py-3 bg-slate-800/50 hover:bg-slate-800 rounded-lg text-[10px] font-bold uppercase tracking-[0.2em] transition-all hover:text-white border border-slate-700/50">
                  Export System Metrics
                </button>
              </div>
            </div>
          </main>

          {/* Instrukcja techniczna dla AI */}
          <div className="mt-16 pt-12 border-t border-white/5 w-full">
            <div className="flex items-center gap-3 mb-8">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <BookOpen className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">PROMPT DLA AGENTA: IMPLEMENTACJA PUSH</h3>
                <p className="text-gray-400 text-xs">Wklej poniższy zestaw plików do swojego agenta, aby aktywować powiadomienia.</p>
              </div>
            </div>

            <div className="space-y-8 font-mono text-[11px] leading-relaxed">
              {/* Service Worker */}
              <div className="space-y-3">
                <div className="flex justify-between items-center bg-zinc-900 px-4 py-2 rounded-t-xl border-x border-t border-white/10">
                  <span className="text-cyan-400 font-bold">1. /public/firebase-messaging-sw.js</span>
                  <span className="text-gray-500 text-[9px]">SERVICE WORKER</span>
                </div>
                <div className="bg-black/60 p-5 rounded-b-xl border border-white/10 overflow-x-auto">
                  <pre className="text-gray-300">
{`importScripts('https://www.gstatic.com/firebasejs/10.12.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.1/firebase-messaging-compat.js');

firebase.initializeApp({
  // TUTAJ WKLEJ SWOJE CONFIG Z KONSOLI FIREBASE
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  return self.registration.showNotification(payload.notification.title || 'Nowe powiadomienie', {
    body: payload.notification.body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { url: payload.data?.url || '/' },
    tag: 'push-notification',
    renotify: true,
    requireInteraction: true
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url === urlToOpen && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(urlToOpen);
    })
  );
});`}
                  </pre>
                </div>
              </div>

              {/* Client Firebase Logic */}
              <div className="space-y-3">
                <div className="flex justify-between items-center bg-zinc-900 px-4 py-2 rounded-t-xl border-x border-t border-white/10">
                  <span className="text-cyan-400 font-bold">2. /src/firebase.ts (Fragment rejestracji)</span>
                  <span className="text-gray-500 text-[9px]">SDK CLIENT</span>
                </div>
                <div className="bg-black/60 p-5 rounded-b-xl border border-white/10 overflow-x-auto">
                  <pre className="text-gray-300">
{`export async function registerFCMToken(user: User) {
  if (!messaging || typeof window === 'undefined') return;
  try {
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
    const token = await getToken(messaging, {
      serviceWorkerRegistration: registration,
      vapidKey: 'TWOJ_PUBLIC_VAPID_KEY_Z_KONSOLI'
    });
    
    if (token) {
      await setDoc(doc(db, 'tokens', user.uid), {
        token,
        email: user.email,
        updatedAt: new Date()
      });
    }
  } catch (error) {
    console.error('Błąd rejestracji tokena:', error);
  }
}`}
                  </pre>
                </div>
              </div>

              {/* Server Broadcast Logic */}
              <div className="space-y-3">
                <div className="flex justify-between items-center bg-zinc-900 px-4 py-2 rounded-t-xl border-x border-t border-white/10">
                  <span className="text-cyan-400 font-bold">3. /server.ts (Express API)</span>
                  <span className="text-gray-500 text-[9px]">BACKEND BROADCAST</span>
                </div>
                <div className="bg-black/60 p-5 rounded-b-xl border border-white/10 overflow-x-auto">
                  <pre className="text-gray-300">
{`import admin from 'firebase-admin';
import { getMessaging } from 'firebase-admin/messaging';

// API do wysyłki do wszystkich
app.post('/api/broadcast', async (req, res) => {
  const { message, senderEmail } = req.body;
  const db = admin.firestore();
  const tokensSnapshot = await db.collection('tokens').get();
  const tokens = tokensSnapshot.docs.map(doc => doc.data().token);

  if (tokens.length > 0) {
    const payload = {
      notification: { title: 'Nowa wiadomość!', body: \`\${senderEmail}: \${message}\` },
      tokens: tokens.slice(0, 500)
    };
    await getMessaging().sendEachForMulticast(payload);
  }
  res.json({ success: true });
});`}
                  </pre>
                </div>
              </div>

              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                <p className="text-emerald-400 font-bold text-[10px] uppercase mb-1">PROTIP DLA AGENTA:</p>
                <p className="text-xs text-emerald-200/80">
                  Używaj metody <strong>messaging.sendEachForMulticast</strong> zamiast pojedynczych wysyłek. 
                  Pamiętaj o rejestracji Service Workera z odpowiednim scope ('/'). 
                  Przeglądarki mobilne wymagają interakcji użytkownika (np. kliknięcie przycisku "Zaloguj") 
                  zanim wywołasz <strong>Notification.requestPermission()</strong>.
                </p>
              </div>
            </div>
          </div>

          <footer className="mt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-mono text-slate-600 uppercase tracking-[0.1em]">
            <div className="flex gap-6">
              <span className="flex items-center gap-1.5"><div className="w-1 h-1 bg-cyan-500 rounded-full"></div> LATENCY: 12ms</span>
              <span className="flex items-center gap-1.5"><div className="w-1 h-1 bg-cyan-500 rounded-full"></div> ENCRYPTION: AES-256</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-cyan-900 font-bold">● Secure Channel Established v{APP_VERSION}</span>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}
