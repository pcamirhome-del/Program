import React, { useState, useEffect } from 'react';
import {
  Heart,
  Search,
  Download,
  ExternalLink,
  Trash2,
  Edit3,
  Check,
  X,
  Copy,
  RefreshCw,
  Cloud,
  HardDrive,
  Plus,
  Globe,
  FileDown,
} from 'lucide-react';
import type { PlatformType, SavedSoftwareRecord } from '../types.ts';
import { AppIcon } from './AppIcon.tsx';
import { sanitizeId } from '../lib/firebase.ts';

interface WishlistViewProps {
  savedApps: SavedSoftwareRecord[];
  userEmail?: string | null;
  isSyncingCloud: boolean;
  onSyncLocalToCloud: () => void;
  onPromptSignIn: () => void;
  onRemoveItem: (item: SavedSoftwareRecord) => void;
  onSaveNotes: (item: SavedSoftwareRecord, newNotes: string) => Promise<void>;
  onAddCustomItem: (item: {
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
  }) => Promise<void>;
  onLiveRescan: (name: string, platform: PlatformType) => void;
  onExploreDiscover: () => void;
}

export const WishlistView: React.FC<WishlistViewProps> = ({
  savedApps,
  userEmail,
  isSyncingCloud,
  onSyncLocalToCloud,
  onPromptSignIn,
  onRemoveItem,
  onSaveNotes,
  onAddCustomItem,
  onLiveRescan,
  onExploreDiscover,
}) => {
  const [platformFilter, setPlatformFilter] = useState<'all' | PlatformType>('all');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'newest' | 'name' | 'platform'>('newest');
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // Inline note editing state
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Add custom link form state
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [customName, setCustomName] = useState<string>('');
  const [customDeveloper, setCustomDeveloper] = useState<string>('');
  const [customPlatform, setCustomPlatform] = useState<PlatformType>('pc');
  const [customUrl, setCustomUrl] = useState<string>('');
  const [customNotes, setCustomNotes] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleCopyLink = async (url: string, key: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(key);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleExportJson = () => {
    const dataStr = JSON.stringify(savedApps, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vanguard-wishlist-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const nameTrimmed = customName.trim();
    const urlTrimmed = customUrl.trim();
    if (!nameTrimmed || !urlTrimmed) {
      setFormError('Please provide both the software name and a valid download or store URL.');
      return;
    }

    let formattedUrl = urlTrimmed;
    if (!/^https?:\/\//i.test(formattedUrl)) {
      formattedUrl = `https://${formattedUrl}`;
    }

    let iconUrl = '';
    try {
      const host = new URL(formattedUrl).hostname;
      iconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
    } catch {
      setFormError('Please enter a valid URL (e.g. https://videolan.org/vlc/).');
      return;
    }

    const appKey = sanitizeId(`${customPlatform}-custom-${nameTrimmed.toLowerCase()}`, 120);
    await onAddCustomItem({
      appKey,
      platform: customPlatform,
      name: nameTrimmed,
      developer: customDeveloper.trim() || 'Official Publisher',
      iconUrl,
      primaryUrl: formattedUrl,
      secondaryUrl: formattedUrl,
      category: 'Saved Link',
      license: 'Direct Link',
      version: 'Latest',
      notes: customNotes.trim(),
    });

    setCustomName('');
    setCustomDeveloper('');
    setCustomUrl('');
    setCustomNotes('');
    setShowAddForm(false);
  };

  const filteredItems = savedApps
    .filter((item) => {
      if (platformFilter !== 'all' && item.platform !== platformFilter) return false;
      if (!searchFilter.trim()) return true;
      const q = searchFilter.trim().toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.developer.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.notes.toLowerCase().includes(q) ||
        item.primaryUrl.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'platform') return a.platform.localeCompare(b.platform);
      return b.createdAt.localeCompare(a.createdAt);
    });

  const pcCount = savedApps.filter((i) => i.platform === 'pc').length;
  const androidCount = savedApps.filter((i) => i.platform === 'android').length;
  const iosCount = savedApps.filter((i) => i.platform === 'ios').length;

  return (
    <div className="space-y-8">
      {/* Wishlist Header & Persistence Status */}
      <div className="bg-[#0F172A]/80 backdrop-blur-xl border border-slate-800/90 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-3">
              <Heart className="w-7 h-7 text-rose-400 fill-rose-400" />
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-slate-50 tracking-tight">
                Wishlist · قائمة الأمنيات
              </h1>
            </div>
            {/* Zero-Pill Metadata Discipline: Clean unboxed inline text with · separators */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-300 mt-2">
              <span className="inline-flex items-center gap-1.5 text-sky-300 font-medium">
                <HardDrive className="w-4 h-4" />
                <span>IndexedDB Offline Storage ({savedApps.length} saved)</span>
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>{isOnline ? 'Network Online' : 'Offline PWA Mode Active'}</span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Cloud className="w-4 h-4 text-sky-400" />
                <span>
                  {userEmail
                    ? `Synced with Firebase (${userEmail})`
                    : 'Local Mode (Sign in to sync with Firebase)'}
                </span>
              </span>
            </div>
          </div>

          {/* Primary Management Actions */}
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="px-4 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Custom Link</span>
            </button>

            {userEmail ? (
              <button
                type="button"
                onClick={onSyncLocalToCloud}
                disabled={isSyncingCloud}
                className="px-4 py-2.5 bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-100 font-medium text-sm rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className={`w-4 h-4 text-sky-400 ${isSyncingCloud ? 'animate-spin' : ''}`} />
                <span>{isSyncingCloud ? 'Syncing...' : 'Sync Firebase'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onPromptSignIn}
                className="px-4 py-2.5 bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-100 font-medium text-sm rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Cloud className="w-4 h-4 text-sky-400" />
                <span>Sign In to Sync Cloud</span>
              </button>
            )}

            {savedApps.length > 0 && (
              <button
                type="button"
                onClick={handleExportJson}
                className="px-4 py-2.5 bg-slate-900/90 hover:bg-slate-800 border border-slate-800 text-slate-300 font-medium text-sm rounded-xl inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileDown className="w-4 h-4 text-slate-400" />
                <span>Export JSON</span>
              </button>
            )}
          </div>
        </div>

        {/* Add Custom Link Form */}
        {showAddForm && (
          <form
            onSubmit={handleCustomSubmit}
            className="pt-6 border-t border-slate-800/80 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-display font-semibold text-slate-100">
                Save Custom Software or Download Link to Wishlist
              </h2>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="text-slate-400 hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <p className="text-sm text-rose-300">{formError}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Software Name (e.g. VLC Media Player)"
                maxLength={140}
                className="bg-slate-900/90 border border-slate-700/80 focus:border-sky-400 rounded-xl px-3.5 py-2.5 text-base text-slate-100 focus:outline-none"
              />
              <input
                type="text"
                value={customDeveloper}
                onChange={(e) => setCustomDeveloper(e.target.value)}
                placeholder="Publisher / Developer"
                maxLength={140}
                className="bg-slate-900/90 border border-slate-700/80 focus:border-sky-400 rounded-xl px-3.5 py-2.5 text-base text-slate-100 focus:outline-none"
              />
              <select
                value={customPlatform}
                onChange={(e) => setCustomPlatform(e.target.value as PlatformType)}
                className="bg-slate-900/90 border border-slate-700/80 focus:border-sky-400 rounded-xl px-3.5 py-2.5 text-base text-slate-100 focus:outline-none cursor-pointer"
              >
                <option value="pc">PC (Windows)</option>
                <option value="android">Android</option>
                <option value="ios">iPhone (iOS)</option>
              </select>
              <input
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="Official Download / Store URL (https://...)"
                maxLength={900}
                className="bg-slate-900/90 border border-slate-700/80 focus:border-sky-400 rounded-xl px-3.5 py-2.5 text-base text-slate-100 focus:outline-none"
              />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <input
                type="text"
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                placeholder="Optional note or reminder (e.g. Install on new workstation)..."
                maxLength={500}
                className="flex-1 bg-slate-900/90 border border-slate-700/80 focus:border-sky-400 rounded-xl px-3.5 py-2.5 text-base text-slate-100 focus:outline-none"
              />
              <button
                type="submit"
                className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-base rounded-xl whitespace-nowrap shrink-0 cursor-pointer"
              >
                Save to Wishlist
              </button>
            </div>
          </form>
        )}

        {/* Filter, Search & Sort Controls */}
        <div className="pt-5 border-t border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Platform Filter Tabs */}
          <div className="inline-flex flex-wrap items-center gap-1.5 p-1 bg-[#0B1120] border border-slate-800 rounded-xl self-start">
            <button
              type="button"
              onClick={() => setPlatformFilter('all')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                platformFilter === 'all'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              All ({savedApps.length})
            </button>
            <button
              type="button"
              onClick={() => setPlatformFilter('pc')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                platformFilter === 'pc'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              PC ({pcCount})
            </button>
            <button
              type="button"
              onClick={() => setPlatformFilter('android')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                platformFilter === 'android'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Android ({androidCount})
            </button>
            <button
              type="button"
              onClick={() => setPlatformFilter('ios')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                platformFilter === 'ios'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              iPhone ({iosCount})
            </button>
          </div>

          {/* Search Within Wishlist & Sort Selector */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1 max-w-xl">
            <div className="relative flex-1 flex items-center bg-[#0B1120] border border-slate-800 focus-within:border-sky-400/60 rounded-xl">
              <Search className="w-4 h-4 text-slate-400 ml-3.5 shrink-0" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter saved apps, notes, or links..."
                className="w-full bg-transparent text-slate-100 placeholder-slate-500 text-base px-3 py-2 focus:outline-none"
              />
              {searchFilter && (
                <button
                  type="button"
                  onClick={() => setSearchFilter('')}
                  className="p-2 text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'newest' | 'name' | 'platform')}
              aria-label="Sort Wishlist items"
              className="bg-[#0B1120] border border-slate-800 text-slate-200 text-base rounded-xl px-3.5 py-2 focus:outline-none cursor-pointer shrink-0"
            >
              <option value="newest">Sort: Recently Saved</option>
              <option value="name">Sort: Name (A–Z)</option>
              <option value="platform">Sort: Platform</option>
            </select>
          </div>
        </div>
      </div>

      {/* Wishlist Saved Items List / Empty State */}
      {filteredItems.length === 0 ? (
        <div className="bg-[#0F172A]/75 backdrop-blur-xl border border-slate-800/90 rounded-2xl p-12 text-center max-w-2xl mx-auto space-y-4">
          <Heart className="w-11 h-11 text-rose-400 mx-auto" />
          <h2 className="text-xl font-display font-semibold text-slate-100">
            {savedApps.length === 0
              ? 'Your Wishlist (قائمة الأمنيات) is empty'
              : 'No saved items match your current filter'}
          </h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            {savedApps.length === 0
              ? 'Click the heart icon on any homepage carousel card or search result across PC, Android, or iPhone to save links for offline access and cloud sync.'
              : 'Try clearing the filter above or switching the selected operating system tab.'}
          </p>
          <button
            type="button"
            onClick={onExploreDiscover}
            className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm rounded-xl transition-colors inline-flex items-center gap-2 cursor-pointer"
          >
            <Search className="w-4 h-4" />
            <span>Browse Carousels & Search</span>
          </button>
        </div>
      ) : (
        <div className="bg-[#0F172A]/75 backdrop-blur-xl border border-slate-800/90 rounded-2xl divide-y divide-slate-800/80">
          {filteredItems.map((item) => {
            const isEditing = editingKey === item.appKey;
            const hasDistinctSecondary =
              Boolean(item.secondaryUrl) && item.secondaryUrl !== item.primaryUrl;

            return (
              <article
                key={item.appKey}
                className="p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6 hover:bg-slate-800/20 transition-colors"
              >
                <div className="flex items-start gap-4 min-w-0 flex-1">
                  <AppIcon
                    src={item.iconUrl}
                    name={item.name}
                    platform={item.platform}
                    size="lg"
                  />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-lg font-display font-bold text-slate-100 truncate">
                        {item.name}
                      </h3>
                    </div>

                    {/* Zero-Pill Metadata Discipline: Unboxed inline text */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                      <span className="text-sky-300 font-semibold uppercase">
                        {item.platform === 'ios' ? 'iPhone (iOS)' : item.platform}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{item.developer}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.category}</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.license}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">{item.version}</span>
                    </div>

                    {/* Saved URL Display + Copy Link Button */}
                    <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
                      <a
                        href={item.primaryUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 hover:underline truncate max-w-md"
                      >
                        {item.primaryUrl}
                      </a>
                      <button
                        type="button"
                        onClick={() => handleCopyLink(item.primaryUrl, item.appKey)}
                        className="text-slate-300 hover:text-sky-300 inline-flex items-center gap-1 cursor-pointer"
                        title="Copy saved link"
                      >
                        {copiedId === item.appKey ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy URL</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Personal Notes Editor */}
                    {isEditing ? (
                      <div className="pt-2 flex items-center gap-2 max-w-xl">
                        <input
                          type="text"
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Add personal note, license key reminder, or tag..."
                          maxLength={500}
                          className="flex-1 bg-slate-900 border border-sky-400/50 rounded-lg px-3 py-1.5 text-base text-slate-100 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={async () => {
                            await onSaveNotes(item, noteDraft);
                            setEditingKey(null);
                          }}
                          className="p-2 bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 cursor-pointer"
                          title="Save note"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingKey(null)}
                          className="p-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700 cursor-pointer"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="pt-1 flex items-center gap-2 text-xs text-slate-300">
                        <span className="italic text-slate-400">
                          {item.notes ? `Note: "${item.notes}"` : 'No personal note'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingKey(item.appKey);
                            setNoteDraft(item.notes || '');
                          }}
                          className="text-sky-400 hover:text-sky-300 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>{item.notes ? 'Edit Note' : 'Add Note'}</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Visit, Re-Scan & Remove Saved Link Controls */}
                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => onLiveRescan(item.name, item.platform)}
                    className="px-3.5 py-2.5 bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>Inspect Live</span>
                  </button>

                  {hasDistinctSecondary && item.platform !== 'ios' && (
                    <a
                      href={item.secondaryUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-2.5 bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Globe className="w-3.5 h-3.5 text-sky-400" />
                      <span>Official Site</span>
                    </a>
                  )}

                  <a
                    href={item.primaryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Visit Download Link</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  <button
                    type="button"
                    onClick={() => onRemoveItem(item)}
                    aria-label={`Remove ${item.name} from Wishlist`}
                    title="Remove from Wishlist (قائمة الأمنيات)"
                    className="px-3 py-2.5 text-rose-300 hover:text-white bg-rose-950/35 hover:bg-rose-600/80 border border-rose-500/30 rounded-xl text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
