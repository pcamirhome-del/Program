import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Heart,
  Monitor,
  Smartphone,
  Apple,
  Search,
  CheckSquare,
  Square,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type {
  BulkInstallItem,
  CarouselAppItem,
  HomepageCarouselsResponse,
  PlatformType,
  SavedSoftwareRecord,
} from '../types.ts';
import { AppIcon } from './AppIcon.tsx';
import { sanitizeId } from '../lib/firebase.ts';

interface HomepageCarouselsProps {
  activePlatform: PlatformType;
  onPlatformChange: (platform: PlatformType) => void;
  wishlistItems: SavedSoftwareRecord[];
  onToggleWishlist: (item: {
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
  onInspectApp: (appName: string, platform: PlatformType) => void;
}

interface HorizontalCategoryRowProps {
  title: string;
  subtitle: string;
  items: CarouselAppItem[];
  isLoading: boolean;
  wishlistItems: SavedSoftwareRecord[];
  onToggleWishlist: HomepageCarouselsProps['onToggleWishlist'];
  bulkInstallItems: BulkInstallItem[];
  onToggleBulkInstall: HomepageCarouselsProps['onToggleBulkInstall'];
  onInspectApp: (appName: string, platform: PlatformType) => void;
}

const HorizontalCategoryRow: React.FC<HorizontalCategoryRowProps> = ({
  title,
  subtitle,
  items,
  isLoading,
  wishlistItems,
  onToggleWishlist,
  bulkInstallItems,
  onToggleBulkInstall,
  onInspectApp,
}) => {
  const scrollTrackRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollButtons = () => {
    const el = scrollTrackRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 12);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 12);
  };

  useEffect(() => {
    const el = scrollTrackRef.current;
    if (!el) return;
    el.scrollTo({ left: 0, behavior: 'smooth' });
    updateScrollButtons();
  }, [items]);

  const handleScroll = (direction: 'left' | 'right') => {
    const el = scrollTrackRef.current;
    if (!el) return;
    const scrollAmount = Math.max(el.clientWidth * 0.78, 320);
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
    setTimeout(updateScrollButtons, 360);
  };

  return (
    <div className="space-y-4">
      {/* Category Header + Left/Right Arrow Controls */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-xl sm:text-2xl font-display font-bold text-slate-50 tracking-tight">
              {title}
            </h3>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              · {isLoading ? 'Loading 15 items...' : `${items.length} apps`}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>
        </div>

        {/* Smooth Left/Right Carousel Navigation Buttons */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => handleScroll('left')}
            disabled={!canScrollLeft || isLoading}
            aria-label={`Scroll ${title} left`}
            className="w-10 h-10 rounded-xl bg-[#0F172A]/90 border border-slate-700/80 hover:border-sky-400/60 disabled:opacity-35 disabled:pointer-events-none text-slate-100 flex items-center justify-center transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => handleScroll('right')}
            disabled={!canScrollRight || isLoading}
            aria-label={`Scroll ${title} right`}
            className="w-10 h-10 rounded-xl bg-[#0F172A]/90 border border-slate-700/80 hover:border-sky-400/60 disabled:opacity-35 disabled:pointer-events-none text-slate-100 flex items-center justify-center transition-colors cursor-pointer"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Horizontal Carousel Track (15 Items) */}
      <div
        ref={scrollTrackRef}
        onScroll={updateScrollButtons}
        className="flex items-stretch gap-4 overflow-x-auto pb-3 pt-1 scroll-smooth snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {isLoading
          ? Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="w-[268px] sm:w-[284px] shrink-0 snap-start bg-[#0F172A]/75 border border-slate-800/80 rounded-2xl p-5 space-y-4 animate-pulse"
              >
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-slate-800 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="h-4 w-32 bg-slate-800 rounded" />
                    <div className="h-3 w-24 bg-slate-800/70 rounded" />
                  </div>
                </div>
                <div className="h-10 bg-slate-800/70 rounded-xl" />
              </div>
            ))
          : items.map((app, index) => {
              const safeKey = sanitizeId(app.appKey, 120);
              const isWishlisted = wishlistItems.some((w) => w.appKey === safeKey);
              const supportsBulk = app.platform === 'pc' || app.platform === 'android';
              const isBulkSelected = bulkInstallItems.some((b) => b.appKey === safeKey);

              return (
                <motion.article
                  key={app.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.16, delay: Math.min(index * 0.02, 0.2) }}
                  className={`w-[268px] sm:w-[284px] shrink-0 snap-start bg-[#0F172A]/80 backdrop-blur-xl border rounded-2xl p-5 flex flex-col justify-between transition-colors ${
                    isBulkSelected
                      ? 'border-sky-400/75 bg-sky-950/15'
                      : 'border-slate-800/90 hover:border-sky-400/45'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => onInspectApp(app.name, app.platform)}
                        className="flex items-start gap-3.5 text-left min-w-0 flex-1 group cursor-pointer"
                      >
                        <AppIcon
                          src={app.iconUrl}
                          name={app.name}
                          platform={app.platform}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="font-display font-bold text-slate-100 text-base truncate group-hover:text-sky-300 transition-colors">
                            {app.name}
                          </h4>
                          <p className="text-xs text-slate-400 truncate mt-0.5">
                            {app.developer}
                          </p>
                        </div>
                      </button>

                      {/* Wishlist (قائمة الأمنيات) Heart Toggle Button */}
                      <button
                        type="button"
                        onClick={() =>
                          onToggleWishlist({
                            appKey: safeKey,
                            platform: app.platform,
                            name: app.name,
                            developer: app.developer,
                            iconUrl: app.iconUrl,
                            primaryUrl: app.downloadUrl,
                            secondaryUrl: app.secondaryUrl || app.downloadUrl,
                            category: app.category,
                            license: app.license,
                            version: app.version,
                          })
                        }
                        aria-label={
                          isWishlisted
                            ? `Remove ${app.name} from Wishlist (قائمة الأمنيات)`
                            : `Add ${app.name} to Wishlist (قائمة الأمنيات)`
                        }
                        title={
                          isWishlisted
                            ? 'Remove from Wishlist (قائمة الأمنيات)'
                            : 'Add to Wishlist (قائمة الأمنيات)'
                        }
                        className={`p-2 rounded-xl border transition-colors shrink-0 cursor-pointer ${
                          isWishlisted
                            ? 'bg-rose-500/20 border-rose-400/50 text-rose-300'
                            : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-rose-300 hover:border-rose-400/35'
                        }`}
                      >
                        <Heart
                          className={`w-4 h-4 ${isWishlisted ? 'fill-rose-400 text-rose-400' : ''}`}
                        />
                      </button>
                    </div>

                    {/* Clean Unboxed Metadata Line (Zero-Pill Discipline) */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 mt-3.5">
                      <span className="text-sky-300 font-medium">{app.license}</span>
                      {app.rating !== undefined && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-slate-300">
                            {app.rating.toFixed(1)} ★
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums truncate">
                        #{String(index + 1).padStart(2, '0')}
                      </span>
                    </div>

                    {/* Phase 4: Select for Bulk Install Checkbox (PC & Android Only) */}
                    {supportsBulk && (
                      <div className="mt-3 pt-2.5 border-t border-slate-800/60">
                        <label className="inline-flex items-center gap-2 cursor-pointer select-none group">
                          <input
                            type="checkbox"
                            checked={isBulkSelected}
                            onChange={() =>
                              onToggleBulkInstall({
                                id: app.id,
                                appKey: safeKey,
                                platform: app.platform === 'android' ? 'android' : 'pc',
                                name: app.name,
                                developer: app.developer,
                                iconUrl: app.iconUrl,
                                packageId: app.packageId,
                                version: app.version,
                                license: app.license,
                                primaryDownloadUrl: app.downloadUrl,
                                directApkUrl:
                                  app.platform === 'android' &&
                                  app.downloadUrl.toLowerCase().endsWith('.apk')
                                    ? app.downloadUrl
                                    : undefined,
                                wingetId:
                                  app.platform === 'pc' && app.packageId.includes('.')
                                    ? app.packageId
                                    : undefined,
                              })
                            }
                            className="sr-only"
                          />
                          {isBulkSelected ? (
                            <CheckSquare className="w-4 h-4 text-sky-400 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-500 group-hover:text-sky-300 shrink-0 transition-colors" />
                          )}
                          <span
                            className={`text-xs font-medium transition-colors ${
                              isBulkSelected
                                ? 'text-sky-300'
                                : 'text-slate-400 group-hover:text-slate-200'
                            }`}
                          >
                            {isBulkSelected
                              ? 'Selected for Bulk Install'
                              : 'Select for Bulk Install'}
                          </span>
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Card Actions: Direct Download Link + Deep Inspect */}
                  <div className="mt-4 pt-3.5 border-t border-slate-800/80 flex items-center gap-2">
                    <a
                      href={app.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 px-3.5 py-2.5 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-sm rounded-xl inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
                    >
                      <Download className="w-4 h-4 shrink-0" />
                      <span className="truncate">{app.downloadLabel}</span>
                    </a>

                    <button
                      type="button"
                      onClick={() => onInspectApp(app.name, app.platform)}
                      title={`Deep scan ${app.name} & FOSS alternatives`}
                      aria-label={`Deep scan ${app.name}`}
                      className="p-2.5 bg-slate-800/90 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors shrink-0 cursor-pointer"
                    >
                      <Search className="w-4 h-4" />
                    </button>
                  </div>
                </motion.article>
              );
            })}
      </div>
    </div>
  );
};

export const HomepageCarousels: React.FC<HomepageCarouselsProps> = ({
  activePlatform,
  onPlatformChange,
  wishlistItems,
  onToggleWishlist,
  bulkInstallItems,
  onToggleBulkInstall,
  onInspectApp,
}) => {
  const { t } = useTranslation();
  const [carouselData, setCarouselData] = useState<HomepageCarouselsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const clientCacheRef = useRef<Map<PlatformType, HomepageCarouselsResponse>>(new Map());

  useEffect(() => {
    const cached = clientCacheRef.current.get(activePlatform);
    if (cached) {
      setCarouselData(cached);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    fetch(`/api/carousels?platform=${encodeURIComponent(activePlatform)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load carousels'))))
      .then((data: HomepageCarouselsResponse) => {
        if (!cancelled) {
          clientCacheRef.current.set(activePlatform, data);
          setCarouselData(data);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePlatform]);

  const platformDisplayName =
    activePlatform === 'pc'
      ? `${t('platforms.pc')} (PC / Windows)`
      : activePlatform === 'android'
      ? `${t('platforms.android')} (Android · Google Play & F-Droid)`
      : `${t('platforms.ios')} (iPhone · Official App Store)`;

  return (
    <section
      aria-label="Featured Software Categories"
      className="space-y-8 pt-6 border-t border-slate-800/80"
    >
      {/* Dynamic Platform Filter Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-display font-bold text-slate-50 tracking-tight">
            Curated Directory Carousels
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Showing verified direct downloads and store links for{' '}
            <span className="text-sky-300 font-medium">{platformDisplayName}</span>
          </p>
        </div>

        {/* Toggle Buttons Above the Carousels to Switch Platform (PC / Android / iPhone) */}
        <div
          role="group"
          aria-label="Filter carousels by platform"
          className="inline-flex items-center gap-1.5 p-1.5 bg-[#0F172A]/95 border border-sky-400/25 rounded-xl self-start md:self-auto"
        >
          <button
            type="button"
            onClick={() => onPlatformChange('pc')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePlatform === 'pc'
                ? 'bg-sky-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span>{t('platforms.pc')} (PC)</span>
          </button>
          <button
            type="button"
            onClick={() => onPlatformChange('android')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePlatform === 'android'
                ? 'bg-sky-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>{t('platforms.android')} (Android)</span>
          </button>
          <button
            type="button"
            onClick={() => onPlatformChange('ios')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activePlatform === 'ios'
                ? 'bg-sky-500 text-slate-950 shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
            }`}
          >
            <Apple className="w-4 h-4" />
            <span>{t('platforms.ios')} (iPhone)</span>
          </button>
        </div>
      </div>

      {/* Carousel 1: Social Media Applications (15 items) */}
      <HorizontalCategoryRow
        title={`01. ${t('socialApps')}`}
        subtitle={
          activePlatform === 'pc'
            ? 'Official Windows desktop messengers, federated clients, and open-source communication suites.'
            : activePlatform === 'android'
            ? 'Verified Google Play Store and F-Droid open-source messengers and social networks.'
            : 'Official iPhone social networking applications fetched strictly from the Apple App Store.'
        }
        items={carouselData?.socialMedia || []}
        isLoading={isLoading}
        wishlistItems={wishlistItems}
        onToggleWishlist={onToggleWishlist}
        bulkInstallItems={bulkInstallItems}
        onToggleBulkInstall={onToggleBulkInstall}
        onInspectApp={onInspectApp}
      />

      {/* Carousel 2: Photo & Video Editing Tools (15 items) */}
      <HorizontalCategoryRow
        title={`02. ${t('photoEditors')}`}
        subtitle={
          activePlatform === 'pc'
            ? 'Professional NLE video suites, RAW photo darkrooms, 3D pipelines, and open-source creative tools.'
            : activePlatform === 'android'
            ? 'Mobile video editors, RAW camera processors, and F-Droid open-source image toolboxes.'
            : 'Official iPhone photo darkrooms and video production tools from the Apple App Store.'
        }
        items={carouselData?.photoVideo || []}
        isLoading={isLoading}
        wishlistItems={wishlistItems}
        onToggleWishlist={onToggleWishlist}
        bulkInstallItems={bulkInstallItems}
        onToggleBulkInstall={onToggleBulkInstall}
        onInspectApp={onInspectApp}
      />
    </section>
  );
};
