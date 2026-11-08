import React, { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, onSnapshot, query as firestoreQuery, orderBy, limit } from 'firebase/firestore';
import {
  Monitor,
  Smartphone,
  Apple,
  History,
  Trash2,
  Search,
  LogIn,
  LogOut,
  AlertCircle,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  BulkInstallItem,
  LiveSearchResponse,
  PlatformType,
  SavedSoftwareRecord,
  SearchHistoryRecord,
} from './types.ts';
import {
  auth,
  db,
  signInWithGoogle,
  signOutUser,
  saveSoftwareToFirestore,
  updateSavedSoftwareNotesInFirestore,
  deleteSavedSoftwareFromFirestore,
  logSearchToFirestore,
  deleteSearchHistoryFromFirestore,
  handleFirestoreError,
  OperationType,
  formatFirestoreTimestamp,
  sanitizeId,
} from './lib/firebase.ts';
import {
  getLocalSavedApps,
  putLocalSavedApp,
  removeLocalSavedApp,
  getLocalSearchHistory,
  putLocalSearchHistory,
  deleteLocalSearchHistory,
  getCachedSearchResult,
  setCachedSearchResult,
} from './lib/indexedDb.ts';
import { SearchBarWithAutocomplete } from './components/SearchBarWithAutocomplete.tsx';
import { SearchResultView } from './components/SearchResultView.tsx';
import { HomepageCarousels } from './components/HomepageCarousels.tsx';
import { WishlistView } from './components/WishlistView.tsx';
import { AutoInstallerEngine } from './components/AutoInstallerEngine.tsx';
import { AppIcon } from './components/AppIcon.tsx';
import { API_BASE_URL } from './services/apiClient.ts';

type ActiveSection = 'discover' | 'library' | 'history' | 'sources';

const QUICK_PLATFORM_EXAMPLES: Record<PlatformType, string[]> = {
  pc: ['OBS Studio', 'Adobe Photoshop', 'VLC Media Player', 'Blender', '7-Zip', 'Notepad++'],
  android: ['NewPipe', 'Signal', 'VLC', 'Bitwarden', 'Telegram', 'AntennaPod'],
  ios: ['Notion', 'Procreate Pocket', 'WhatsApp', 'GarageBand', 'Brave Browser', 'TestFlight'],
};

export default function App() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<ActiveSection>('discover');
  const [platform, setPlatform] = useState<PlatformType>('pc');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<LiveSearchResponse | null>(null);

  // Auth & Persistence state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(false);

  const [savedApps, setSavedApps] = useState<SavedSoftwareRecord[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryRecord[]>([]);
  const [bulkInstallItems, setBulkInstallItems] = useState<BulkInstallItem[]>(() => {
    try {
      const raw = localStorage.getItem('vanguard_bulk_install_queue');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem('vanguard_bulk_install_queue', JSON.stringify(bulkInstallItems));
    } catch {
      // ignore
    }
  }, [bulkInstallItems]);

  const handleToggleBulkInstall = useCallback((item: Omit<BulkInstallItem, 'addedAt'>) => {
    const safeKey = sanitizeId(item.appKey, 120);
    setBulkInstallItems((prev) => {
      const exists = prev.some((b) => b.appKey === safeKey);
      if (exists) {
        return prev.filter((b) => b.appKey !== safeKey);
      }
      return [
        ...prev,
        {
          ...item,
          appKey: safeKey,
          addedAt: new Date().toISOString(),
        },
      ];
    });
  }, []);

  const handleRemoveBulkItem = useCallback((appKey: string) => {
    setBulkInstallItems((prev) => prev.filter((b) => b.appKey !== appKey));
  }, []);

  const handleClearBulkPlatform = useCallback((target: 'pc' | 'android' | 'all') => {
    if (target === 'all') {
      setBulkInstallItems([]);
    } else {
      setBulkInstallItems((prev) => prev.filter((b) => b.platform !== target));
    }
  }, []);

  const handleUpdateBulkItemMeta = useCallback(
    (appKey: string, patch: Partial<BulkInstallItem>) => {
      setBulkInstallItems((prev) =>
        prev.map((item) => (item.appKey === appKey ? { ...item, ...patch } : item))
      );
    },
    []
  );

  // Load local IndexedDB data immediately on mount (offline-first PWA persistence)
  useEffect(() => {
    getLocalSavedApps().then((items) => {
      if (items.length > 0) setSavedApps(items);
    });
    getLocalSearchHistory().then((items) => {
      if (items.length > 0) setSearchHistory(items);
    });
  }, []);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Bi-directional sync helper: pushes any local IndexedDB items missing from Firestore up to Firebase
  const handleSyncLocalToCloud = useCallback(async () => {
    if (!user) return;
    setIsSyncingCloud(true);
    try {
      const localItems = await getLocalSavedApps();
      for (const item of localItems) {
        await saveSoftwareToFirestore(user.uid, {
          appKey: item.appKey,
          platform: item.platform,
          name: item.name,
          developer: item.developer,
          iconUrl: item.iconUrl,
          primaryUrl: item.primaryUrl,
          secondaryUrl: item.secondaryUrl,
          category: item.category,
          license: item.license,
          version: item.version,
          notes: item.notes || '',
        });
      }
    } finally {
      setIsSyncingCloud(false);
    }
  }, [user]);

  // Real-time Firestore listeners when user is signed in
  useEffect(() => {
    if (!authReady || !user) return;

    const safeUserId = sanitizeId(user.uid, 128);
    const savedPath = `users/${safeUserId}/savedApps`;
    const historyPath = `users/${safeUserId}/searchHistory`;

    const savedRef = collection(db, 'users', safeUserId, 'savedApps');
    const unsubSaved = onSnapshot(
      savedRef,
      async (snapshot) => {
        const cloudSaved: SavedSoftwareRecord[] = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              appKey: String(data.appKey || d.id),
              ownerId: String(data.ownerId || safeUserId),
              platform: (data.platform as PlatformType) || 'pc',
              name: String(data.name || ''),
              developer: String(data.developer || ''),
              iconUrl: String(data.iconUrl || ''),
              primaryUrl: String(data.primaryUrl || ''),
              secondaryUrl: String(data.secondaryUrl || ''),
              category: String(data.category || ''),
              license: String(data.license || ''),
              version: String(data.version || ''),
              notes: String(data.notes || ''),
              createdAt: formatFirestoreTimestamp(data.createdAt),
              updatedAt: formatFirestoreTimestamp(data.updatedAt),
            };
          })
          .filter((item) => item.ownerId === safeUserId);

        const cloudKeys = new Set(cloudSaved.map((c) => c.appKey));
        const localItems = await getLocalSavedApps();
        const unsyncedLocal = localItems.filter((l) => !cloudKeys.has(l.appKey));

        // Upload any offline-saved local items to Firestore so nothing is lost on sign-in
        for (const localOnly of unsyncedLocal) {
          saveSoftwareToFirestore(user.uid, {
            appKey: localOnly.appKey,
            platform: localOnly.platform,
            name: localOnly.name,
            developer: localOnly.developer,
            iconUrl: localOnly.iconUrl,
            primaryUrl: localOnly.primaryUrl,
            secondaryUrl: localOnly.secondaryUrl,
            category: localOnly.category,
            license: localOnly.license,
            version: localOnly.version,
            notes: localOnly.notes || '',
          });
        }

        const merged = [...cloudSaved, ...unsyncedLocal];
        merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setSavedApps(merged);
        // Mirror cloud items into IndexedDB for offline access
        cloudSaved.forEach((item) => putLocalSavedApp(item));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, savedPath);
      }
    );

    const historyRef = firestoreQuery(
      collection(db, 'users', safeUserId, 'searchHistory'),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
    const unsubHistory = onSnapshot(
      historyRef,
      (snapshot) => {
        const cloudHistory: SearchHistoryRecord[] = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              query: String(data.query || ''),
              platform: (data.platform as PlatformType) || 'pc',
              ownerId: String(data.ownerId || safeUserId),
              resultCount: Number(data.resultCount || 0),
              topResultName: String(data.topResultName || ''),
              topResultIcon: String(data.topResultIcon || ''),
              createdAt: formatFirestoreTimestamp(data.createdAt),
            };
          })
          .filter((item) => item.ownerId === safeUserId);

        setSearchHistory(cloudHistory);
        cloudHistory.forEach((item) => putLocalSearchHistory(item));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, historyPath);
      }
    );

    return () => {
      unsubSaved();
      unsubHistory();
    };
  }, [authReady, user]);

  // Execute live search against backend /api/search
  const executeSearch = useCallback(
    async (rawQuery: string, targetPlatform: PlatformType = platform, bypassCache = false) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) return;

      setSearchQuery(trimmed);
      setPlatform(targetPlatform);
      setActiveSection('discover');
      setIsSearching(true);
      setSearchError(null);

      try {
        if (!bypassCache) {
          const cached = await getCachedSearchResult(targetPlatform, trimmed);
          if (cached && cached.primaryResult) {
            setSearchResult(cached);
            setIsSearching(false);
            return;
          }
        }

        const res = await fetch(
          `${API_BASE_URL}/search?q=${encodeURIComponent(trimmed)}&platform=${encodeURIComponent(targetPlatform)}`
        );
        if (!res.ok) {
          const errJson = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errJson.error || `Search request failed with status ${res.status}`);
        }

        const data = (await res.json()) as LiveSearchResponse;
        setSearchResult(data);
        await setCachedSearchResult(targetPlatform, trimmed, data);

        // Persist search history to IndexedDB + Firestore (if authenticated)
        const totalMatches =
          (data.primaryResult ? 1 : 0) +
          data.secondaryResults.length +
          data.alternatives.length;

        const nowIso = new Date().toISOString();
        const historyId = sanitizeId(
          `${targetPlatform}-${trimmed.toLowerCase()}-${Date.now()}`,
          120
        );
        const localEntry: SearchHistoryRecord = {
          id: historyId,
          query: trimmed,
          platform: targetPlatform,
          ownerId: user?.uid || 'local',
          resultCount: totalMatches,
          topResultName: data.primaryResult?.name || trimmed,
          topResultIcon: data.primaryResult?.iconUrl || '',
          createdAt: nowIso,
        };

        await putLocalSearchHistory(localEntry);
        if (!user) {
          setSearchHistory((prev) => [localEntry, ...prev.filter((h) => h.id !== historyId)].slice(0, 30));
        } else {
          await logSearchToFirestore(user.uid, {
            query: trimmed,
            platform: targetPlatform,
            resultCount: totalMatches,
            topResultName: data.primaryResult?.name || trimmed,
            topResultIcon: data.primaryResult?.iconUrl || '',
          });
        }
      } catch (err) {
        setSearchError(
          err instanceof Error ? err.message : 'Unable to complete live software search.'
        );
      } finally {
        setIsSearching(false);
      }
    },
    [platform, user]
  );

  // Keep homepage focused on the unified search bar + live 15-item category carousels on initial load
  const [carouselPlatform, setCarouselPlatform] = useState<PlatformType>('pc');

  const handleToggleSave = async (item: {
    appKey: string;
    platform: PlatformType;
    name: string;
    developer: string;
    iconUrl: string;
    primaryUrl: string;
    secondaryUrl: string;
    category: string;
    license: string;
    version: string;
  }) => {
    const safeKey = sanitizeId(item.appKey, 120);
    const existing = savedApps.find((s) => s.appKey === safeKey);

    if (existing) {
      await removeLocalSavedApp(safeKey);
      setSavedApps((prev) => prev.filter((s) => s.appKey !== safeKey));
      if (user) {
        await deleteSavedSoftwareFromFirestore(user.uid, safeKey);
      }
    } else {
      const nowIso = new Date().toISOString();
      const newRecord: SavedSoftwareRecord = {
        id: safeKey,
        appKey: safeKey,
        ownerId: user?.uid || 'local',
        platform: item.platform,
        name: item.name,
        developer: item.developer,
        iconUrl: item.iconUrl,
        primaryUrl: item.primaryUrl,
        secondaryUrl: item.secondaryUrl,
        category: item.category,
        license: item.license,
        version: item.version,
        notes: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await putLocalSavedApp(newRecord);
      setSavedApps((prev) => [newRecord, ...prev.filter((s) => s.appKey !== safeKey)]);
      if (user) {
        await saveSoftwareToFirestore(user.uid, {
          appKey: safeKey,
          platform: item.platform,
          name: item.name,
          developer: item.developer,
          iconUrl: item.iconUrl,
          primaryUrl: item.primaryUrl,
          secondaryUrl: item.secondaryUrl,
          category: item.category,
          license: item.license,
          version: item.version,
          notes: '',
        });
      }
    }
  };

  const handleAddCustomWishlistItem = async (item: {
    appKey: string;
    platform: PlatformType;
    name: string;
    developer: string;
    iconUrl: string;
    primaryUrl: string;
    secondaryUrl: string;
    category: string;
    license: string;
    version: string;
    notes?: string;
  }) => {
    const safeKey = sanitizeId(item.appKey, 120);
    const nowIso = new Date().toISOString();
    const newRecord: SavedSoftwareRecord = {
      id: safeKey,
      appKey: safeKey,
      ownerId: user?.uid || 'local',
      platform: item.platform,
      name: item.name,
      developer: item.developer,
      iconUrl: item.iconUrl,
      primaryUrl: item.primaryUrl,
      secondaryUrl: item.secondaryUrl,
      category: item.category,
      license: item.license,
      version: item.version,
      notes: (item.notes || '').slice(0, 500),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await putLocalSavedApp(newRecord);
    setSavedApps((prev) => [newRecord, ...prev.filter((s) => s.appKey !== safeKey)]);
    if (user) {
      await saveSoftwareToFirestore(user.uid, {
        appKey: safeKey,
        platform: item.platform,
        name: item.name,
        developer: item.developer,
        iconUrl: item.iconUrl,
        primaryUrl: item.primaryUrl,
        secondaryUrl: item.secondaryUrl,
        category: item.category,
        license: item.license,
        version: item.version,
        notes: (item.notes || '').slice(0, 500),
      });
    }
  };

  const handleSaveNotes = async (record: SavedSoftwareRecord, newNotes: string) => {
    const updatedNotes = newNotes.trim().slice(0, 500);
    const updatedRecord: SavedSoftwareRecord = {
      ...record,
      notes: updatedNotes,
      updatedAt: new Date().toISOString(),
    };
    await putLocalSavedApp(updatedRecord);
    setSavedApps((prev) =>
      prev.map((item) => (item.appKey === record.appKey ? updatedRecord : item))
    );
    if (user) {
      await updateSavedSoftwareNotesInFirestore(user.uid, record.appKey, updatedNotes);
    }
  };

  const handleDeleteHistoryItem = async (item: SearchHistoryRecord) => {
    await deleteLocalSearchHistory(item.id);
    setSearchHistory((prev) => prev.filter((h) => h.id !== item.id));
    if (user) {
      await deleteSearchHistoryFromFirestore(user.uid, item.id);
    }
  };

  const handleAuthAction = async () => {
    setAuthError(null);
    try {
      if (user) {
        await signOutUser();
      } else {
        await signInWithGoogle();
      }
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Authentication could not be completed.'
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 flex flex-col">
      {/* Subtle Ambient Radial Backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden z-0"
      >
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[900px] h-[420px] bg-sky-500/10 blur-[140px] rounded-full" />
      </div>

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#070B14]/85 backdrop-blur-xl border-b border-slate-800/80 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-8">
          {/* Zone 1: Single text element wordmark */}
          <a
            href="#discover"
            onClick={(e) => {
              e.preventDefault();
              setActiveSection('discover');
            }}
            className="text-xl font-display font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0"
          >
            Vanguard Index
          </a>

          {/* Zone 2: 4 concise single-line navigation links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300">
            <a
              href="#discover"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('discover');
              }}
              className={`hover:text-sky-300 hover:underline underline-offset-8 transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'discover' ? 'text-sky-400 underline' : ''
              }`}
            >
              Discover
            </a>
            <a
              href="#library"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('library');
              }}
              className={`hover:text-sky-300 hover:underline underline-offset-8 transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'library' ? 'text-sky-400 underline' : ''
              }`}
            >
              {t('wishlist')} ({savedApps.length})
            </a>
            <a
              href="#history"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('history');
              }}
              className={`hover:text-sky-300 hover:underline underline-offset-8 transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'history' ? 'text-sky-400 underline' : ''
              }`}
            >
              Search History
            </a>
            <a
              href="#sources"
              onClick={(e) => {
                e.preventDefault();
                setActiveSection('sources');
              }}
              className={`hover:text-sky-300 hover:underline underline-offset-8 transition-colors whitespace-nowrap shrink-0 ${
                activeSection === 'sources' ? 'text-sky-400 underline' : ''
              }`}
            >
              Sources
            </a>
          </nav>

          {/* Zone 3: 1 Primary Action Button */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={handleAuthAction}
              className="px-4 py-2 text-sm font-semibold text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {user ? (
                <>
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out ({user.displayName?.split(' ')[0] || 'Synced'})</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Sign In to Sync</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Secondary Section Switcher */}
      <div className="md:hidden border-b border-slate-800/80 bg-[#0B1120]/90 px-4 py-2 flex items-center justify-around text-xs font-medium text-slate-300 relative z-20">
        <button
          type="button"
          onClick={() => setActiveSection('discover')}
          className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'discover' ? 'text-sky-400 bg-sky-500/10' : ''
          }`}
        >
          Discover
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('library')}
          className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'library' ? 'text-sky-400 bg-sky-500/10' : ''
          }`}
        >
          Wishlist ({savedApps.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('history')}
          className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'history' ? 'text-sky-400 bg-sky-500/10' : ''
          }`}
        >
          History
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('sources')}
          className={`px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0 ${
            activeSection === 'sources' ? 'text-sky-400 bg-sky-500/10' : ''
          }`}
        >
          Sources
        </button>
      </div>

      {/* Main Content Container */}
      <main className="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {authError && (
          <div className="mb-6 bg-red-950/60 border border-red-500/40 rounded-xl px-4 py-3 text-sm text-red-200 flex items-center justify-between">
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setAuthError(null)}
              className="text-red-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ================================================================ */}
        {/* VIEW 1: DISCOVER (Unified Search Engine & Live Scraping Results) */}
        {/* ================================================================ */}
        {activeSection === 'discover' && (
          <div className="space-y-10">
            {/* Hero & Search Controls */}
            <section className="text-center max-w-4xl mx-auto space-y-6">
              <div className="space-y-3">
                <h1
                  className="text-3xl sm:text-5xl font-display font-extrabold text-slate-50 tracking-tight"
                  style={{ textWrap: 'balance' }}
                >
                  Authentic Software & Open-Source Discovery Across Every OS
                </h1>
                <p className="text-slate-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
                  Query official Windows installers and FOSS alternatives, Google Play and F-Droid
                  repositories, or strictly verified Apple App Store listings in real time.
                </p>
              </div>

              {/* Interactive Segmented Platform Switcher */}
              <div className="inline-flex flex-wrap items-center justify-center gap-1.5 p-1.5 bg-[#0F172A]/90 border border-slate-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => {
                    setPlatform('pc');
                    if (searchQuery.trim()) executeSearch(searchQuery, 'pc');
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    platform === 'pc'
                      ? 'bg-sky-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Monitor className="w-4 h-4" />
                  <span>{t('platforms.pc')} (PC)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlatform('android');
                    if (searchQuery.trim()) executeSearch(searchQuery, 'android');
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    platform === 'android'
                      ? 'bg-sky-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  <span>{t('platforms.android')} (Android)</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPlatform('ios');
                    if (searchQuery.trim()) executeSearch(searchQuery, 'ios');
                  }}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    platform === 'ios'
                      ? 'bg-sky-500 text-slate-950 shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                  }`}
                >
                  <Apple className="w-4 h-4" />
                  <span>{t('platforms.ios')} (iOS)</span>
                </button>
              </div>

              {/* Unified Search Bar with Live Autocomplete */}
              <SearchBarWithAutocomplete
                query={searchQuery}
                onQueryChange={setSearchQuery}
                platform={platform}
                onPlatformChange={(nextPlatform) => {
                  setPlatform(nextPlatform);
                  if (searchQuery.trim()) {
                    executeSearch(searchQuery, nextPlatform);
                  }
                }}
                onSubmitSearch={(q, targetPlat) => executeSearch(q, targetPlat || platform, true)}
                isSearching={isSearching}
              />

              {/* Quick-Launch Live Verification Queries */}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs text-slate-400">
                <span>Try live lookup:</span>
                {QUICK_PLATFORM_EXAMPLES[platform].map((sample, idx) => (
                  <React.Fragment key={sample}>
                    {idx > 0 && <span aria-hidden="true">·</span>}
                    <button
                      type="button"
                      onClick={() => executeSearch(sample, platform)}
                      className="text-slate-300 hover:text-sky-300 hover:underline transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {sample}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            </section>

            {/* Error State */}
            {searchError && (
              <div className="max-w-3xl mx-auto bg-red-950/50 border border-red-500/40 rounded-2xl p-6 flex items-start gap-3.5 text-red-200">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-base">Live Search Encountered an Error</h3>
                  <p className="text-sm text-red-300 mt-1">{searchError}</p>
                </div>
              </div>
            )}

            {/* Loading Skeleton State */}
            {isSearching && (
              <div
                aria-busy="true"
                aria-label="Querying live repositories"
                className="space-y-6 animate-pulse"
              >
                <div className="bg-[#0F172A]/75 border border-slate-800/80 rounded-2xl p-8 space-y-6">
                  <div className="flex items-center gap-5">
                    <div className="w-20 h-20 rounded-2xl bg-slate-800/90 shrink-0" />
                    <div className="space-y-3 flex-1">
                      <div className="h-4 w-48 bg-slate-800 rounded" />
                      <div className="h-8 w-72 bg-slate-800 rounded" />
                      <div className="h-4 w-96 max-w-full bg-slate-800/70 rounded" />
                    </div>
                  </div>
                  <div className="h-20 bg-slate-800/50 rounded-xl" />
                  <div className="space-y-3 pt-4 border-t border-slate-800/80">
                    <div className="h-12 bg-slate-800/60 rounded-xl" />
                    <div className="h-12 bg-slate-800/60 rounded-xl" />
                  </div>
                </div>
              </div>
            )}

            {/* Populated Search Result View */}
            {!isSearching && searchResult && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-400">
                    Live Search Results for &ldquo;{searchResult.query}&rdquo;
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchResult(null);
                      setSearchQuery('');
                    }}
                    className="text-xs font-medium text-sky-400 hover:text-sky-300 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Clear Search Results</span>
                  </button>
                </div>

                <SearchResultView
                  data={searchResult}
                  savedApps={savedApps}
                  onToggleSave={handleToggleSave}
                  bulkInstallItems={bulkInstallItems}
                  onToggleBulkInstall={handleToggleBulkInstall}
                  onQuickSearch={(q, plat) => executeSearch(q, plat)}
                />
              </div>
            )}

            {/* Phase 2: Dynamic Homepage Categorised Carousels (15 items per category) */}
            <HomepageCarousels
              activePlatform={carouselPlatform}
              onPlatformChange={(nextPlat) => {
                setCarouselPlatform(nextPlat);
                setPlatform(nextPlat);
              }}
              wishlistItems={savedApps}
              onToggleWishlist={handleToggleSave}
              bulkInstallItems={bulkInstallItems}
              onToggleBulkInstall={handleToggleBulkInstall}
              onInspectApp={(appName, targetPlat) => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
                executeSearch(appName, targetPlat);
              }}
            />
          </div>
        )}

        {/* ================================================================ */}
        {/* VIEW 2: WISHLIST / قائمة الأمنيات (IndexedDB + Firestore Sync)    */}
        {/* ================================================================ */}
        {activeSection === 'library' && (
          <WishlistView
            savedApps={savedApps}
            userEmail={user?.email || null}
            isSyncingCloud={isSyncingCloud}
            onSyncLocalToCloud={handleSyncLocalToCloud}
            onPromptSignIn={handleAuthAction}
            onRemoveItem={(item) =>
              handleToggleSave({
                appKey: item.appKey,
                platform: item.platform,
                name: item.name,
                developer: item.developer,
                iconUrl: item.iconUrl,
                primaryUrl: item.primaryUrl,
                secondaryUrl: item.secondaryUrl,
                category: item.category,
                license: item.license,
                version: item.version,
              })
            }
            onSaveNotes={handleSaveNotes}
            onAddCustomItem={handleAddCustomWishlistItem}
            onLiveRescan={(name, plat) => executeSearch(name, plat)}
            onExploreDiscover={() => setActiveSection('discover')}
          />
        )}

        {/* ================================================================ */}
        {/* VIEW 3: SEARCH HISTORY (IndexedDB + Firestore Log)               */}
        {/* ================================================================ */}
        {activeSection === 'history' && (
          <div className="space-y-8">
            <div className="border-b border-slate-800/80 pb-6">
              <h1 className="text-3xl font-display font-bold text-slate-50">
                Live Search History
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Recent cross-platform queries stored in IndexedDB and synced with your Firestore
                account.
              </p>
            </div>

            {searchHistory.length === 0 ? (
              <div className="bg-[#0F172A]/75 backdrop-blur-xl border border-slate-800/90 rounded-2xl p-12 text-center max-w-2xl mx-auto space-y-4">
                <History className="w-10 h-10 text-sky-400 mx-auto" />
                <h2 className="text-xl font-display font-semibold text-slate-100">
                  No recent search history
                </h2>
                <p className="text-sm text-slate-400">
                  Your live software queries across PC, Android, and iOS will appear here.
                </p>
              </div>
            ) : (
              <div className="bg-[#0F172A]/75 backdrop-blur-xl border border-slate-800/90 rounded-2xl divide-y divide-slate-800/80">
                {searchHistory.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 sm:px-6 flex items-center justify-between gap-4 hover:bg-slate-800/30 transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <AppIcon
                        src={item.topResultIcon}
                        name={item.topResultName || item.query}
                        platform={item.platform}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100 text-base truncate">
                          {item.query}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                          <span className="text-sky-300 uppercase font-medium">
                            {item.platform}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>Top match: {item.topResultName || item.query}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {item.resultCount} results
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {new Date(item.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => executeSearch(item.query, item.platform)}
                        className="px-3.5 py-2 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-sky-200 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>Run Again</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteHistoryItem(item)}
                        aria-label={`Delete search ${item.query}`}
                        className="p-2 text-slate-400 hover:text-red-400 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================================================================ */}
        {/* VIEW 4: SOURCES & VERIFICATION ARCHITECTURE                      */}
        {/* ================================================================ */}
        {activeSection === 'sources' && (
          <div className="space-y-8 max-w-4xl mx-auto">
            <div className="border-b border-slate-800/80 pb-6">
              <h1 className="text-3xl font-display font-bold text-slate-50">
                Live Verification & Upstream Sources
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Every query executes live server-side lookups against official package managers,
                verified app stores, and open-source repositories.
              </p>
            </div>

            <div className="bg-[#0F172A]/80 backdrop-blur-xl border border-slate-800/90 rounded-2xl divide-y divide-slate-800/80">
              <div className="p-6 space-y-2">
                <div className="flex items-center gap-2.5 text-sky-400 font-display font-bold text-lg">
                  <Monitor className="w-5 h-5" />
                  <h2>01. PC (Windows) Discovery Pipeline</h2>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Resolves the canonical vendor website, official Windows installer binaries (
                  <code className="font-mono text-sky-300">.exe</code> /{' '}
                  <code className="font-mono text-sky-300">.msi</code>) from GitHub Releases and
                  vendor portals, Microsoft Winget CLI package identifiers (
                  <code className="font-mono text-sky-300">winget install</code>), and curates
                  highly rated Open-Source (FOSS) and freeware alternatives via live Google Search
                  grounding and Flathub/GitHub metadata.
                </p>
              </div>

              <div className="p-6 space-y-2">
                <div className="flex items-center gap-2.5 text-sky-400 font-display font-bold text-lg">
                  <Smartphone className="w-5 h-5" />
                  <h2>02. Android Dual-Track Pipeline</h2>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Simultaneously scrapes live <code className="font-mono text-sky-300">SoftwareApplication</code>{' '}
                  structured data from the official Google Play Store and queries the official
                  F-Droid API (<code className="font-mono text-sky-300">search.f-droid.org</code>{' '}
                  and <code className="font-mono text-sky-300">f-droid.org/api/v1/packages</code>)
                  for direct signed reproducible <code className="font-mono text-sky-300">.apk</code>{' '}
                  downloads and APKMirror signature-verified release lookups.
                </p>
              </div>

              <div className="p-6 space-y-2">
                <div className="flex items-center gap-2.5 text-sky-400 font-display font-bold text-lg">
                  <Apple className="w-5 h-5" />
                  <h2>03. iOS (iPhone) Strict Official App Store Pipeline</h2>
                </div>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Enforces strict domain validation so that 100% of iOS links, icons, screenshots,
                  version numbers, and bundle IDs come exclusively from the official Apple iTunes
                  Search API (<code className="font-mono text-sky-300">itunes.apple.com</code> /{' '}
                  <code className="font-mono text-sky-300">apps.apple.com</code>). External websites
                  and unofficial sideloading sources are never returned for iOS queries.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Application Footer with Glowing Developer Signature */}
      <footer
        className={`relative z-10 border-t border-slate-800/80 bg-[#070B14]/90 backdrop-blur-xl py-8 px-6 text-xs text-slate-400 ${
          bulkInstallItems.length > 0 ? 'pb-32' : ''
        }`}
      >
        <div className="max-w-7xl mx-auto flex flex-col items-center justify-between gap-5">
          <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-4">
            <span>Vanguard Index · Cross-Platform Software & FOSS Discovery Engine</span>
            <div className="flex items-center gap-4">
              <a
                href="#discover"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection('discover');
                }}
                className="hover:text-slate-200 transition-colors"
              >
                Discover
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="#library"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection('library');
                }}
                className="hover:text-slate-200 transition-colors"
              >
                Wishlist · قائمة الأمنيات
              </a>
              <span aria-hidden="true">·</span>
              <a
                href="#sources"
                onClick={(e) => {
                  e.preventDefault();
                  setActiveSection('sources');
                }}
                className="hover:text-slate-200 transition-colors"
              >
                Upstream Sources
              </a>
            </div>
          </div>

          {/* Glowing Developer Signature */}
          <div className="pt-4 border-t border-slate-800/60 w-full flex justify-center">
            <p
              dir="rtl"
              className="text-base sm:text-lg font-display font-bold tracking-wide text-sky-300 drop-shadow-[0_0_14px_rgba(56,189,248,0.85)] px-5 py-2 rounded-xl bg-sky-500/10 border border-sky-400/40 shadow-[0_0_25px_-4px_rgba(56,189,248,0.45)]"
            >
              مع تحيات المطور Amir Lamay
            </p>
          </div>
        </div>
      </footer>

      {/* Phase 4: Auto-Installer Engine (التسطيب الأوتوماتيكي) */}
      <AutoInstallerEngine
        items={bulkInstallItems}
        onRemoveItem={handleRemoveBulkItem}
        onClearPlatform={handleClearBulkPlatform}
        onUpdateItemMeta={handleUpdateBulkItemMeta}
      />
    </div>
  );
}
