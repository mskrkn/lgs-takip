// ============================================
// LGS Deneme Takip - Cloud Sync Module
// Realtime Cross-Device Synchronization (Firebase / Cloud Storage)
// ============================================

// Varsayilan bulut baglantisi: hicbir cihazda elle giris yapilmadan
// otomatik baglanmak icin kullanilir. Ayarlar sayfasindan farkli bir
// config/oda adi girilirse, o cihazda bu varsayilanlarin yerini alir.
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCPg07Os47RyCd-5-hU0b2VnVnxNSliKek",
  authDomain: "takipedupusula.firebaseapp.com",
  projectId: "takipedupusula",
  storageBucket: "takipedupusula.firebasestorage.app",
  messagingSenderId: "506109702358",
  appId: "1:506109702358:web:77a457adad5bc7169b1977",
  measurementId: "G-MYP7HXEL9S"
};
const DEFAULT_SYNC_KEY = 'mskrknedupusula';

const SyncModule = {
  status: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error'
  lastSyncTime: null,
  autoSync: false,
  firestoreDb: null,
  firebaseApp: null,
  unsubscribeListeners: [],
  syncKey: '',

  // Initialize on app startup
  async init() {
    this.syncKey = localStorage.getItem('lgs_sync_key') || DEFAULT_SYNC_KEY;
    const autoSyncStored = localStorage.getItem('lgs_auto_sync');
    this.autoSync = autoSyncStored === null ? true : autoSyncStored === 'true';
    this.lastSyncTime = localStorage.getItem('lgs_last_sync_time') || null;

    const savedConfig = localStorage.getItem('lgs_firebase_config');
    try {
      const config = savedConfig ? JSON.parse(savedConfig) : DEFAULT_FIREBASE_CONFIG;
      await this.connectFirebase(config, false);
    } catch (e) {
      console.warn('Firebase auto-connect failed:', e);
    }

    // Listen for online/offline events
    window.addEventListener('online', () => {
      this.updateStatus();
      if (this.autoSync && this.isConnected()) {
        this.pushLocalToCloud();
      }
    });

    window.addEventListener('offline', () => {
      this.updateStatus();
    });
  },

  isConnected() {
    return this.status === 'connected' && !!this.firestoreDb && !!this.syncKey;
  },

  // Connect to Firebase Firestore
  async connectFirebase(config, showToasts = true) {
    try {
      this.status = 'connecting';
      this.updateStatus();

      if (!window.firebase) {
        throw new Error('Firebase kütüphanesi yüklenemedi. Lütfen internet bağlantınızı kontrol edin.');
      }

      // Initialize Firebase App
      if (!firebase.apps.length) {
        this.firebaseApp = firebase.initializeApp(config);
      } else {
        this.firebaseApp = firebase.app();
      }

      this.firestoreDb = firebase.firestore();
      
      // Save config
      localStorage.setItem('lgs_firebase_config', JSON.stringify(config));
      if (!this.syncKey) {
        this.syncKey = DEFAULT_SYNC_KEY;
        localStorage.setItem('lgs_sync_key', this.syncKey);
      }

      this.status = 'connected';
      this.updateStatus();

      if (showToasts && typeof UI !== 'undefined') {
        UI.toast('Bulut veritabanına başarıyla bağlanıldı!', 'success');
      }

      // Start real-time listeners if autoSync is on
      if (this.autoSync) {
        this.startRealtimeListener();
      }

      return { success: true };
    } catch (err) {
      this.status = 'error';
      this.updateStatus();
      console.error('Firebase connection error:', err);
      if (showToasts && typeof UI !== 'undefined') {
        UI.toast('Bulut bağlantısı kurulamadı: ' + err.message, 'danger');
      }
      return { success: false, error: err.message };
    }
  },

  // Disconnect from Firebase
  disconnect() {
    this.stopRealtimeListener();
    this.firestoreDb = null;
    this.status = 'disconnected';
    localStorage.removeItem('lgs_firebase_config');
    this.updateStatus();
    if (typeof UI !== 'undefined') {
      UI.toast('Bulut bağlantısı kesildi', 'info');
    }
  },

  // Set Sync Key / Room Name
  setSyncKey(key) {
    this.syncKey = (key || '').trim();
    localStorage.setItem('lgs_sync_key', this.syncKey);
    if (this.isConnected() && this.autoSync) {
      this.stopRealtimeListener();
      this.startRealtimeListener();
    }
    this.updateStatus();
  },

  // Set Auto Sync preference
  setAutoSync(enabled) {
    this.autoSync = !!enabled;
    localStorage.setItem('lgs_auto_sync', this.autoSync ? 'true' : 'false');
    if (this.autoSync && this.isConnected()) {
      this.startRealtimeListener();
    } else {
      this.stopRealtimeListener();
    }
    this.updateStatus();
  },

  // Push all local Dexie DB data to Cloud
  async pushLocalToCloud(silent = false) {
    if (!this.isConnected()) {
      if (!silent && typeof UI !== 'undefined') {
        UI.toast('Bulut bağlantısı aktif değil. Lütfen ayarlardan bağlantı kurun.', 'warning');
      }
      return false;
    }

    try {
      this.status = 'syncing';
      this.updateStatus();

      const fullData = await db.exportData();
      const docRef = this.firestoreDb.collection('lgs_sync_rooms').doc(this.syncKey);

      await docRef.set({
        version: 1,
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
        deviceInfo: navigator.userAgent,
        data: JSON.stringify(fullData)
      }, { merge: true });

      this.lastSyncTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      localStorage.setItem('lgs_last_sync_time', this.lastSyncTime);
      this.status = 'connected';
      this.updateStatus();

      if (!silent && typeof UI !== 'undefined') {
        UI.toast('Tüm veriler buluta başarıyla yüklendi ☁️', 'success');
      }
      return true;
    } catch (err) {
      this.status = 'error';
      this.updateStatus();
      console.error('Push to cloud error:', err);
      if (!silent && typeof UI !== 'undefined') {
        UI.toast('Buluta yükleme başarısız: ' + err.message, 'danger');
      }
      return false;
    }
  },

  // Pull all data from Cloud and update local Dexie DB
  async pullCloudToLocal(silent = false) {
    if (!this.isConnected()) {
      if (!silent && typeof UI !== 'undefined') {
        UI.toast('Bulut bağlantısı aktif değil.', 'warning');
      }
      return false;
    }

    try {
      this.status = 'syncing';
      this.updateStatus();

      const docRef = this.firestoreDb.collection('lgs_sync_rooms').doc(this.syncKey);
      const doc = await docRef.get();

      if (!doc.exists) {
        if (!silent && typeof UI !== 'undefined') {
          UI.toast('Bu eşitleme anahtarına ait bulut verisi bulunamadı.', 'warning');
        }
        this.status = 'connected';
        this.updateStatus();
        return false;
      }

      const remoteData = doc.data();
      if (remoteData && remoteData.data) {
        const parsed = JSON.parse(remoteData.data);
        await db.importData(parsed);

        this.lastSyncTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        localStorage.setItem('lgs_last_sync_time', this.lastSyncTime);
        this.status = 'connected';
        this.updateStatus();

        if (typeof App !== 'undefined') {
          App.refreshCurrentPage();
        }

        if (!silent && typeof UI !== 'undefined') {
          UI.toast('Buluttaki veriler cihazınıza başarıyla aktarıldı 📥', 'success');
        }
        return true;
      }
      this.status = 'connected';
      this.updateStatus();
      return false;
    } catch (err) {
      this.status = 'error';
      this.updateStatus();
      console.error('Pull from cloud error:', err);
      if (!silent && typeof UI !== 'undefined') {
        UI.toast('Buluttan veri çekme hatası: ' + err.message, 'danger');
      }
      return false;
    }
  },

  // Real-time listener for remote changes
  startRealtimeListener() {
    this.stopRealtimeListener();
    if (!this.isConnected()) return;

    try {
      const docRef = this.firestoreDb.collection('lgs_sync_rooms').doc(this.syncKey);
      let isFirstSnapshot = true;

      const unsub = docRef.onSnapshot(async (snapshot) => {
        if (isFirstSnapshot) {
          isFirstSnapshot = false;
          return;
        }

        if (snapshot.exists && !snapshot.metadata.hasPendingWrites) {
          const remoteData = snapshot.data();
          if (remoteData && remoteData.data) {
            try {
              const parsed = JSON.parse(remoteData.data);
              await db.importData(parsed);
              this.lastSyncTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              localStorage.setItem('lgs_last_sync_time', this.lastSyncTime);
              this.updateStatus();

              if (typeof App !== 'undefined') {
                App.refreshCurrentPage();
              }
              if (typeof UI !== 'undefined') {
                UI.toast('Diğer cihazdan yapılan değişiklikler eşitlendi 🔄', 'info');
              }
            } catch (e) {
              console.warn('Realtime parse error:', e);
            }
          }
        }
      }, (err) => {
        console.warn('Snapshot listener error:', err);
      });

      this.unsubscribeListeners.push(unsub);
    } catch (e) {
      console.warn('Could not start realtime listener:', e);
    }
  },

  stopRealtimeListener() {
    this.unsubscribeListeners.forEach(unsub => {
      try { unsub(); } catch (_) {}
    });
    this.unsubscribeListeners = [];
  },

  // Debounced auto-push when local changes occur
  _debounceTimer: null,
  notifyLocalChange() {
    if (!this.isConnected() || !this.autoSync) return;
    
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.pushLocalToCloud(true);
    }, 1500);
  },

  // Update UI indicators
  updateStatus() {
    const badge = document.getElementById('sync-status-badge');
    const statusText = document.getElementById('sync-status-text');
    const timeText = document.getElementById('sync-last-time');

    let badgeClass = 'sync-offline';
    let label = 'Çevrimdışı';
    let icon = '⚪';

    if (!navigator.onLine) {
      badgeClass = 'sync-offline';
      label = 'İnternet Yok';
      icon = '🔴';
    } else if (this.status === 'connecting') {
      badgeClass = 'sync-connecting';
      label = 'Bağlanıyor...';
      icon = '🟡';
    } else if (this.status === 'syncing') {
      badgeClass = 'sync-syncing';
      label = 'Eşitleniyor...';
      icon = '🔄';
    } else if (this.status === 'connected') {
      badgeClass = 'sync-connected';
      label = 'Bulut Senkronize';
      icon = '🟢';
    } else if (this.status === 'error') {
      badgeClass = 'sync-error';
      label = 'Bağlantı Hatası';
      icon = '⚠️';
    }

    if (badge) {
      badge.className = `sync-status-pill ${badgeClass}`;
      badge.innerHTML = `<span class="sync-dot"></span><span>${label}</span>`;
      badge.title = this.syncKey ? `Oda: ${this.syncKey}` : 'Bulut Senkronizasyonu';
    }

    if (statusText) statusText.textContent = label;
    if (timeText) timeText.textContent = this.lastSyncTime || 'Henüz eşitlenmedi';
  }
};
