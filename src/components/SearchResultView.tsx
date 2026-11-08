import React, { useState } from 'react';
import {
  ExternalLink,
  Download,
  Heart,
  Copy,
  Check,
  Terminal,
  ShieldCheck,
  Globe,
  GitBranch,
  Search,
  CheckSquare,
  Square,
  Sparkles,
} from 'lucide-react';
import type {
  AlternativeSoftware,
  BulkInstallItem,
  LiveSearchResponse,
  PlatformType,
  PrimarySoftwareResult,
  SavedSoftwareRecord,
} from '../types.ts';
import { AppIcon } from './AppIcon.tsx';
import { sanitizeId } from '../lib/firebase.ts';

interface SearchResultViewProps {
  data: LiveSearchResponse;
  savedApps: SavedSoftwareRecord[];
  onToggleSave: (item: {
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
  }) => void;
  bulkInstallItems: BulkInstallItem[];
  onToggleBulkInstall: (item: Omit<BulkInstallItem, 'addedAt'>) => void;
  onQuickSearch: (query: string, platform: PlatformType) => void;
}

export const SearchResultView: React.FC<SearchResultViewProps> = ({
  data,
  savedApps,
  onToggleSave,
  bulkInstallItems,
  onToggleBulkInstall,
  onQuickSearch,
}) => {
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [activePrimary, setActivePrimary] = useState<PrimarySoftwareResult | null>(
    data.primaryResult
  );

  // Sync when new search data arrives
  React.useEffect(() => {
    setActivePrimary(data.primaryResult);
  }, [data]);

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(label);
      setTimeout(() => setCopiedText(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  if (!activePrimary) {
    return (
      <div className="bg-[#0F172A]/75 backdrop-blur-xl border border-slate-800/90 rounded-2xl p-10 text-center max-w-3xl mx-auto">
        <h2 className="text-xl font-display font-semibold text-slate-100">
          No verified packages matched &ldquo;{data.query}&rdquo;
        </h2>
        <p className="text-slate-400 text-base mt-2 max-w-xl mx-auto">
          Try searching with the canonical application title, publisher name, or switching the
          target operating system above.
        </p>
      </div>
    );
  }

  const supportsBulkInstall = data.platform === 'pc' || data.platform === 'android';
  const bulkPlatform: 'pc' | 'android' = data.platform === 'android' ? 'android' : 'pc';

  const primaryAppKey = sanitizeId(
    `${activePrimary.platform}-${activePrimary.packageId || activePrimary.name}`
  );
  const isPrimarySaved = savedApps.some((s) => s.appKey === primaryAppKey);
  const isPrimaryBulkSelected = bulkInstallItems.some((b) => b.appKey === primaryAppKey);

  // Resolve direct APK from mirrors if available on Android primary result
  const primaryDirectApkMirror = activePrimary.mirrorsAndSources.find(
    (m) => m.type === 'fdroid_apk' || m.url.toLowerCase().endsWith('.apk')
  );
  const resolvedWingetIdFromCmd = activePrimary.wingetCommand
    ? activePrimary.wingetCommand.replace(/^winget\s+install\s+--id\s+/i, '').split(/\s+/)[0]
    : activePrimary.packageId;

  const platformLabel =
    data.platform === 'pc'
      ? 'Windows PC Ecosystem'
      : data.platform === 'android'
      ? 'Android Ecosystem (Google Play & F-Droid)'
      : 'Apple iOS App Store (Strictly Official)';

  return (
    <div className="space-y-12">
      {/* iOS Strict Mode Integrity Banner or Platform Verification Notice */}
      {data.strictModeNotice && (
        <div className="bg-[#0F172A]/80 backdrop-blur-xl border border-sky-500/30 rounded-xl px-5 py-3.5 flex items-center gap-3 text-sm text-slate-200">
          <ShieldCheck className="w-5 h-5 text-sky-400 shrink-0" />
          <span>{data.strictModeNotice}</span>
        </div>
      )}

      {data.quotaAdvisory && (
        <div className="bg-[#0F172A]/80 backdrop-blur-xl border border-amber-500/30 rounded-xl px-5 py-3.5 flex items-center gap-3 text-sm text-amber-200">
          <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0" />
          <span>{data.quotaAdvisory}</span>
        </div>
      )}

      {/* Phase 4: Bulk Auto-Installer Banner for PC & Android Search Results */}
      {supportsBulkInstall && (
        <div className="bg-[#0F172A]/85 backdrop-blur-xl border border-sky-400/30 rounded-xl px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-sm text-slate-200">
            <Sparkles className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              <strong>Auto-Installer Engine (التسطيب الأوتوماتيكي):</strong>{' '}
              {data.platform === 'pc'
                ? 'Check any PC software below to bundle into an automated silent .bat / .ps1 installer script (Winget or Chocolatey).'
                : 'Check any Android app below to add it to your sequential local APK bulk download queue.'}
            </span>
          </div>
          <span className="text-xs font-mono text-sky-300 shrink-0">
            {bulkInstallItems.filter((i) => i.platform === bulkPlatform).length} queued for{' '}
            {bulkPlatform.toUpperCase()}
          </span>
        </div>
      )}

      {/* Primary Matched Software Panel */}
      <section
        aria-label="Primary matched software"
        className={`bg-[#0F172A]/80 backdrop-blur-xl border rounded-2xl p-6 sm:p-8 shadow-2xl transition-colors ${
          isPrimaryBulkSelected ? 'border-sky-400/70' : 'border-sky-400/25'
        }`}
      >
        {/* Top Bulk Install Checkbox Row (PC & Android Only) */}
        {supportsBulkInstall && (
          <div className="mb-5 pb-4 border-b border-slate-800/80 flex items-center justify-between gap-4">
            <label className="inline-flex items-center gap-3 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={isPrimaryBulkSelected}
                onChange={() =>
                  onToggleBulkInstall({
                    id: activePrimary.id,
                    appKey: primaryAppKey,
                    platform: bulkPlatform,
                    name: activePrimary.name,
                    developer: activePrimary.developer,
                    iconUrl: activePrimary.iconUrl,
                    packageId: activePrimary.packageId || activePrimary.name,
                    version: activePrimary.version,
                    license: activePrimary.license,
                    primaryDownloadUrl: activePrimary.primaryDownloadUrl,
                    directApkUrl: primaryDirectApkMirror?.url,
                    wingetId: data.platform === 'pc' ? resolvedWingetIdFromCmd : undefined,
                  })
                }
                className="sr-only"
              />
              {isPrimaryBulkSelected ? (
                <CheckSquare className="w-5 h-5 text-sky-400 shrink-0" />
              ) : (
                <Square className="w-5 h-5 text-slate-400 group-hover:text-sky-300 shrink-0 transition-colors" />
              )}
              <span
                className={`text-sm font-semibold transition-colors ${
                  isPrimaryBulkSelected
                    ? 'text-sky-300'
                    : 'text-slate-300 group-hover:text-slate-100'
                }`}
              >
                {isPrimaryBulkSelected
                  ? 'Selected for Bulk Install · محدد للتسطيب الأوتوماتيكي'
                  : 'Select for Bulk Install · تحديد للتسطيب الأوتوماتيكي'}
              </span>
            </label>

            <span className="text-xs font-mono text-slate-400 hidden sm:inline">
              {data.platform === 'pc'
                ? `Winget / Choco ID: ${resolvedWingetIdFromCmd}`
                : primaryDirectApkMirror
                ? 'Verified Direct .APK Available'
                : `Package: ${activePrimary.packageId}`}
            </span>
          </div>
        )}

        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          <div className="flex items-start gap-5 min-w-0">
            <AppIcon
              src={activePrimary.iconUrl}
              name={activePrimary.name}
              platform={activePrimary.platform}
              size="xl"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-sky-400 font-medium tracking-wide">
                {platformLabel} · Primary Match
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-bold text-slate-50 tracking-tight mt-1 break-words">
                {activePrimary.name}
              </h2>

              {/* Zero-Pill Metadata Discipline: Clean unboxed inline text with · separators */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-300 mt-2">
                <span className="font-medium text-slate-200">{activePrimary.developer}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>{activePrimary.category}</span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span className="font-mono tabular-nums text-slate-300">
                  v{activePrimary.version.replace(/^v/i, '')}
                </span>
                <span aria-hidden="true" className="text-slate-600">·</span>
                <span>{activePrimary.license}</span>
                {activePrimary.rating !== undefined && (
                  <>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono tabular-nums text-sky-300 font-medium">
                      {activePrimary.rating.toFixed(1)} ★
                      {activePrimary.ratingCount
                        ? ` (${activePrimary.ratingCount.toLocaleString()} reviews)`
                        : ''}
                    </span>
                  </>
                )}
                {activePrimary.fileSize && (
                  <>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono tabular-nums">{activePrimary.fileSize}</span>
                  </>
                )}
              </div>

              <div className="mt-2 text-xs font-mono text-slate-400 flex items-center gap-2">
                <span>Package ID: {activePrimary.packageId}</span>
                <button
                  type="button"
                  onClick={() => handleCopy(activePrimary.packageId, 'pkg-id')}
                  className="text-sky-400 hover:text-sky-300 inline-flex items-center gap-1 cursor-pointer"
                  title="Copy Package Identifier"
                >
                  {copiedText === 'pkg-id' ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy ID</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 shrink-0">
            <a
              href={activePrimary.primaryDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-5 py-3 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-base rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>{activePrimary.primaryDownloadLabel}</span>
            </a>

            {activePrimary.officialWebsiteUrl &&
              activePrimary.officialWebsiteUrl !== activePrimary.primaryDownloadUrl &&
              data.platform !== 'ios' && (
                <a
                  href={activePrimary.officialWebsiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-3 bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 text-slate-100 font-medium text-base rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <Globe className="w-4 h-4 text-sky-400" />
                  <span>Official Site</span>
                </a>
              )}

            <button
              type="button"
              onClick={() =>
                onToggleSave({
                  appKey: primaryAppKey,
                  platform: activePrimary.platform,
                  name: activePrimary.name,
                  developer: activePrimary.developer,
                  iconUrl: activePrimary.iconUrl,
                  primaryUrl: activePrimary.primaryDownloadUrl,
                  secondaryUrl:
                    activePrimary.officialWebsiteUrl || activePrimary.primaryDownloadUrl,
                  category: activePrimary.category,
                  license: activePrimary.license,
                  version: activePrimary.version,
                })
              }
              title={
                isPrimarySaved
                  ? 'Remove from Wishlist (قائمة الأمنيات)'
                  : 'Save to Wishlist (قائمة الأمنيات)'
              }
              className={`px-4 py-3 border font-medium text-base rounded-xl transition-colors inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer ${
                isPrimarySaved
                  ? 'bg-rose-500/20 border-rose-400/60 text-rose-200'
                  : 'bg-slate-900/80 border-slate-700/80 text-slate-200 hover:border-rose-400/45 hover:text-rose-200'
              }`}
            >
              <Heart
                className={`w-4 h-4 ${isPrimarySaved ? 'fill-rose-400 text-rose-400' : ''}`}
              />
              <span>{isPrimarySaved ? 'Saved in Wishlist' : 'Save to Wishlist'}</span>
            </button>
          </div>
        </div>

        {/* Software Description */}
        <p className="mt-6 text-slate-300 text-base leading-relaxed max-w-4xl whitespace-pre-line">
          {activePrimary.description.length > 650
            ? `${activePrimary.description.slice(0, 650)}...`
            : activePrimary.description}
        </p>

        {/* Winget CLI Command Bar (PC Only) */}
        {activePrimary.wingetCommand && data.platform === 'pc' && (
          <div className="mt-6 pt-6 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <Terminal className="w-5 h-5 text-sky-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-slate-400">
                  Windows Package Manager (Winget) Direct Install Command
                </div>
                <code className="text-sm sm:text-base font-mono text-sky-300 block truncate mt-0.5">
                  {activePrimary.wingetCommand}
                </code>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(activePrimary.wingetCommand!, 'winget')}
              className="px-4 py-2 bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-200 text-sm font-medium rounded-lg inline-flex items-center gap-2 self-start sm:self-auto whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedText === 'winget' ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Copied Command</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Command</span>
                </>
              )}
            </button>
          </div>
        )}

        {/* Official Links, Direct Installers & Verified Repository Mirrors */}
        <div className="mt-8 pt-6 border-t border-slate-800/80">
          <h3 className="text-lg font-display font-semibold text-slate-100">
            {data.platform === 'pc'
              ? 'Official Website, Direct Installers & Package Manifests'
              : data.platform === 'android'
              ? 'Official Google Play Store, F-Droid & Authorized APK Mirrors'
              : 'Verified Official Apple App Store Links'}
          </h3>

          <div className="mt-4 divide-y divide-slate-800/70">
            {activePrimary.mirrorsAndSources.map((mirror, idx) => (
              <div
                key={`${mirror.name}-${idx}`}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-100 text-base">{mirror.name}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                    <span>Source: {mirror.verifiedSource}</span>
                    {mirror.version && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{mirror.version}</span>
                      </>
                    )}
                    {mirror.architecture && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{mirror.architecture}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {mirror.cliCommand && (
                    <button
                      type="button"
                      onClick={() => handleCopy(mirror.cliCommand!, `mirror-cli-${idx}`)}
                      className="px-3.5 py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-mono rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedText === `mirror-cli-${idx}` ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>{mirror.cliCommand}</span>
                        </>
                      )}
                    </button>
                  )}
                  <a
                    href={mirror.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-200 text-sm font-medium rounded-lg inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0"
                  >
                    <span>{mirror.label}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* App Screenshots Preview (iOS / Android when available) */}
        {activePrimary.screenshots && activePrimary.screenshots.length > 0 && (
          <div className="mt-8 pt-6 border-t border-slate-800/80">
            <h3 className="text-base font-display font-semibold text-slate-200 mb-4">
              Official Store Screenshots
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {activePrimary.screenshots.map((shotUrl, idx) => (
                <a
                  key={idx}
                  href={activePrimary.primaryDownloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 aspect-[9/16] max-h-72"
                >
                  <img
                    src={shotUrl}
                    alt={`${activePrimary.name} screenshot ${idx + 1}`}
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="w-full h-full object-cover hover:scale-[1.02] transition-transform duration-150"
                  />
                </a>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Open-Source (FOSS) & Freeware Alternatives / F-Droid Alternatives / Related Official App Store Titles */}
      {data.alternatives.length > 0 && (
        <section aria-label="Recommended alternatives">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-6">
            <div>
              <h2 className="text-2xl font-display font-bold text-slate-100">
                {data.platform === 'pc'
                  ? 'Open-Source (FOSS) & Trusted Freeware Alternatives'
                  : data.platform === 'android'
                  ? 'F-Droid Open-Source & Verified Android Alternatives'
                  : 'Related Official Apple App Store Titles'}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {data.platform === 'pc'
                  ? `Community-vetted open-source and freeware replacements for ${activePrimary.name} on Windows.`
                  : data.platform === 'android'
                  ? 'Audited open-source packages from F-Droid and verified Android repositories.'
                  : 'Fetched strictly from the official Apple App Store directory.'}
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {data.alternatives.length} verified recommendations
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {data.alternatives.map((alt: AlternativeSoftware) => {
              const altAppKey = sanitizeId(`${data.platform}-alt-${alt.packageId || alt.name}`);
              const isAltSaved = savedApps.some((s) => s.appKey === altAppKey);
              const isAltBulkSelected = bulkInstallItems.some((b) => b.appKey === altAppKey);

              return (
                <article
                  key={alt.id}
                  className={`bg-[#0F172A]/75 backdrop-blur-xl border rounded-2xl p-6 flex flex-col justify-between transition-colors ${
                    isAltBulkSelected
                      ? 'border-sky-400/75 bg-sky-950/15'
                      : 'border-slate-800/90 hover:border-sky-400/35'
                  }`}
                >
                  <div>
                    {/* Bulk Install Checkbox on Each Alternative Card (PC & Android) */}
                    {supportsBulkInstall && (
                      <div className="mb-3.5 pb-3 border-b border-slate-800/80 flex items-center justify-between">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none group">
                          <input
                            type="checkbox"
                            checked={isAltBulkSelected}
                            onChange={() =>
                              onToggleBulkInstall({
                                id: alt.id,
                                appKey: altAppKey,
                                platform: bulkPlatform,
                                name: alt.name,
                                developer: alt.developer,
                                iconUrl: alt.iconUrl,
                                packageId: alt.packageId || alt.name,
                                version: 'Latest',
                                license: alt.license,
                                primaryDownloadUrl: alt.downloadUrl || alt.officialUrl,
                                directApkUrl:
                                  bulkPlatform === 'android' &&
                                  (alt.downloadUrl || '').toLowerCase().endsWith('.apk')
                                    ? alt.downloadUrl
                                    : undefined,
                                wingetId:
                                  bulkPlatform === 'pc' &&
                                  alt.packageId &&
                                  alt.packageId.includes('.') &&
                                  !alt.packageId.includes('/')
                                    ? alt.packageId
                                    : undefined,
                              })
                            }
                            className="sr-only"
                          />
                          {isAltBulkSelected ? (
                            <CheckSquare className="w-4 h-4 text-sky-400 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 group-hover:text-sky-300 shrink-0 transition-colors" />
                          )}
                          <span
                            className={`text-xs font-semibold transition-colors ${
                              isAltBulkSelected
                                ? 'text-sky-300'
                                : 'text-slate-400 group-hover:text-slate-200'
                            }`}
                          >
                            {isAltBulkSelected
                              ? 'Selected for Bulk Install'
                              : 'Select for Bulk Install'}
                          </span>
                        </label>
                      </div>
                    )}

                    <div className="flex items-start gap-3.5">
                      <AppIcon
                        src={alt.iconUrl}
                        name={alt.name}
                        platform={data.platform}
                        size="md"
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-display font-bold text-slate-100 truncate">
                          {alt.name}
                        </h3>
                        {/* Zero-Pill Metadata Discipline: Unboxed inline text */}
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                          <span className="truncate">{alt.developer}</span>
                          <span aria-hidden="true">·</span>
                          <span className="text-sky-300 font-medium">{alt.license}</span>
                          {alt.rating && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">{alt.rating}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <p className="text-sm text-slate-300 mt-4 leading-relaxed">
                      {alt.summary}
                    </p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <a
                        href={alt.downloadUrl || alt.officialUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3.5 py-2 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-200 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                      >
                        <span>
                          {data.platform === 'ios'
                            ? 'App Store'
                            : alt.isOpenSource
                            ? 'Get FOSS Build'
                            : 'Official Link'}
                        </span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>

                      <button
                        type="button"
                        onClick={() => onQuickSearch(alt.name, data.platform)}
                        className="px-3 py-2 text-xs font-medium text-slate-300 hover:text-sky-300 inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Search className="w-3.5 h-3.5" />
                        <span>Inspect</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onToggleSave({
                          appKey: altAppKey,
                          platform: data.platform,
                          name: alt.name,
                          developer: alt.developer,
                          iconUrl: alt.iconUrl,
                          primaryUrl: alt.downloadUrl || alt.officialUrl,
                          secondaryUrl: alt.officialUrl,
                          category: alt.sourceName,
                          license: alt.license,
                          version: 'Latest',
                        })
                      }
                      aria-label={
                        isAltSaved
                          ? `Remove ${alt.name} from Wishlist`
                          : `Save ${alt.name} to Wishlist`
                      }
                      title={
                        isAltSaved
                          ? 'Saved in Wishlist (قائمة الأمنيات)'
                          : 'Save to Wishlist (قائمة الأمنيات)'
                      }
                      className={`px-3 py-2 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isAltSaved
                          ? 'text-rose-200 bg-rose-500/20 border-rose-400/50'
                          : 'text-slate-300 border-slate-800 hover:text-rose-200 hover:border-rose-400/40 hover:bg-slate-800/60'
                      }`}
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${
                          isAltSaved ? 'fill-rose-400 text-rose-400' : ''
                        }`}
                      />
                      <span>{isAltSaved ? 'Saved' : 'Save'}</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Additional Matching Store Results */}
      {data.secondaryResults.length > 0 && (
        <section aria-label="Additional store matches">
          <h2 className="text-xl font-display font-bold text-slate-100 mb-4">
            Additional {platformLabel} Matches
          </h2>
          <div className="bg-[#0F172A]/70 backdrop-blur-xl border border-slate-800/90 rounded-2xl divide-y divide-slate-800/80">
            {data.secondaryResults.map((item) => {
              const isSelected = activePrimary.id === item.id;
              const secAppKey = sanitizeId(`${item.platform}-${item.packageId || item.name}`);
              const isSecSaved = savedApps.some((s) => s.appKey === secAppKey);
              const isSecBulkSelected = bulkInstallItems.some((b) => b.appKey === secAppKey);
              const secDirectApkMirror = item.mirrorsAndSources.find(
                (m) => m.type === 'fdroid_apk' || m.url.toLowerCase().endsWith('.apk')
              );

              return (
                <div
                  key={item.id}
                  className={`p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                    isSecBulkSelected ? 'bg-sky-950/20' : 'hover:bg-slate-800/30'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {supportsBulkInstall && (
                      <label
                        className="inline-flex items-center cursor-pointer select-none shrink-0"
                        title="Select for Bulk Install"
                      >
                        <input
                          type="checkbox"
                          checked={isSecBulkSelected}
                          onChange={() =>
                            onToggleBulkInstall({
                              id: item.id,
                              appKey: secAppKey,
                              platform: bulkPlatform,
                              name: item.name,
                              developer: item.developer,
                              iconUrl: item.iconUrl,
                              packageId: item.packageId || item.name,
                              version: item.version,
                              license: item.license,
                              primaryDownloadUrl: item.primaryDownloadUrl,
                              directApkUrl: secDirectApkMirror?.url,
                              wingetId:
                                bulkPlatform === 'pc' && item.packageId.includes('.')
                                  ? item.packageId
                                  : undefined,
                            })
                          }
                          className="sr-only"
                        />
                        {isSecBulkSelected ? (
                          <CheckSquare className="w-5 h-5 text-sky-400" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-500 hover:text-sky-300 transition-colors" />
                        )}
                      </label>
                    )}

                    <AppIcon
                      src={item.iconUrl}
                      name={item.name}
                      platform={item.platform}
                      size="md"
                    />
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-100 truncate">
                        {item.name}
                      </h3>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                        <span>{item.developer}</span>
                        <span aria-hidden="true">·</span>
                        <span>{item.category}</span>
                        {item.rating !== undefined && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-sky-300">
                              {item.rating.toFixed(1)} ★
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>{item.price}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                    {supportsBulkInstall && (
                      <button
                        type="button"
                        onClick={() =>
                          onToggleBulkInstall({
                            id: item.id,
                            appKey: secAppKey,
                            platform: bulkPlatform,
                            name: item.name,
                            developer: item.developer,
                            iconUrl: item.iconUrl,
                            packageId: item.packageId || item.name,
                            version: item.version,
                            license: item.license,
                            primaryDownloadUrl: item.primaryDownloadUrl,
                            directApkUrl: secDirectApkMirror?.url,
                            wingetId:
                              bulkPlatform === 'pc' && item.packageId.includes('.')
                                ? item.packageId
                                : undefined,
                          })
                        }
                        className={`px-3 py-2 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                          isSecBulkSelected
                            ? 'bg-sky-500/20 border-sky-400/50 text-sky-200'
                            : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-sky-400/40'
                        }`}
                      >
                        {isSecBulkSelected ? (
                          <CheckSquare className="w-3.5 h-3.5 text-sky-400" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span>{isSecBulkSelected ? 'Queued' : 'Select for Bulk Install'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        onToggleSave({
                          appKey: secAppKey,
                          platform: item.platform,
                          name: item.name,
                          developer: item.developer,
                          iconUrl: item.iconUrl,
                          primaryUrl: item.primaryDownloadUrl,
                          secondaryUrl: item.officialWebsiteUrl || item.primaryDownloadUrl,
                          category: item.category,
                          license: item.license,
                          version: item.version,
                        })
                      }
                      aria-label={
                        isSecSaved
                          ? `Remove ${item.name} from Wishlist`
                          : `Save ${item.name} to Wishlist`
                      }
                      title={
                        isSecSaved
                          ? 'Saved in Wishlist (قائمة الأمنيات)'
                          : 'Save to Wishlist (قائمة الأمنيات)'
                      }
                      className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                        isSecSaved
                          ? 'bg-rose-500/20 border-rose-400/50 text-rose-300'
                          : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-rose-300 hover:border-rose-400/35'
                      }`}
                    >
                      <Heart
                        className={`w-4 h-4 ${isSecSaved ? 'fill-rose-400 text-rose-400' : ''}`}
                      />
                    </button>

                    {!isSelected && (
                      <button
                        type="button"
                        onClick={() => {
                          setActivePrimary(item);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="px-3.5 py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Focus Details
                      </button>
                    )}
                    <a
                      href={item.primaryDownloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-2 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-sky-200 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <span>{item.primaryDownloadLabel}</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Grounding & Live Index Attribution */}
      <footer className="bg-[#0B1325]/70 border border-slate-800/80 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-slate-400">
        <div className="space-y-1">
          <div className="font-medium text-slate-300 flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5 text-sky-400" />
            <span>Live Data Sources Queried</span>
          </div>
          <div>{data.sourcesQueried.join(' · ')}</div>
        </div>

        {activePrimary.groundingUrls &&
          activePrimary.groundingUrls.length > 0 &&
          data.platform !== 'ios' && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-slate-400">Web Verification:</span>
              {activePrimary.groundingUrls.slice(0, 3).map((g, i) => (
                <a
                  key={i}
                  href={g.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 hover:underline inline-flex items-center gap-1 truncate max-w-[200px]"
                >
                  <span className="truncate">{g.title}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              ))}
            </div>
          )}
      </footer>
    </div>
  );
};

