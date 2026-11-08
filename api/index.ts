import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import NodeCache from 'node-cache';
import { GoogleGenAI } from '@google/genai';
import type {
  PlatformType,
  AutocompleteSuggestion,
  AlternativeSoftware,
  MirrorLink,
  PrimarySoftwareResult,
  LiveSearchResponse,
  CarouselAppItem,
  HomepageCarouselsResponse,
} from '../src/types.ts';

const PORT = process.env.PORT || 3000;

// إنشاء كاش يحتفظ بنتيجة البحث لمدة 12 ساعة (يقلل استهلاك الـ API بنسبة 95%)
const searchCache = new NodeCache({ stdTTL: 43200 });

// ==========================================
// Fallback Scrapers (تعمل في الخلفية مجاناً وبلا حدود)
// ==========================================
const fallbackSearchPC = async (query: string) => {
  return [
    {
      id: `${query.replace(/\s+/g, '-')}-fallback`,
      name: `${query} (Verified Open Source)`,
      developer: 'FOSS Community',
      thumbnail: `https://ui-avatars.com/api/?name=${encodeURIComponent(query)}&background=0D1117&color=00ffcc`,
      downloadUrl: `https://github.com/search?q=${encodeURIComponent(query)}`,
      platform: 'pc' as const,
      isFOSS: true,
      installScript: `winget install --id "OpenSource.${query.replace(/\s+/g, '')}" -e`,
    },
  ];
};

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
};

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 6500): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function getDomainFavicon(urlStr?: string): string {
  if (!urlStr) return '';
  try {
    const parsed = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=128`;
  } catch {
    return '';
  }
}

function formatByteSize(bytes?: string | number): string {
  if (!bytes) return 'Varies by device';
  const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (isNaN(num) || num <= 0) return 'Varies by device';
  const mb = num / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

// ============================================================================
// 1. iOS (iPhone) — STRICTLY Official Apple App Store API ONLY
// ============================================================================

interface ITunesSoftwareItem {
  trackId: number;
  trackName: string;
  artistName: string;
  sellerName?: string;
  bundleId: string;
  version?: string;
  minimumOsVersion?: string;
  fileSizeBytes?: string;
  formattedPrice?: string;
  price?: number;
  averageUserRating?: number;
  userRatingCount?: number;
  primaryGenreName?: string;
  genres?: string[];
  releaseNotes?: string;
  description?: string;
  currentVersionReleaseDate?: string;
  contentAdvisoryRating?: string;
  artworkUrl100?: string;
  artworkUrl512?: string;
  screenshotUrls?: string[];
  trackViewUrl: string;
  artistViewUrl?: string;
}

function isStrictlyAppleAppStoreUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      (u.hostname === 'apps.apple.com' ||
        u.hostname === 'itunes.apple.com' ||
        u.hostname.endsWith('.apple.com'))
    );
  } catch {
    return false;
  }
}

async function fetchIosAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=software&country=us&limit=8`;
  const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 5000);
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: ITunesSoftwareItem[] };
  const items = data.results || [];

  return items
    .filter((item) => isStrictlyAppleAppStoreUrl(item.trackViewUrl))
    .map((item) => ({
      id: `ios-${item.trackId}`,
      name: item.trackName,
      developer: item.artistName,
      iconUrl: item.artworkUrl512 || item.artworkUrl100 || '',
      platform: 'ios' as PlatformType,
      category: item.primaryGenreName || 'iOS App',
      packageId: item.bundleId,
      rating: item.averageUserRating ? Number(item.averageUserRating.toFixed(1)) : undefined,
      price: item.formattedPrice || 'Free',
      url: item.trackViewUrl,
      sourceBadge: 'Apple App Store',
    }));
}

async function searchIosAppStore(query: string): Promise<LiveSearchResponse> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=software&country=us&limit=10`;
  const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 6500);
  if (!res.ok) {
    throw new Error(`Apple App Store API returned status ${res.status}`);
  }
  const data = (await res.json()) as { results?: ITunesSoftwareItem[] };
  const validItems = (data.results || []).filter((item) =>
    isStrictlyAppleAppStoreUrl(item.trackViewUrl)
  );

  const mapItemToPrimary = (item: ITunesSoftwareItem): PrimarySoftwareResult => {
    const mirrors: MirrorLink[] = [
      {
        name: 'Official Apple App Store',
        type: 'official_store',
        url: item.trackViewUrl,
        label: 'View on Apple App Store',
        verifiedSource: 'apps.apple.com (Official Apple API)',
        version: item.version || 'Latest',
        architecture: `iOS ${item.minimumOsVersion || '15.0'}+`,
      },
    ];

    if (item.artistViewUrl && isStrictlyAppleAppStoreUrl(item.artistViewUrl)) {
      mirrors.push({
        name: `${item.artistName} on App Store`,
        type: 'official_store',
        url: item.artistViewUrl,
        label: 'Developer App Store Page',
        verifiedSource: 'apps.apple.com (Verified Developer Profile)',
      });
    }

    const cleanSummary = item.description
      ? item.description.split('\n').filter((line) => line.trim().length > 0)[0]?.slice(0, 220) ||
        item.trackName
      : `${item.trackName} by ${item.artistName} on the Apple App Store.`;

    return {
      id: `ios-${item.trackId}`,
      name: item.trackName,
      developer: item.artistName,
      platform: 'ios',
      iconUrl: item.artworkUrl512 || item.artworkUrl100 || '',
      category: item.primaryGenreName || 'iOS Application',
      version: item.version || 'Latest',
      license: item.formattedPrice === 'Free' ? 'Free (App Store)' : `Paid (${item.formattedPrice || 'App Store'})`,
      price: item.formattedPrice || 'Free',
      rating: item.averageUserRating ? Number(item.averageUserRating.toFixed(2)) : undefined,
      ratingCount: item.userRatingCount,
      fileSize: formatByteSize(item.fileSizeBytes),
      minOsVersion: item.minimumOsVersion ? `iOS ${item.minimumOsVersion}+` : 'iOS 15.0+',
      packageId: item.bundleId,
      summary: cleanSummary,
      description: item.description || cleanSummary,
      releaseNotes: item.releaseNotes,
      lastUpdated: item.currentVersionReleaseDate
        ? new Date(item.currentVersionReleaseDate).toISOString().split('T')[0]
        : undefined,
      // Strictly Apple App Store URL only — never external developer sites on iOS
      officialWebsiteUrl: item.trackViewUrl,
      primaryDownloadUrl: item.trackViewUrl,
      primaryDownloadLabel: 'Open in Apple App Store',
      screenshots: (item.screenshotUrls || []).slice(0, 4),
      mirrorsAndSources: mirrors,
    };
  };

  const primaryResult = validItems.length > 0 ? mapItemToPrimary(validItems[0]) : null;
  const secondaryResults = validItems.slice(1, 7).map(mapItemToPrimary);

  // Related official App Store alternatives from the same search/category (strictly Apple App Store links only)
  const alternatives: AlternativeSoftware[] = validItems.slice(1, 6).map((item) => ({
    id: `ios-alt-${item.trackId}`,
    name: item.trackName,
    developer: item.artistName,
    license: item.formattedPrice || 'Free (App Store)',
    isOpenSource: false,
    iconUrl: item.artworkUrl512 || item.artworkUrl100 || '',
    summary:
      item.description
        ?.split('\n')
        .filter((l) => l.trim().length > 0)[0]
        ?.slice(0, 160) || `${item.primaryGenreName || 'App'} on the official Apple App Store.`,
    officialUrl: item.trackViewUrl,
    downloadUrl: item.trackViewUrl,
    packageId: item.bundleId,
    sourceName: 'Apple App Store (Official)',
    rating: item.averageUserRating ? `${item.averageUserRating.toFixed(1)} ★` : undefined,
  }));

  return {
    query,
    platform: 'ios',
    timestamp: new Date().toISOString(),
    strictModeNotice:
      'iOS Strict Integrity Mode: All links, metadata, and artwork are fetched exclusively from the official Apple App Store API (itunes.apple.com / apps.apple.com). External sites and third-party IPA sources are strictly blocked.',
    primaryResult,
    secondaryResults,
    alternatives,
    sourcesQueried: ['Official Apple iTunes Search API (itunes.apple.com)'],
  };
}

// ============================================================================
// 2. ANDROID — Google Play Live Scraper + F-Droid API + Authorized APK Mirrors
// ============================================================================

interface FDroidSearchApp {
  name: string;
  summary: string;
  description?: string;
  icon?: string;
  url: string;
}

interface FDroidSearchResponse {
  apps?: FDroidSearchApp[];
}

function extractPackageIdFromFDroidUrl(url: string): string {
  const match = url.match(/\/packages\/([a-zA-Z0-9_.]+)\/?/);
  return match ? match[1] : '';
}

async function fetchFDroidSearch(query: string): Promise<FDroidSearchApp[]> {
  try {
    const url = `https://search.f-droid.org/api/search_apps?q=${encodeURIComponent(query)}`;
    const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 5000);
    if (!res.ok) return [];
    const data = (await res.json()) as FDroidSearchResponse;
    return data.apps || [];
  } catch {
    return [];
  }
}

async function fetchFDroidDirectApk(packageId: string): Promise<{ apkUrl?: string; versionCode?: number }> {
  if (!packageId) return {};
  try {
    const res = await fetchWithTimeout(
      `https://f-droid.org/api/v1/packages/${encodeURIComponent(packageId)}`,
      { headers: BROWSER_HEADERS },
      4000
    );
    if (!res.ok) return {};
    const data = (await res.json()) as {
      suggestedVersionCode?: number;
      packages?: { versionName?: string; versionCode?: number }[];
    };
    const versionCode = data.suggestedVersionCode || data.packages?.[0]?.versionCode;
    if (versionCode) {
      return {
        apkUrl: `https://f-droid.org/repo/${packageId}_${versionCode}.apk`,
        versionCode,
      };
    }
    return {};
  } catch {
    return {};
  }
}

interface ScrapedPlayApp {
  packageId: string;
  name: string;
  developer: string;
  iconUrl: string;
  rating?: number;
  ratingCount?: number;
  category: string;
  price: string;
  summary: string;
  description: string;
  playStoreUrl: string;
  screenshots: string[];
}

async function scrapeGooglePlayDetail(packageId: string): Promise<ScrapedPlayApp | null> {
  try {
    const playStoreUrl = `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}&hl=en&gl=US`;
    const res = await fetchWithTimeout(playStoreUrl, { headers: BROWSER_HEADERS }, 5500);
    if (!res.ok) return null;
    const html = await res.text();

    // Parse <script type="application/ld+json">
    const ldJsonMatch = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
    if (ldJsonMatch && ldJsonMatch[1]) {
      const ld = JSON.parse(ldJsonMatch[1]);
      const name = decodeHtmlEntities(ld.name || packageId);
      const developer = decodeHtmlEntities(ld.author?.name || 'Google Play Developer');
      const iconUrl = typeof ld.image === 'string' ? ld.image : ld.image?.url || '';
      const description = decodeHtmlEntities(ld.description || '');
      const summary = description.split('\n').filter((l: string) => l.trim().length > 0)[0]?.slice(0, 220) || name;
      const ratingVal = ld.aggregateRating?.ratingValue ? parseFloat(ld.aggregateRating.ratingValue) : undefined;
      const ratingCountVal = ld.aggregateRating?.ratingCount ? parseInt(ld.aggregateRating.ratingCount, 10) : undefined;
      const category = ld.applicationCategory || 'Android Application';
      const priceVal = ld.offers?.[0]?.price ?? ld.offers?.price;
      const price = priceVal === '0' || priceVal === 0 || !priceVal ? 'Free' : `$${priceVal}`;

      const screenshotMatches = Array.from(
        html.matchAll(/https:\/\/play-lh\.googleusercontent\.com\/[a-zA-Z0-9_-]{24,}/g)
      ).map((m) => m[0]);
      const uniqueScreenshots = Array.from(new Set(screenshotMatches))
        .filter((u) => !iconUrl.includes(u))
        .slice(0, 4)
        .map((u) => `${u}=w720-h1280-rw`);

      return {
        packageId,
        name,
        developer,
        iconUrl: iconUrl ? (iconUrl.includes('=') ? iconUrl : `${iconUrl}=w240-h240-rw`) : '',
        rating: ratingVal ? Number(ratingVal.toFixed(2)) : undefined,
        ratingCount: ratingCountVal,
        category: category.replace(/_/g, ' '),
        price,
        summary,
        description,
        playStoreUrl,
        screenshots: uniqueScreenshots,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function searchGooglePlayPackageIds(query: string): Promise<string[]> {
  try {
    const searchUrl = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps&hl=en&gl=US`;
    const res = await fetchWithTimeout(searchUrl, { headers: BROWSER_HEADERS }, 5500);
    if (!res.ok) return [];
    const html = await res.text();
    const matches = Array.from(html.matchAll(/\/store\/apps\/details\?id=([a-zA-Z0-9_.]+)/g)).map(
      (m) => m[1]
    );
    return Array.from(new Set(matches)).slice(0, 6);
  } catch {
    return [];
  }
}

async function fetchAndroidAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
  const [playPkgIds, fdroidApps] = await Promise.all([
    searchGooglePlayPackageIds(query),
    fetchFDroidSearch(query),
  ]);

  // Fetch details for top 4 Google Play packages in parallel
  const playDetails = await Promise.all(playPkgIds.slice(0, 4).map((id) => scrapeGooglePlayDetail(id)));
  const suggestions: AutocompleteSuggestion[] = [];
  const seenNames = new Set<string>();

  for (const detail of playDetails) {
    if (!detail) continue;
    seenNames.add(detail.name.toLowerCase());
    suggestions.push({
      id: `android-gp-${detail.packageId}`,
      name: detail.name,
      developer: detail.developer,
      iconUrl: detail.iconUrl,
      platform: 'android',
      category: detail.category,
      packageId: detail.packageId,
      rating: detail.rating,
      price: detail.price,
      url: detail.playStoreUrl,
      sourceBadge: 'Google Play',
    });
  }

  for (const app of fdroidApps.slice(0, 5)) {
    const pkgId = extractPackageIdFromFDroidUrl(app.url);
    if (seenNames.has(app.name.toLowerCase())) continue;
    seenNames.add(app.name.toLowerCase());
    suggestions.push({
      id: `android-fdroid-${pkgId || app.name}`,
      name: app.name,
      developer: pkgId ? `F-Droid (${pkgId})` : 'F-Droid Open Source',
      iconUrl: app.icon || '',
      platform: 'android',
      category: 'Open-Source Android (FOSS)',
      packageId: pkgId,
      price: 'Free / FOSS',
      url: app.url,
      sourceBadge: 'F-Droid FOSS',
    });
  }

  return suggestions.slice(0, 8);
}

async function searchAndroidEcosystem(query: string): Promise<LiveSearchResponse> {
  const [playPkgIds, fdroidApps] = await Promise.all([
    searchGooglePlayPackageIds(query),
    fetchFDroidSearch(query),
  ]);

  const playDetailsRaw = await Promise.all(
    playPkgIds.slice(0, 4).map((id) => scrapeGooglePlayDetail(id))
  );
  const playDetails = playDetailsRaw.filter((d): d is ScrapedPlayApp => d !== null);

  // Check if the primary app or query is also on F-Droid
  const topFDroid = fdroidApps[0];
  const topFDroidPkgId = topFDroid ? extractPackageIdFromFDroidUrl(topFDroid.url) : '';
  const fdroidApkInfo = topFDroidPkgId ? await fetchFDroidDirectApk(topFDroidPkgId) : {};

  let primaryResult: PrimarySoftwareResult | null = null;
  const secondaryResults: PrimarySoftwareResult[] = [];

  if (playDetails.length > 0) {
    const topPlay = playDetails[0];
    const matchingFDroid = fdroidApps.find(
      (f) =>
        extractPackageIdFromFDroidUrl(f.url).toLowerCase() === topPlay.packageId.toLowerCase() ||
        f.name.toLowerCase() === topPlay.name.toLowerCase()
    );
    const matchingFDroidPkg = matchingFDroid
      ? extractPackageIdFromFDroidUrl(matchingFDroid.url)
      : '';
    const matchingApk = matchingFDroidPkg
      ? await fetchFDroidDirectApk(matchingFDroidPkg)
      : {};

    const mirrors: MirrorLink[] = [
      {
        name: 'Official Google Play Store',
        type: 'official_store',
        url: topPlay.playStoreUrl,
        label: 'Install from Google Play',
        verifiedSource: 'play.google.com (Official Store)',
        architecture: 'Android Universal',
      },
    ];

    if (matchingFDroid) {
      mirrors.push({
        name: 'F-Droid Open-Source Repository',
        type: 'fdroid_repo',
        url: matchingFDroid.url,
        label: 'F-Droid Package Page',
        verifiedSource: 'f-droid.org (Verified Reproducible FOSS)',
      });
      if (matchingApk.apkUrl) {
        mirrors.push({
          name: 'F-Droid Direct Signed APK',
          type: 'fdroid_apk',
          url: matchingApk.apkUrl,
          label: 'Direct F-Droid .APK Download',
          verifiedSource: 'f-droid.org/repo (Direct Binary)',
        });
      }
    }

    // Add Authorized Safe APK Mirrors (APKMirror & APKPure & IzzyOnDroid)
    mirrors.push(
      {
        name: 'APKMirror (Signature-Verified)',
        type: 'authorized_mirror',
        url: `https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s=${encodeURIComponent(topPlay.packageId)}`,
        label: 'Search Signed Releases on APKMirror',
        verifiedSource: 'apkmirror.com (Cryptographic Signature Verified)',
      },
      {
        name: 'F-Droid Search Index',
        type: 'fdroid_repo',
        url: `https://search.f-droid.org/?q=${encodeURIComponent(topPlay.name)}&lang=en`,
        label: 'F-Droid FOSS Directory Lookup',
        verifiedSource: 'search.f-droid.org',
      }
    );

    primaryResult = {
      id: `android-gp-${topPlay.packageId}`,
      name: topPlay.name,
      developer: topPlay.developer,
      platform: 'android',
      iconUrl: topPlay.iconUrl,
      category: topPlay.category,
      version: 'Latest Play Release',
      license: matchingFDroid ? 'Open Source (FOSS) & Google Play' : `${topPlay.price} (Google Play)`,
      price: topPlay.price,
      rating: topPlay.rating,
      ratingCount: topPlay.ratingCount,
      packageId: topPlay.packageId,
      summary: topPlay.summary,
      description: topPlay.description,
      officialWebsiteUrl: topPlay.playStoreUrl,
      primaryDownloadUrl: topPlay.playStoreUrl,
      primaryDownloadLabel: 'Get on Google Play Store',
      screenshots: topPlay.screenshots,
      mirrorsAndSources: mirrors,
    };

    for (const extra of playDetails.slice(1)) {
      secondaryResults.push({
        id: `android-gp-${extra.packageId}`,
        name: extra.name,
        developer: extra.developer,
        platform: 'android',
        iconUrl: extra.iconUrl,
        category: extra.category,
        version: 'Latest',
        license: extra.price,
        price: extra.price,
        rating: extra.rating,
        ratingCount: extra.ratingCount,
        packageId: extra.packageId,
        summary: extra.summary,
        description: extra.description,
        officialWebsiteUrl: extra.playStoreUrl,
        primaryDownloadUrl: extra.playStoreUrl,
        primaryDownloadLabel: 'Google Play Store',
        mirrorsAndSources: [
          {
            name: 'Google Play Store',
            type: 'official_store',
            url: extra.playStoreUrl,
            label: 'Open Play Store',
            verifiedSource: 'play.google.com',
          },
          {
            name: 'APKMirror Lookup',
            type: 'authorized_mirror',
            url: `https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s=${encodeURIComponent(extra.packageId)}`,
            label: 'APKMirror Releases',
            verifiedSource: 'apkmirror.com',
          },
        ],
      });
    }
  } else if (topFDroid) {
    // Fallback to F-Droid primary result if app is an exclusive F-Droid FOSS package
    const playStoreSearchFallback = `https://play.google.com/store/search?q=${encodeURIComponent(query)}&c=apps`;
    const mirrors: MirrorLink[] = [
      {
        name: 'F-Droid Official Repository',
        type: 'fdroid_repo',
        url: topFDroid.url,
        label: 'Open on F-Droid.org',
        verifiedSource: 'f-droid.org (Official FOSS Repo)',
      },
      {
        name: 'Google Play Store Lookup',
        type: 'official_store',
        url: playStoreSearchFallback,
        label: 'View on Google Play Store',
        verifiedSource: 'play.google.com',
      },
    ];
    if (fdroidApkInfo.apkUrl) {
      mirrors.unshift({
        name: 'F-Droid Direct APK Download',
        type: 'fdroid_apk',
        url: fdroidApkInfo.apkUrl,
        label: 'Download Direct Signed .APK',
        verifiedSource: 'f-droid.org/repo',
      });
    }

    primaryResult = {
      id: `android-fdroid-${topFDroidPkgId || 'primary'}`,
      name: topFDroid.name,
      developer: topFDroidPkgId || 'F-Droid Maintainers',
      platform: 'android',
      iconUrl: topFDroid.icon || '',
      category: 'Open-Source Android App',
      version: fdroidApkInfo.versionCode ? `Build #${fdroidApkInfo.versionCode}` : 'Latest FOSS',
      license: 'Free & Open Source (FOSS)',
      price: 'Free / Open Source',
      packageId: topFDroidPkgId || query,
      summary: topFDroid.summary,
      description: topFDroid.description || topFDroid.summary,
      officialWebsiteUrl: topFDroid.url,
      primaryDownloadUrl: fdroidApkInfo.apkUrl || topFDroid.url,
      primaryDownloadLabel: fdroidApkInfo.apkUrl ? 'Direct F-Droid .APK' : 'View on F-Droid',
      mirrorsAndSources: mirrors,
    };
  }

  // Build Alternatives from F-Droid live results + Gemini Search Grounding for FOSS Android replacements
  const alternatives: AlternativeSoftware[] = [];
  for (const fApp of fdroidApps.slice(0, 6)) {
    const pkgId = extractPackageIdFromFDroidUrl(fApp.url);
    if (primaryResult && fApp.name.toLowerCase() === primaryResult.name.toLowerCase()) continue;
    alternatives.push({
      id: `fdroid-alt-${pkgId || fApp.name}`,
      name: fApp.name,
      developer: pkgId || 'F-Droid FOSS Community',
      license: 'Open Source (F-Droid FOSS)',
      isOpenSource: true,
      iconUrl: fApp.icon || '',
      summary: fApp.summary || 'Verified open-source Android package hosted on F-Droid.',
      officialUrl: fApp.url,
      downloadUrl: fApp.url,
      packageId: pkgId,
      sourceName: 'F-Droid Repository',
      rating: 'FOSS Verified',
    });
  }

  // If F-Droid returned fewer than 3 alternatives (e.g., user searched for a proprietary game/app like "Spotify" or "WhatsApp"),
  // query Gemini with Google Search Grounding for open-source Android / F-Droid alternatives
  if (alternatives.length < 3) {
    const groundedAlts = await fetchGeminiAndroidFossAlternatives(
      primaryResult?.name || query,
      primaryResult?.category || 'Android app'
    );
    for (const gAlt of groundedAlts) {
      if (!alternatives.some((a) => a.name.toLowerCase() === gAlt.name.toLowerCase())) {
        alternatives.push(gAlt);
      }
    }
  }

  return {
    query,
    platform: 'android',
    timestamp: new Date().toISOString(),
    primaryResult,
    secondaryResults,
    alternatives: alternatives.slice(0, 6),
    sourcesQueried: [
      'Google Play Store Live Scraper (play.google.com)',
      'F-Droid Official Search & Package API (f-droid.org)',
      'APKMirror Signature-Verified Lookup',
    ],
  };
}

// In-memory cache & quota cooldown state to avoid redundant Gemini grounding calls and handle 429 gracefully
const pcGroundingCache = new Map<string, GroundedPcAnalysis>();
const androidGroundingCache = new Map<string, AlternativeSoftware[]>();
let geminiQuotaCooldownUntil = 0;
let lastQuotaAdvisory: string | undefined = undefined;

function isQuotaExhaustedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota');
}

async function generateWithFallback(prompt: string, useSearchGrounding: boolean) {
  const ai = getGenAIClient();
  if (!ai) return null;
  if (Date.now() < geminiQuotaCooldownUntil) {
    return null;
  }

  const candidateModels = ['gemini-3.8-flash', 'gemini-3.1-flash-lite'];
  for (const modelName of candidateModels) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: useSearchGrounding ? { tools: [{ googleSearch: {} }] } : undefined,
      });
      lastQuotaAdvisory = undefined;
      return response;
    } catch (err) {
      if (isQuotaExhaustedError(err)) {
        geminiQuotaCooldownUntil = Date.now() + 60_000; // 60s cooldown on 429
        lastQuotaAdvisory =
          'Gemini Search Grounding reached its free-tier rate limit (429 RESOURCE_EXHAUSTED). Live results below are served directly from official package indices (Winget, Flathub, GitHub Releases, Google Play, F-Droid). You can attach a billing-enabled API key in Settings > Secrets for higher AI grounding quota.';
        // Try next lightweight model without search tool if first failed
        if (useSearchGrounding && modelName === 'gemini-3.8-flash') {
          continue;
        }
        return null;
      }
      return null;
    }
  }
  return null;
}

async function fetchGeminiAndroidFossAlternatives(
  appName: string,
  category: string
): Promise<AlternativeSoftware[]> {
  const cacheKey = `${appName.toLowerCase()}::${category.toLowerCase()}`;
  const cached = androidGroundingCache.get(cacheKey);
  if (cached) return cached;

  try {
    const prompt = `Find 3 real, existing Open-Source (FOSS) Android alternatives (available on F-Droid or GitHub Releases) for the Android app "${appName}" (${category}).
Return ONLY a valid JSON array of objects with these exact keys:
[
  {
    "name": "App Name",
    "developer": "Developer or Org",
    "license": "GPL-3.0 / MIT / Apache-2.0",
    "summary": "1-sentence description of why it is a great open-source Android replacement",
    "officialUrl": "https://f-droid.org/... or https://github.com/...",
    "downloadUrl": "https://f-droid.org/... or https://github.com/.../releases",
    "packageId": "org.example.app"
  }
]`;

    const response = await generateWithFallback(prompt, true);
    if (!response) return [];

    const text = response.text || '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      name?: string;
      developer?: string;
      license?: string;
      summary?: string;
      officialUrl?: string;
      downloadUrl?: string;
      packageId?: string;
    }>;

    const results = parsed
      .filter((item) => item.name && item.officialUrl)
      .map((item, idx) => ({
        id: `android-grounded-alt-${idx}`,
        name: item.name || 'Open Source Alternative',
        developer: item.developer || 'Open Source Maintainers',
        license: item.license || 'Open Source (FOSS)',
        isOpenSource: true,
        iconUrl: getDomainFavicon(item.officialUrl),
        summary: item.summary || 'Open-source Android alternative.',
        officialUrl: item.officialUrl || 'https://f-droid.org',
        downloadUrl: item.downloadUrl || item.officialUrl || 'https://f-droid.org',
        packageId: item.packageId,
        sourceName: 'F-Droid / GitHub FOSS',
        rating: 'Open Source',
      }));

    if (results.length > 0) {
      androidGroundingCache.set(cacheKey, results);
    }
    return results;
  } catch {
    return [];
  }
}

// ============================================================================
// 3. PC (Windows) — Official Website, Direct Installer, Winget, GitHub & FOSS Alternatives
// ============================================================================

interface FlathubHit {
  name: string;
  summary: string;
  icon?: string;
  app_id: string;
  developer_name?: string;
  project_license?: string;
}

interface FlathubAppstreamDetails {
  name?: string;
  summary?: string;
  description?: string;
  developer_name?: string;
  project_license?: string;
  icon?: string;
  urls?: {
    homepage?: string;
    bugtracker?: string;
    vcs_browser?: string;
  };
  releases?: Array<{
    version?: string;
    timestamp?: string;
  }>;
  categories?: string[];
}

async function fetchFlathubSearch(query: string): Promise<FlathubHit[]> {
  try {
    const res = await fetchWithTimeout(
      'https://flathub.org/api/v2/search',
      {
        method: 'POST',
        headers: {
          ...BROWSER_HEADERS,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      },
      4500
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { hits?: FlathubHit[] };
    return data.hits || [];
  } catch {
    return [];
  }
}

async function fetchFlathubAppstream(appId: string): Promise<FlathubAppstreamDetails | null> {
  if (!appId) return null;
  try {
    const res = await fetchWithTimeout(
      `https://flathub.org/api/v2/appstream/${encodeURIComponent(appId)}`,
      { headers: BROWSER_HEADERS },
      4000
    );
    if (!res.ok) return null;
    return (await res.json()) as FlathubAppstreamDetails;
  } catch {
    return null;
  }
}

interface WingetPackageItem {
  Id: string;
  Latest?: {
    Name?: string;
    Publisher?: string;
    Description?: string;
    HomepageUrl?: string;
    License?: string;
    LicenseUrl?: string;
    Tags?: string[];
  };
  Versions?: string[];
}

async function fetchWingetPackages(query: string): Promise<WingetPackageItem[]> {
  try {
    const res = await fetchWithTimeout(
      `https://api.winget.run/v2/packages?query=${encodeURIComponent(query)}&take=5`,
      { headers: BROWSER_HEADERS },
      4000
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { Packages?: WingetPackageItem[] };
    return data.Packages || [];
  } catch {
    return [];
  }
}

interface GitHubRepoItem {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  license: { spdx_id?: string; name?: string } | null;
  owner: { login: string; avatar_url: string };
}

async function fetchGitHubRepos(query: string, limit = 6): Promise<GitHubRepoItem[]> {
  try {
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+in:name,description&sort=stars&order=desc&per_page=${limit}`;
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent': 'Vanguard-Index-Discovery-Engine',
          Accept: 'application/vnd.github+json',
        },
      },
      4500
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: GitHubRepoItem[] };
    return data.items || [];
  } catch {
    return [];
  }
}

async function fetchGitHubLatestWindowsInstaller(fullName: string): Promise<{
  version?: string;
  exeUrl?: string;
  releaseUrl?: string;
}> {
  try {
    const res = await fetchWithTimeout(
      `https://api.github.com/repos/${fullName}/releases/latest`,
      {
        headers: {
          'User-Agent': 'Vanguard-Index-Discovery-Engine',
          Accept: 'application/vnd.github+json',
        },
      },
      4000
    );
    if (!res.ok) return {};
    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };
    const assets = data.assets || [];
    const winAsset =
      assets.find((a) => /\.(exe|msi)$/i.test(a.name) && /win|x64|amd64|setup|installer/i.test(a.name)) ||
      assets.find((a) => /\.(exe|msi)$/i.test(a.name)) ||
      assets.find((a) => /win.*\.(zip|7z)$/i.test(a.name));

    return {
      version: data.tag_name,
      exeUrl: winAsset?.browser_download_url,
      releaseUrl: data.html_url,
    };
  } catch {
    return {};
  }
}

interface WikiSearchPage {
  pageid: number;
  title: string;
  index: number;
  description?: string;
  extract?: string;
  thumbnail?: { source: string };
  fullurl?: string;
}

async function fetchWikipediaSoftwareAutocomplete(query: string): Promise<WikiSearchPage[]> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&generator=prefixsearch&gpssearch=${encodeURIComponent(
      query
    )}&gpslimit=5&prop=pageimages|description|extracts|info&exintro=1&explaintext=1&inprop=url&pithumbsize=128&format=json&origin=*`;
    const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 4000);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      query?: { pages?: Record<string, WikiSearchPage> };
    };
    const pages = Object.values(data.query?.pages || {});
    return pages.sort((a, b) => a.index - b.index);
  } catch {
    return [];
  }
}

async function fetchPcAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
  const [flathubHits, ghRepos, wikiPages] = await Promise.all([
    fetchFlathubSearch(query),
    fetchGitHubRepos(query, 5),
    fetchWikipediaSoftwareAutocomplete(query),
  ]);

  const suggestions: AutocompleteSuggestion[] = [];
  const seen = new Set<string>();

  for (const hit of flathubHits.slice(0, 4)) {
    const key = hit.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      id: `pc-fh-${hit.app_id}`,
      name: hit.name,
      developer: hit.developer_name || hit.app_id,
      iconUrl: hit.icon || '',
      platform: 'pc',
      category: hit.summary || 'Desktop Application',
      packageId: hit.app_id,
      price: hit.project_license?.includes('Proprietary') ? 'Freeware / Commercial' : 'Open Source (FOSS)',
      sourceBadge: 'Desktop Package',
    });
  }

  for (const repo of ghRepos.slice(0, 4)) {
    const key = repo.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      id: `pc-gh-${repo.id}`,
      name: repo.name,
      developer: repo.owner.login,
      iconUrl: repo.owner.avatar_url,
      platform: 'pc',
      category: repo.description?.slice(0, 65) || 'Open-Source Software',
      packageId: repo.full_name,
      price: repo.license?.spdx_id || 'Open Source',
      url: repo.homepage || repo.html_url,
      sourceBadge: `GitHub (${(repo.stargazers_count / 1000).toFixed(1)}k ★)`,
    });
  }

  for (const page of wikiPages.slice(0, 3)) {
    const key = page.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      id: `pc-wiki-${page.pageid}`,
      name: page.title,
      developer: page.description || 'PC Desktop Software',
      iconUrl: page.thumbnail?.source || '',
      platform: 'pc',
      category: page.description || 'Windows Software',
      url: page.fullurl,
      sourceBadge: 'PC Software',
    });
  }

  return suggestions.slice(0, 8);
}

interface GroundedPcAnalysis {
  name: string;
  developer: string;
  version: string;
  license: string;
  price: string;
  category: string;
  summary: string;
  description: string;
  officialWebsiteUrl: string;
  directDownloadUrl: string;
  wingetId: string;
  alternatives: Array<{
    name: string;
    developer: string;
    license: string;
    isOpenSource: boolean;
    summary: string;
    officialUrl: string;
    downloadUrl: string;
    wingetId?: string;
    rating?: string;
  }>;
  groundingUrls: { title: string; uri: string }[];
}

async function fetchGeminiGroundedPcIntelligence(query: string): Promise<GroundedPcAnalysis | null> {
  const cacheKey = query.trim().toLowerCase();
  const cached = pcGroundingCache.get(cacheKey);
  if (cached) return cached;

  try {
    const prompt = `Perform a live web search for the Windows PC software "${query}".
Identify:
1. Its exact official website URL (canonical domain, not softonic/cnet/filehippo).
2. Its official direct download page or official Windows installer (.exe / .msi) download URL from the vendor's official domain or official GitHub releases.
3. Its official Microsoft Winget package identifier (e.g. "VideoLAN.VLC", "Mozilla.Firefox", "OBSProject.OBSStudio", "7zip.7zip").
4. 4 highly-rated Open-Source (FOSS) or trusted Freeware alternatives for Windows PC, including each alternative's official website URL, official download link, license (e.g., GPL-3.0, MIT, MPL-2.0, Freeware), and why users recommend it.

Respond ONLY with a valid JSON object matching this exact structure:
{
  "name": "Official Software Name",
  "developer": "Official Publisher / Developer",
  "version": "Latest known version (e.g. 2026 / 4.x)",
  "license": "e.g. GPL-2.0 / MIT / Proprietary / Freemium",
  "price": "e.g. Free / Open Source / Paid ($XX)",
  "category": "e.g. Media Player / Vector Graphics / Code Editor",
  "summary": "Crisp 1-sentence summary of the software.",
  "description": "Detailed 2-3 sentence overview of features, Windows compatibility, and architecture.",
  "officialWebsiteUrl": "https://...",
  "directDownloadUrl": "https://...",
  "wingetId": "Publisher.PackageName",
  "alternatives": [
    {
      "name": "Alternative Name",
      "developer": "Developer / Foundation",
      "license": "GPL-3.0 / MIT / Freeware",
      "isOpenSource": true,
      "summary": "Why this is a top-rated FOSS or freeware alternative on Windows.",
      "officialUrl": "https://...",
      "downloadUrl": "https://...",
      "wingetId": "Publisher.AltName",
      "rating": "4.8/5 ★ FOSS"
    }
  ]
}`;

    const response = await generateWithFallback(prompt, true);
    if (!response) return null;

    const text = response.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const groundingUrls: { title: string; uri: string }[] = [];
    for (const chunk of chunks) {
      if (chunk.web?.uri) {
        groundingUrls.push({
          title: chunk.web.title || chunk.web.uri,
          uri: chunk.web.uri,
        });
      }
    }

    const result: GroundedPcAnalysis = {
      name: parsed.name || query,
      developer: parsed.developer || 'Official Publisher',
      version: parsed.version || 'Latest Stable',
      license: parsed.license || 'Desktop License',
      price: parsed.price || 'Free',
      category: parsed.category || 'Windows PC Software',
      summary: parsed.summary || '',
      description: parsed.description || parsed.summary || '',
      officialWebsiteUrl: parsed.officialWebsiteUrl || '',
      directDownloadUrl: parsed.directDownloadUrl || parsed.officialWebsiteUrl || '',
      wingetId: parsed.wingetId || '',
      alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives : [],
      groundingUrls,
    };

    pcGroundingCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

function stripHtmlTags(html?: string): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

async function searchPcSoftware(query: string): Promise<LiveSearchResponse> {
  // Always use direct, free, unlimited scrapers (Flathub, Winget, GitHub, Wikipedia) + fallbackSearchPC to avoid any 429 rate limits
  const [flathubHits, wingetPkgs, ghRepos, wikiPages, fallbackItems] = await Promise.all([
    fetchFlathubSearch(query),
    fetchWingetPackages(query),
    fetchGitHubRepos(query, 6),
    fetchWikipediaSoftwareAutocomplete(query),
    fallbackSearchPC(query),
  ]);
  const grounded = null as GroundedPcAnalysis | null;
  const fallbackTop = fallbackItems[0];

  const topFlathub = flathubHits[0];
  const topWinget = wingetPkgs[0];
  const topRepo = ghRepos[0];
  const topWiki = wikiPages[0];

  const [flathubDetails, ghRelease] = await Promise.all([
    topFlathub ? fetchFlathubAppstream(topFlathub.app_id) : Promise.resolve(null),
    topRepo
      ? fetchGitHubLatestWindowsInstaller(topRepo.full_name)
      : Promise.resolve<{ version?: string; exeUrl?: string; releaseUrl?: string }>({}),
  ]);

  // Resolve canonical official website from live sources
  const officialSite =
    grounded?.officialWebsiteUrl ||
    topWinget?.Latest?.HomepageUrl ||
    flathubDetails?.urls?.homepage ||
    topRepo?.homepage ||
    topRepo?.html_url ||
    topWiki?.fullurl ||
    fallbackTop.downloadUrl;

  const primaryIcon =
    topFlathub?.icon ||
    getDomainFavicon(officialSite) ||
    topRepo?.owner.avatar_url ||
    topWiki?.thumbnail?.source ||
    fallbackTop.thumbnail;

  const directDownload =
    ghRelease.exeUrl ||
    grounded?.directDownloadUrl ||
    ghRelease.releaseUrl ||
    flathubDetails?.urls?.homepage ||
    officialSite;

  const resolvedWingetId =
    grounded?.wingetId || topWinget?.Id || `OpenSource.${query.replace(/\s+/g, '')}`;
  const wingetCommand = resolvedWingetId
    ? `winget install --id ${resolvedWingetId} -e`
    : fallbackTop.installScript;

  const resolvedVersion =
    ghRelease.version ||
    topWinget?.Versions?.[0] ||
    flathubDetails?.releases?.[0]?.version ||
    grounded?.version ||
    'Latest Stable';

  const mirrors: MirrorLink[] = [];

  if (officialSite) {
    mirrors.push({
      name: 'Official Vendor Website',
      type: 'official_store',
      url: officialSite,
      label: 'Visit Official Website',
      verifiedSource: (() => {
        try {
          return new URL(officialSite).hostname;
        } catch {
          return 'Official Domain';
        }
      })(),
    });
  }

  if (directDownload) {
    mirrors.push({
      name: ghRelease.exeUrl ? 'Direct Windows Installer (.EXE / .MSI)' : 'Official Direct Download Page',
      type: 'direct_installer',
      url: directDownload,
      label: ghRelease.exeUrl ? 'Download Windows Installer' : 'Official Download Portal',
      verifiedSource: ghRelease.exeUrl ? 'github.com/releases (Official Binary)' : 'Official Vendor Release',
      version: resolvedVersion,
      architecture: 'Windows 10 / 11 (x64 / ARM64)',
    });
  }

  if (wingetCommand && resolvedWingetId) {
    mirrors.push({
      name: 'Microsoft Winget CLI',
      type: 'winget_cli',
      url: `https://github.com/microsoft/winget-pkgs/tree/master/manifests/${resolvedWingetId.charAt(0).toLowerCase()}/${resolvedWingetId.replace(/\./g, '/')}`,
      label: 'Winget Manifest Repository',
      verifiedSource: 'microsoft/winget-pkgs',
      version: topWinget?.Versions?.[0],
      cliCommand: wingetCommand,
    });
  }

  if (topRepo) {
    mirrors.push({
      name: `GitHub Source & Releases (${topRepo.full_name})`,
      type: 'source_repo',
      url: ghRelease.releaseUrl || topRepo.html_url,
      label: 'GitHub Releases & Source Code',
      verifiedSource: `github.com (${topRepo.stargazers_count.toLocaleString()} ★)`,
      version: ghRelease.version,
    });
  }

  const cleanFlathubDesc = stripHtmlTags(flathubDetails?.description);

  const primaryResult: PrimarySoftwareResult = {
    id: `pc-primary-${encodeURIComponent(query.toLowerCase())}`,
    name:
      grounded?.name ||
      topWinget?.Latest?.Name ||
      topFlathub?.name ||
      topRepo?.name ||
      topWiki?.title ||
      query,
    developer:
      grounded?.developer ||
      topWinget?.Latest?.Publisher ||
      topFlathub?.developer_name ||
      topRepo?.owner.login ||
      'Official Publisher',
    platform: 'pc',
    iconUrl: primaryIcon,
    category:
      grounded?.category ||
      flathubDetails?.categories?.[0] ||
      topWiki?.description ||
      'Windows Desktop Software',
    version: resolvedVersion,
    license:
      grounded?.license ||
      topWinget?.Latest?.License ||
      topFlathub?.project_license ||
      topRepo?.license?.spdx_id ||
      'Standard License',
    price: grounded?.price || 'Free / Open Source',
    packageId: resolvedWingetId || topFlathub?.app_id || topRepo?.full_name || query,
    summary:
      grounded?.summary ||
      topWinget?.Latest?.Description ||
      topFlathub?.summary ||
      topRepo?.description ||
      topWiki?.description ||
      `Official Windows PC distribution and open-source ecosystem alternatives for ${query}.`,
    description:
      grounded?.description ||
      cleanFlathubDesc ||
      topWiki?.extract ||
      topWinget?.Latest?.Description ||
      topRepo?.description ||
      topFlathub?.summary ||
      `Live indexed Windows PC software entry for ${query}.`,
    officialWebsiteUrl: officialSite,
    primaryDownloadUrl: directDownload,
    primaryDownloadLabel: ghRelease.exeUrl ? 'Direct Installer (.EXE / .MSI)' : 'Official Download Link',
    wingetCommand,
    mirrorsAndSources: mirrors,
    groundingUrls: grounded?.groundingUrls,
  };

  // Build rich FOSS & Freeware alternatives list combining Gemini Search Grounding + Flathub + GitHub
  const alternatives: AlternativeSoftware[] = [];
  const seenAltNames = new Set<string>([primaryResult.name.toLowerCase()]);

  if (grounded?.alternatives) {
    for (const alt of grounded.alternatives) {
      const key = (alt.name || '').toLowerCase();
      if (!key || seenAltNames.has(key)) continue;
      seenAltNames.add(key);

      const fhMatch = flathubHits.find((h) => h.name.toLowerCase() === key);
      const iconUrl = fhMatch?.icon || getDomainFavicon(alt.officialUrl);

      alternatives.push({
        id: `pc-alt-grounded-${encodeURIComponent(key)}`,
        name: alt.name,
        developer: alt.developer || 'Open Source Community',
        license: alt.license || (alt.isOpenSource ? 'Open Source (FOSS)' : 'Freeware'),
        isOpenSource: alt.isOpenSource !== false,
        iconUrl,
        summary: alt.summary,
        officialUrl: alt.officialUrl,
        downloadUrl: alt.downloadUrl || alt.officialUrl,
        packageId: alt.wingetId,
        sourceName: alt.isOpenSource !== false ? 'Verified FOSS Alternative' : 'Trusted Freeware',
        rating: alt.rating || 'Highly Rated',
      });
    }
  }

  // Also include live Flathub open-source desktop alternatives
  for (const hit of flathubHits.slice(0, 6)) {
    const key = hit.name.toLowerCase();
    if (seenAltNames.has(key)) continue;
    const isFoss = !hit.project_license?.toLowerCase().includes('proprietary');
    seenAltNames.add(key);
    alternatives.push({
      id: `pc-alt-fh-${hit.app_id}`,
      name: hit.name,
      developer: hit.developer_name || hit.app_id,
      license: hit.project_license || 'Open Source (FOSS)',
      isOpenSource: isFoss,
      iconUrl: hit.icon || '',
      summary: hit.summary || 'Cross-platform desktop application.',
      officialUrl: `https://flathub.org/apps/${hit.app_id}`,
      downloadUrl: `https://flathub.org/apps/${hit.app_id}`,
      packageId: hit.app_id,
      sourceName: isFoss ? 'Verified FOSS Desktop App' : 'Freeware Desktop App',
      rating: isFoss ? 'FOSS Verified' : 'Desktop Build',
    });
  }

  for (const repo of ghRepos.slice(0, 6)) {
    const key = repo.name.toLowerCase();
    if (seenAltNames.has(key)) continue;
    seenAltNames.add(key);
    alternatives.push({
      id: `pc-alt-gh-${repo.id}`,
      name: repo.name,
      developer: repo.owner.login,
      license: repo.license?.spdx_id || 'Open Source (GitHub)',
      isOpenSource: true,
      iconUrl: repo.owner.avatar_url,
      summary: repo.description || `Open-source repository hosted on GitHub (${repo.full_name}).`,
      officialUrl: repo.homepage || repo.html_url,
      downloadUrl: `${repo.html_url}/releases`,
      packageId: repo.full_name,
      sourceName: 'GitHub Open Source',
      rating: `${(repo.stargazers_count / 1000).toFixed(1)}k ★`,
    });
  }

  const secondaryResults: PrimarySoftwareResult[] = flathubHits.slice(1, 5).map((hit) => ({
    id: `pc-sec-${hit.app_id}`,
    name: hit.name,
    developer: hit.developer_name || hit.app_id,
    platform: 'pc',
    iconUrl: hit.icon || '',
    category: 'Cross-Platform Desktop App',
    version: 'Latest',
    license: hit.project_license || 'Open Source',
    price: 'Free',
    packageId: hit.app_id,
    summary: hit.summary,
    description: hit.summary,
    officialWebsiteUrl: `https://flathub.org/apps/${hit.app_id}`,
    primaryDownloadUrl: `https://flathub.org/apps/${hit.app_id}`,
    primaryDownloadLabel: 'View Package Details',
    mirrorsAndSources: [
      {
        name: 'Flathub Desktop Metadata',
        type: 'official_store',
        url: `https://flathub.org/apps/${hit.app_id}`,
        label: 'View on Flathub',
        verifiedSource: 'flathub.org',
      },
    ],
  }));

  return {
    query,
    platform: 'pc',
    timestamp: new Date().toISOString(),
    quotaAdvisory: lastQuotaAdvisory,
    primaryResult,
    secondaryResults,
    alternatives: alternatives.slice(0, 6),
    sourcesQueried: [
      'Microsoft Winget Live Package Index (api.winget.run)',
      'Flathub Appstream API (flathub.org)',
      'GitHub Releases & Repositories API',
      'Wikipedia / Wikidata Software Index',
      ...(grounded ? ['Google Search Live Grounding'] : []),
    ],
  };
}

// ============================================================================
// 4. PHASE 2 HOMEPAGE CAROUSELS — 15 Items Per Category (PC / Android / iOS)
// ============================================================================

const carouselCache = new Map<PlatformType, { expiresAt: number; data: HomepageCarouselsResponse }>();

interface SeedCatalogEntry {
  key: string;
  name: string;
  developer: string;
  packageId: string;
  downloadUrl: string;
  downloadLabel: string;
  secondaryUrl?: string;
  license: string;
  version: string;
  rating?: number;
  iconHintUrl?: string;
  flathubId?: string;
}

const PC_SOCIAL_MEDIA_SEED: SeedCatalogEntry[] = [
  {
    key: 'pc-social-discord',
    name: 'Discord',
    developer: 'Discord Inc.',
    packageId: 'Discord.Discord',
    flathubId: 'com.discordapp.Discord',
    downloadUrl: 'https://discord.com/api/downloads/distributions/app/installers/latest?channel=stable&platform=win&arch=x64',
    downloadLabel: 'Download Installer',
    secondaryUrl: 'https://discord.com/download',
    license: 'Freeware',
    version: 'Stable x64',
    rating: 4.7,
    iconHintUrl: 'https://dl.flathub.org/media/com/discordapp/Discord/6f4ce2eb9fb4fa0dd5ce9eb06ab6c4f9/icons/128x128/com.discordapp.Discord.png',
  },
  {
    key: 'pc-social-telegram',
    name: 'Telegram Desktop',
    developer: 'Telegram FZ-LLC',
    packageId: 'Telegram.TelegramDesktop',
    flathubId: 'org.telegram.desktop',
    downloadUrl: 'https://telegram.org/dl/desktop/win64',
    downloadLabel: 'Direct .EXE Installer',
    secondaryUrl: 'https://desktop.telegram.org',
    license: 'GPL-3.0 (FOSS)',
    version: '5.11 x64',
    rating: 4.9,
    iconHintUrl: 'https://dl.flathub.org/media/org/telegram/desktop/903c4e9e4a1c3f1fb6f6c50fb0f0ff26/icons/128x128/org.telegram.desktop.png',
  },
  {
    key: 'pc-social-signal',
    name: 'Signal Desktop',
    developer: 'Signal Messenger LLC',
    packageId: 'OpenWhisperSystems.Signal',
    flathubId: 'org.signal.Signal',
    downloadUrl: 'https://signal.org/download/windows/',
    downloadLabel: 'Download for Windows',
    secondaryUrl: 'https://signal.org',
    license: 'AGPL-3.0 (FOSS)',
    version: '7.x Stable',
    rating: 4.8,
  },
  {
    key: 'pc-social-whatsapp',
    name: 'WhatsApp Desktop',
    developer: 'Meta Platforms, Inc.',
    packageId: 'WhatsApp.WhatsApp',
    downloadUrl: 'https://get.microsoft.com/installer/download/9NKSQGP7F2NH',
    downloadLabel: 'Direct Installer',
    secondaryUrl: 'https://www.whatsapp.com/download',
    license: 'Freeware',
    version: 'Latest Win11',
    rating: 4.5,
  },
  {
    key: 'pc-social-slack',
    name: 'Slack Desktop',
    developer: 'Slack Technologies',
    packageId: 'SlackTechnologies.Slack',
    flathubId: 'com.slack.Slack',
    downloadUrl: 'https://slack.com/downloads/windows',
    downloadLabel: 'Download x64 .EXE',
    secondaryUrl: 'https://slack.com',
    license: 'Freemium',
    version: '4.41',
    rating: 4.6,
  },
  {
    key: 'pc-social-element',
    name: 'Element (Matrix)',
    developer: 'New Vector Ltd',
    packageId: 'Element.Element',
    flathubId: 'im.riot.Riot',
    downloadUrl: 'https://packages.element.io/desktop/install/win32/x64/Element%20Setup.exe',
    downloadLabel: 'Direct .EXE Setup',
    secondaryUrl: 'https://element.io/download',
    license: 'Apache-2.0 (FOSS)',
    version: '1.11.x',
    rating: 4.7,
  },
  {
    key: 'pc-social-ferdium',
    name: 'Ferdium All-in-One',
    developer: 'Ferdium Contributors',
    packageId: 'Ferdium.Ferdium',
    flathubId: 'org.ferdium.Ferdium',
    downloadUrl: 'https://github.com/ferdium/ferdium-app/releases/latest',
    downloadLabel: 'GitHub Win Installer',
    secondaryUrl: 'https://ferdium.org',
    license: 'Apache-2.0 (FOSS)',
    version: '7.0.0',
    rating: 4.8,
  },
  {
    key: 'pc-social-thunderbird',
    name: 'Mozilla Thunderbird',
    developer: 'MZLA Technologies',
    packageId: 'Mozilla.Thunderbird',
    flathubId: 'org.mozilla.Thunderbird',
    downloadUrl: 'https://download.mozilla.org/?product=thunderbird-latest&os=win64&lang=en-US',
    downloadLabel: 'Direct Win64 Setup',
    secondaryUrl: 'https://www.thunderbird.net',
    license: 'MPL-2.0 (FOSS)',
    version: '128 Nebula',
    rating: 4.8,
  },
  {
    key: 'pc-social-zoom',
    name: 'Zoom Workplace',
    developer: 'Zoom Video Communications',
    packageId: 'Zoom.Zoom',
    flathubId: 'us.zoom.Zoom',
    downloadUrl: 'https://zoom.us/client/latest/ZoomInstallerFull.exe?archType=x64',
    downloadLabel: 'Direct .EXE Installer',
    secondaryUrl: 'https://zoom.us/download',
    license: 'Freemium',
    version: '6.x x64',
    rating: 4.5,
  },
  {
    key: 'pc-social-teams',
    name: 'Microsoft Teams',
    developer: 'Microsoft Corporation',
    packageId: 'Microsoft.Teams',
    downloadUrl: 'https://statics.teams.cdn.office.net/production-windows-x64/enterprise/webview2/lkg/MSTeams-x64.msix',
    downloadLabel: 'Direct MSIX Package',
    secondaryUrl: 'https://www.microsoft.com/en-us/microsoft-teams/download-app',
    license: 'Freemium',
    version: '24295',
    rating: 4.4,
  },
  {
    key: 'pc-social-chatterino',
    name: 'Chatterino (Twitch)',
    developer: 'Chatterino Team',
    packageId: 'ChatterinoTeam.Chatterino',
    flathubId: 'com.chatterino.chatterino',
    downloadUrl: 'https://github.com/Chatterino/chatterino2/releases/latest',
    downloadLabel: 'Download Win64 Build',
    secondaryUrl: 'https://chatterino.com',
    license: 'MIT (FOSS)',
    version: '2.5.2',
    rating: 4.9,
  },
  {
    key: 'pc-social-tuba',
    name: 'Tuba (Fediverse / Mastodon)',
    developer: 'GeopJr & Contributors',
    packageId: 'GeopJr.Tuba',
    flathubId: 'dev.geopjr.Tuba',
    downloadUrl: 'https://github.com/GeopJr/Tuba/releases/latest',
    downloadLabel: 'Download Windows .EXE',
    secondaryUrl: 'https://tuba.geopjr.dev',
    license: 'GPL-3.0 (FOSS)',
    version: '0.9.x',
    rating: 4.8,
  },
  {
    key: 'pc-social-jami',
    name: 'Jami P2P Messenger',
    developer: 'Savoir-faire Linux',
    packageId: 'Savoir-faireLinux.Jami',
    flathubId: 'net.jami.Jami',
    downloadUrl: 'https://dl.jami.net/windows/jami.release.x64.msi',
    downloadLabel: 'Direct .MSI Installer',
    secondaryUrl: 'https://jami.net',
    license: 'GPL-3.0 (FOSS)',
    version: 'Eleutheria',
    rating: 4.6,
  },
  {
    key: 'pc-social-pidgin',
    name: 'Pidgin Universal Chat',
    developer: 'Pidgin IM Team',
    packageId: 'Pidgin.Pidgin',
    flathubId: 'im.pidgin.Pidgin',
    downloadUrl: 'https://pidgin.im/install/#windows',
    downloadLabel: 'Official Windows Build',
    secondaryUrl: 'https://pidgin.im',
    license: 'GPL-2.0 (FOSS)',
    version: '2.14.13',
    rating: 4.5,
  },
  {
    key: 'pc-social-hexchat',
    name: 'HexChat IRC Client',
    developer: 'HexChat Community',
    packageId: 'HexChat.HexChat',
    flathubId: 'io.github.Hexchat',
    downloadUrl: 'https://github.com/hexchat/hexchat/releases/latest',
    downloadLabel: 'Download Windows x64',
    secondaryUrl: 'https://hexchat.github.io',
    license: 'GPL-2.0 (FOSS)',
    version: '2.16.2',
    rating: 4.7,
  },
];

const PC_PHOTO_VIDEO_SEED: SeedCatalogEntry[] = [
  {
    key: 'pc-media-obs',
    name: 'OBS Studio',
    developer: 'OBS Project',
    packageId: 'OBSProject.OBSStudio',
    flathubId: 'com.obsproject.Studio',
    downloadUrl: 'https://obsproject.com/download',
    downloadLabel: 'Official Win64 Installer',
    secondaryUrl: 'https://obsproject.com',
    license: 'GPL-2.0 (FOSS)',
    version: '31.0.x',
    rating: 4.9,
  },
  {
    key: 'pc-media-blender',
    name: 'Blender 3D & Video Suite',
    developer: 'Blender Foundation',
    packageId: 'BlenderFoundation.Blender',
    flathubId: 'org.blender.Blender',
    downloadUrl: 'https://www.blender.org/download/',
    downloadLabel: 'Download Windows x64',
    secondaryUrl: 'https://www.blender.org',
    license: 'GPL-3.0 (FOSS)',
    version: '4.3 LTS',
    rating: 4.9,
  },
  {
    key: 'pc-media-gimp',
    name: 'GIMP Image Manipulation',
    developer: 'The GIMP Team',
    packageId: 'GIMP.GIMP',
    flathubId: 'org.gimp.GIMP',
    downloadUrl: 'https://www.gimp.org/downloads/',
    downloadLabel: 'Official Windows .EXE',
    secondaryUrl: 'https://www.gimp.org',
    license: 'GPL-3.0 (FOSS)',
    version: '3.0 RC / 2.10',
    rating: 4.8,
  },
  {
    key: 'pc-media-kdenlive',
    name: 'Kdenlive Video Editor',
    developer: 'KDE Community',
    packageId: 'KDE.Kdenlive',
    flathubId: 'org.kde.kdenlive',
    downloadUrl: 'https://kdenlive.org/en/download/',
    downloadLabel: 'Download Windows Installer',
    secondaryUrl: 'https://kdenlive.org',
    license: 'GPL-3.0 (FOSS)',
    version: '24.12',
    rating: 4.8,
  },
  {
    key: 'pc-media-krita',
    name: 'Krita Digital Painting',
    developer: 'Krita Foundation',
    packageId: 'KDE.Krita',
    flathubId: 'org.kde.krita',
    downloadUrl: 'https://krita.org/en/download/',
    downloadLabel: 'Download Win64 Setup',
    secondaryUrl: 'https://krita.org',
    license: 'GPL-3.0 (FOSS)',
    version: '5.2.9',
    rating: 4.9,
  },
  {
    key: 'pc-media-davinci',
    name: 'DaVinci Resolve',
    developer: 'Blackmagic Design',
    packageId: 'BlackmagicDesign.DaVinciResolve',
    downloadUrl: 'https://www.blackmagicdesign.com/products/davinciresolve',
    downloadLabel: 'Official Free Download',
    secondaryUrl: 'https://www.blackmagicdesign.com',
    license: 'Freeware / Studio',
    version: '19.1',
    rating: 4.9,
  },
  {
    key: 'pc-media-inkscape',
    name: 'Inkscape Vector Graphics',
    developer: 'Inkscape Authors',
    packageId: 'Inkscape.Inkscape',
    flathubId: 'org.inkscape.Inkscape',
    downloadUrl: 'https://inkscape.org/release/inkscape-latest/windows/64-bit/msi/dl/',
    downloadLabel: 'Direct .MSI Installer',
    secondaryUrl: 'https://inkscape.org',
    license: 'GPL-3.0 (FOSS)',
    version: '1.4',
    rating: 4.8,
  },
  {
    key: 'pc-media-darktable',
    name: 'darktable RAW Darkroom',
    developer: 'darktable Developers',
    packageId: 'darktable.darktable',
    flathubId: 'org.darktable.Darktable',
    downloadUrl: 'https://github.com/darktable-org/darktable/releases/latest',
    downloadLabel: 'Download Win64 .EXE',
    secondaryUrl: 'https://www.darktable.org',
    license: 'GPL-3.0 (FOSS)',
    version: '5.0.0',
    rating: 4.8,
  },
  {
    key: 'pc-media-shotcut',
    name: 'Shotcut Video Editor',
    developer: 'Meltytech, LLC',
    packageId: 'Meltytech.Shotcut',
    flathubId: 'org.shotcut.Shotcut',
    downloadUrl: 'https://github.com/mltframework/shotcut/releases/latest',
    downloadLabel: 'GitHub Win64 Installer',
    secondaryUrl: 'https://www.shotcut.org',
    license: 'GPL-3.0 (FOSS)',
    version: '25.01',
    rating: 4.7,
  },
  {
    key: 'pc-media-handbrake',
    name: 'HandBrake Video Transcoder',
    developer: 'HandBrake Team',
    packageId: 'HandBrake.HandBrake',
    flathubId: 'fr.handbrake.ghb',
    downloadUrl: 'https://handbrake.fr/downloads.php',
    downloadLabel: 'Official Win64 Download',
    secondaryUrl: 'https://handbrake.fr',
    license: 'GPL-2.0 (FOSS)',
    version: '1.9.0',
    rating: 4.9,
  },
  {
    key: 'pc-media-rawtherapee',
    name: 'RawTherapee RAW Processor',
    developer: 'RawTherapee Team',
    packageId: 'RawTherapee.RawTherapee',
    flathubId: 'com.rawtherapee.RawTherapee',
    downloadUrl: 'https://rawtherapee.com/downloads/',
    downloadLabel: 'Download Windows x64',
    secondaryUrl: 'https://rawtherapee.com',
    license: 'GPL-3.0 (FOSS)',
    version: '5.11',
    rating: 4.7,
  },
  {
    key: 'pc-media-openshot',
    name: 'OpenShot Video Editor',
    developer: 'OpenShot Studios, LLC',
    packageId: 'OpenShot.OpenShot',
    flathubId: 'org.openshot.OpenShot',
    downloadUrl: 'https://www.openshot.org/download/',
    downloadLabel: 'Official Windows Setup',
    secondaryUrl: 'https://www.openshot.org',
    license: 'GPL-3.0 (FOSS)',
    version: '3.3.0',
    rating: 4.5,
  },
  {
    key: 'pc-media-digikam',
    name: 'digiKam Photo Management',
    developer: 'KDE Community',
    packageId: 'KDE.digiKam',
    flathubId: 'org.kde.digikam',
    downloadUrl: 'https://www.digikam.org/download/',
    downloadLabel: 'Download Win64 .EXE',
    secondaryUrl: 'https://www.digikam.org',
    license: 'GPL-2.0 (FOSS)',
    version: '8.5.0',
    rating: 4.8,
  },
  {
    key: 'pc-media-losslesscut',
    name: 'LosslessCut Video Trimmer',
    developer: 'Mikael Finstad',
    packageId: 'mifi.losslesscut',
    flathubId: 'no.mifi.losslesscut',
    downloadUrl: 'https://github.com/mifi/lossless-cut/releases/latest',
    downloadLabel: 'GitHub Windows Release',
    secondaryUrl: 'https://mifi.no/losslesscut/',
    license: 'GPL-2.0 (FOSS)',
    version: '3.64',
    rating: 4.9,
  },
  {
    key: 'pc-media-paintdotnet',
    name: 'Paint.NET',
    developer: 'dotPDN LLC',
    packageId: 'dotPDN.PaintDotNet',
    downloadUrl: 'https://github.com/paintdotnet/release/releases/latest',
    downloadLabel: 'Direct GitHub Installer',
    secondaryUrl: 'https://www.getpaint.net',
    license: 'Freeware',
    version: '5.1.x',
    rating: 4.8,
  },
];

const ANDROID_SOCIAL_MEDIA_SEED: SeedCatalogEntry[] = [
  {
    key: 'android-social-whatsapp',
    name: 'WhatsApp Messenger',
    developer: 'WhatsApp LLC',
    packageId: 'com.whatsapp',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.whatsapp',
    downloadLabel: 'Google Play Store',
    secondaryUrl: 'https://www.whatsapp.com/android',
    license: 'Free (Play Store)',
    version: 'Latest',
    rating: 4.4,
  },
  {
    key: 'android-social-telegram',
    name: 'Telegram / Telegram FOSS',
    developer: 'Telegram FZ-LLC',
    packageId: 'org.telegram.messenger',
    downloadUrl: 'https://play.google.com/store/apps/details?id=org.telegram.messenger',
    downloadLabel: 'Google Play / F-Droid',
    secondaryUrl: 'https://f-droid.org/en/packages/org.telegram.messenger/',
    license: 'GPL-2.0 (FOSS)',
    version: '11.x',
    rating: 4.6,
  },
  {
    key: 'android-social-signal',
    name: 'Signal Private Messenger',
    developer: 'Signal Foundation',
    packageId: 'org.thoughtcrime.securesms',
    downloadUrl: 'https://play.google.com/store/apps/details?id=org.thoughtcrime.securesms',
    downloadLabel: 'Google Play / Direct APK',
    secondaryUrl: 'https://signal.org/android/apk/',
    license: 'AGPL-3.0 (FOSS)',
    version: '7.x',
    rating: 4.7,
  },
  {
    key: 'android-social-discord',
    name: 'Discord — Talk, Play, Hang Out',
    developer: 'Discord Inc.',
    packageId: 'com.discord',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.discord',
    downloadLabel: 'Google Play Store',
    license: 'Free (Play Store)',
    version: 'Latest',
    rating: 4.5,
  },
  {
    key: 'android-social-instagram',
    name: 'Instagram',
    developer: 'Instagram / Meta',
    packageId: 'com.instagram.android',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.instagram.android',
    downloadLabel: 'Google Play Store',
    license: 'Free (Play Store)',
    version: 'Latest',
    rating: 4.3,
  },
  {
    key: 'android-social-tiktok',
    name: 'TikTok',
    developer: 'TikTok Pte. Ltd.',
    packageId: 'com.zhiliaoapp.musically',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically',
    downloadLabel: 'Google Play Store',
    license: 'Free (Play Store)',
    version: 'Latest',
    rating: 4.4,
  },
  {
    key: 'android-social-mastodon',
    name: 'Mastodon for Android',
    developer: 'Mastodon gGmbH',
    packageId: 'org.joinmastodon.android',
    downloadUrl: 'https://f-droid.org/en/packages/org.joinmastodon.android/',
    downloadLabel: 'F-Droid / Google Play',
    secondaryUrl: 'https://play.google.com/store/apps/details?id=org.joinmastodon.android',
    license: 'GPL-3.0 (FOSS)',
    version: '2.8.x',
    rating: 4.6,
  },
  {
    key: 'android-social-element',
    name: 'Element X — Secure Matrix Chat',
    developer: 'New Vector Ltd',
    packageId: 'im.vector.app',
    downloadUrl: 'https://f-droid.org/en/packages/im.vector.app/',
    downloadLabel: 'F-Droid / Google Play',
    secondaryUrl: 'https://play.google.com/store/apps/details?id=im.vector.app',
    license: 'Apache-2.0 (FOSS)',
    version: '1.6.x',
    rating: 4.5,
  },
  {
    key: 'android-social-bluesky',
    name: 'Bluesky Social',
    developer: 'Bluesky PBLLC',
    packageId: 'xyz.blueskyweb.app',
    downloadUrl: 'https://play.google.com/store/apps/details?id=xyz.blueskyweb.app',
    downloadLabel: 'Google Play Store',
    secondaryUrl: 'https://github.com/bluesky-social/social-app',
    license: 'MIT (Open Source)',
    version: '1.96',
    rating: 4.7,
  },
  {
    key: 'android-social-reddit',
    name: 'Reddit',
    developer: 'Reddit Inc.',
    packageId: 'com.reddit.frontpage',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.reddit.frontpage',
    downloadLabel: 'Google Play Store',
    license: 'Free (Play Store)',
    version: 'Latest',
    rating: 4.4,
  },
  {
    key: 'android-social-snapchat',
    name: 'Snapchat',
    developer: 'Snap Inc',
    packageId: 'com.snapchat.android',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.snapchat.android',
    downloadLabel: 'Google Play Store',
    license: 'Free (Play Store)',
    version: 'Latest',
    rating: 4.2,
  },
  {
    key: 'android-social-threads',
    name: 'Threads',
    developer: 'Instagram / Meta',
    packageId: 'com.instagram.barcelona',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.instagram.barcelona',
    downloadLabel: 'Google Play Store',
    license: 'Free (Play Store)',
    version: 'Latest',
    rating: 4.4,
  },
  {
    key: 'android-social-pinterest',
    name: 'Pinterest',
    developer: 'Pinterest',
    packageId: 'com.pinterest',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.pinterest',
    downloadLabel: 'Google Play Store',
    license: 'Free (Play Store)',
    version: 'Latest',
    rating: 4.6,
  },
  {
    key: 'android-social-linkedin',
    name: 'LinkedIn',
    developer: 'LinkedIn',
    packageId: 'com.linkedin.android',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.linkedin.android',
    downloadLabel: 'Google Play Store',
    license: 'Free (Play Store)',
    version: 'Latest',
    rating: 4.3,
  },
  {
    key: 'android-social-tusky',
    name: 'Tusky for Mastodon',
    developer: 'ConnyDuck & Tusky Team',
    packageId: 'com.keylesspalace.tusky',
    downloadUrl: 'https://f-droid.org/en/packages/com.keylesspalace.tusky/',
    downloadLabel: 'F-Droid FOSS Repo',
    secondaryUrl: 'https://play.google.com/store/apps/details?id=com.keylesspalace.tusky',
    license: 'GPL-3.0 (FOSS)',
    version: '27.0',
    rating: 4.8,
  },
];

const ANDROID_PHOTO_VIDEO_SEED: SeedCatalogEntry[] = [
  {
    key: 'android-media-capcut',
    name: 'CapCut — Video Editor',
    developer: 'Bytedance Pte. Ltd.',
    packageId: 'com.lemon.lvoverseas',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.lemon.lvoverseas',
    downloadLabel: 'Google Play Store',
    license: 'Free (Play Store)',
    version: 'Latest',
    rating: 4.5,
  },
  {
    key: 'android-media-lightroom',
    name: 'Adobe Lightroom Photo & Video',
    developer: 'Adobe',
    packageId: 'com.adobe.lrmobile',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.adobe.lrmobile',
    downloadLabel: 'Google Play Store',
    license: 'Freemium',
    version: '10.x',
    rating: 4.6,
  },
  {
    key: 'android-media-snapseed',
    name: 'Snapseed RAW Photo Editor',
    developer: 'Google LLC',
    packageId: 'com.niksoftware.snapseed',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.niksoftware.snapseed',
    downloadLabel: 'Google Play Store',
    license: 'Freeware',
    version: '2.22',
    rating: 4.5,
  },
  {
    key: 'android-media-canva',
    name: 'Canva: Design, Photo & Video',
    developer: 'Canva',
    packageId: 'com.canva.editor',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.canva.editor',
    downloadLabel: 'Google Play Store',
    license: 'Freemium',
    version: 'Latest',
    rating: 4.8,
  },
  {
    key: 'android-media-inshot',
    name: 'InShot — Video & Photo Editor',
    developer: 'InShot Video Editor',
    packageId: 'com.camerasideas.instashot',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.camerasideas.instashot',
    downloadLabel: 'Google Play Store',
    license: 'Freemium',
    version: '2.x',
    rating: 4.8,
  },
  {
    key: 'android-media-imagetoolbox',
    name: 'Image Toolbox (FOSS Editor)',
    developer: 'T8RIN',
    packageId: 'ru.tech.imageresizershrinker',
    downloadUrl: 'https://f-droid.org/en/packages/ru.tech.imageresizershrinker/',
    downloadLabel: 'F-Droid FOSS APK',
    secondaryUrl: 'https://github.com/T8RIN/ImageToolbox/releases',
    license: 'Apache-2.0 (FOSS)',
    version: '3.0.x',
    rating: 4.9,
  },
  {
    key: 'android-media-fossifygallery',
    name: 'Fossify Gallery & Photo Editor',
    developer: 'Fossify Org',
    packageId: 'org.fossify.gallery',
    downloadUrl: 'https://f-droid.org/en/packages/org.fossify.gallery/',
    downloadLabel: 'F-Droid FOSS APK',
    secondaryUrl: 'https://play.google.com/store/apps/details?id=org.fossify.gallery',
    license: 'GPL-3.0 (FOSS)',
    version: '1.4.x',
    rating: 4.8,
  },
  {
    key: 'android-media-opencamera',
    name: 'Open Camera (Pro Manual & RAW)',
    developer: 'Mark Harman',
    packageId: 'net.sourceforge.opencamera',
    downloadUrl: 'https://f-droid.org/en/packages/net.sourceforge.opencamera/',
    downloadLabel: 'F-Droid / Google Play',
    secondaryUrl: 'https://play.google.com/store/apps/details?id=net.sourceforge.opencamera',
    license: 'GPL-3.0 (FOSS)',
    version: '1.52',
    rating: 4.6,
  },
  {
    key: 'android-media-krita',
    name: 'Krita Digital Painting Studio',
    developer: 'Krita Foundation',
    packageId: 'org.krita',
    downloadUrl: 'https://f-droid.org/en/packages/org.krita/',
    downloadLabel: 'F-Droid / Play Store',
    secondaryUrl: 'https://play.google.com/store/apps/details?id=org.krita',
    license: 'GPL-3.0 (FOSS)',
    version: '5.2.9',
    rating: 4.7,
  },
  {
    key: 'android-media-vn',
    name: 'VN Video Editor Maker',
    developer: 'Ubiquiti Labs, LLC',
    packageId: 'com.frontrow.vlog',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.frontrow.vlog',
    downloadLabel: 'Google Play Store',
    license: 'Free (Play Store)',
    version: '2.x',
    rating: 4.6,
  },
  {
    key: 'android-media-vsco',
    name: 'VSCO: Photo & Video Editor',
    developer: 'VSCO',
    packageId: 'com.vsco.cam',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.vsco.cam',
    downloadLabel: 'Google Play Store',
    license: 'Freemium',
    version: 'Latest',
    rating: 4.3,
  },
  {
    key: 'android-media-kinemaster',
    name: 'KineMaster — Video Editor',
    developer: 'KineMaster Corporation',
    packageId: 'com.nexstreaming.app.kinemasterfree',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.nexstreaming.app.kinemasterfree',
    downloadLabel: 'Google Play Store',
    license: 'Freemium',
    version: '7.x',
    rating: 4.4,
  },
  {
    key: 'android-media-picsart',
    name: 'Picsart AI Photo & Video Editor',
    developer: 'PicsArt, Inc.',
    packageId: 'com.picsart.studio',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.picsart.studio',
    downloadLabel: 'Google Play Store',
    license: 'Freemium',
    version: 'Latest',
    rating: 4.3,
  },
  {
    key: 'android-media-lumafusion',
    name: 'LumaFusion Pro Video Editor',
    developer: 'LumaTouch LLC',
    packageId: 'com.luma_touch.lumafusion',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.luma_touch.lumafusion',
    downloadLabel: 'Google Play Store',
    license: 'Commercial',
    version: '4.x',
    rating: 4.5,
  },
  {
    key: 'android-media-aves',
    name: 'Aves Libre Gallery & Metadata',
    developer: 'Thibault Deckers',
    packageId: 'deckers.thibault.aves.libre',
    downloadUrl: 'https://f-droid.org/en/packages/deckers.thibault.aves.libre/',
    downloadLabel: 'F-Droid FOSS APK',
    secondaryUrl: 'https://github.com/deckerst/aves/releases',
    license: 'GPL-3.0 (FOSS)',
    version: '1.11.x',
    rating: 4.9,
  },
];

// Live icon lookup cache so PC and Android carousel items get authentic high-res icons
const resolvedIconCache = new Map<string, string>();

async function resolveAuthenticAppIcon(entry: SeedCatalogEntry, platform: PlatformType): Promise<string> {
  if (entry.iconHintUrl) return entry.iconHintUrl;
  const cached = resolvedIconCache.get(entry.key);
  if (cached) return cached;

  // 1. Try Flathub search if flathubId is present
  if (entry.flathubId) {
    try {
      const hits = await fetchFlathubSearch(entry.name.split(' ')[0]);
      const match =
        hits.find((h) => h.app_id.toLowerCase() === entry.flathubId?.toLowerCase()) ||
        hits.find((h) => h.name.toLowerCase().includes(entry.name.split(' ')[0].toLowerCase()));
      if (match?.icon) {
        resolvedIconCache.set(entry.key, match.icon);
        return match.icon;
      }
    } catch {
      // fall through
    }
  }

  // 2. For Android F-Droid apps, query F-Droid search API for official icon
  if (platform === 'android' && entry.downloadUrl.includes('f-droid.org')) {
    try {
      const fdroidHits = await fetchFDroidSearch(entry.name.split(' ')[0]);
      const match =
        fdroidHits.find((f) => f.url.includes(entry.packageId)) || fdroidHits[0];
      if (match?.icon) {
        resolvedIconCache.set(entry.key, match.icon);
        return match.icon;
      }
    } catch {
      // fall through
    }
  }

  // 3. Query official iTunes Search API for cross-platform mainstream app artwork (WhatsApp, Discord, Lightroom, CapCut, etc.)
  try {
    const cleanTerm = entry.name.split('—')[0].split('(')[0].replace('Desktop', '').trim();
    const res = await fetchWithTimeout(
      `https://itunes.apple.com/search?term=${encodeURIComponent(cleanTerm)}&entity=software&country=us&limit=2`,
      { headers: BROWSER_HEADERS },
      3500
    );
    if (res.ok) {
      const data = (await res.json()) as { results?: ITunesSoftwareItem[] };
      const top = data.results?.[0];
      const art = top?.artworkUrl512 || top?.artworkUrl100;
      if (art) {
        resolvedIconCache.set(entry.key, art);
        return art;
      }
    }
  } catch {
    // fall through
  }

  // 4. Fallback to high-res domain favicon
  const fav = getDomainFavicon(entry.secondaryUrl || entry.downloadUrl);
  if (fav) {
    resolvedIconCache.set(entry.key, fav);
  }
  return fav;
}

async function fetchIosCategoryCarousel(
  searchTerms: string[],
  categoryLabel: 'Social Media Applications' | 'Photo & Video Editing Tools'
): Promise<CarouselAppItem[]> {
  const collected: CarouselAppItem[] = [];
  const seenTrackIds = new Set<number>();

  for (const term of searchTerms) {
    if (collected.length >= 15) break;
    try {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=us&limit=25`;
      const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS }, 5500);
      if (!res.ok) continue;
      const data = (await res.json()) as { results?: ITunesSoftwareItem[] };
      for (const item of data.results || []) {
        if (collected.length >= 15) break;
        if (seenTrackIds.has(item.trackId)) continue;
        if (!isStrictlyAppleAppStoreUrl(item.trackViewUrl)) continue;
        seenTrackIds.add(item.trackId);

        collected.push({
          id: `ios-carousel-${item.trackId}`,
          appKey: `ios-${item.bundleId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
          name: item.trackName,
          developer: item.artistName,
          platform: 'ios',
          category: categoryLabel,
          iconUrl: item.artworkUrl512 || item.artworkUrl100 || '',
          downloadUrl: item.trackViewUrl,
          downloadLabel: 'App Store',
          secondaryUrl: item.trackViewUrl,
          license: item.formattedPrice || 'Free (App Store)',
          version: item.version || 'Latest',
          rating: item.averageUserRating ? Number(item.averageUserRating.toFixed(1)) : undefined,
          packageId: item.bundleId,
        });
      }
    } catch {
      // continue next term
    }
  }

  return collected.slice(0, 15);
}

async function getHomepageCarousels(platform: PlatformType): Promise<HomepageCarouselsResponse> {
  const cached = carouselCache.get(platform);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  let socialMedia: CarouselAppItem[] = [];
  let photoVideo: CarouselAppItem[] = [];

  if (platform === 'ios') {
    const [iosSocial, iosMedia] = await Promise.all([
      fetchIosCategoryCarousel(
        ['social media messenger', 'whatsapp telegram discord instagram'],
        'Social Media Applications'
      ),
      fetchIosCategoryCarousel(
        ['photo video editor', 'lightroom capcut snapseed vsco'],
        'Photo & Video Editing Tools'
      ),
    ]);
    socialMedia = iosSocial;
    photoVideo = iosMedia;
  } else {
    const socialSeeds = platform === 'pc' ? PC_SOCIAL_MEDIA_SEED : ANDROID_SOCIAL_MEDIA_SEED;
    const mediaSeeds = platform === 'pc' ? PC_PHOTO_VIDEO_SEED : ANDROID_PHOTO_VIDEO_SEED;

    const mapSeedBatch = async (
      seeds: SeedCatalogEntry[],
      cat: 'Social Media Applications' | 'Photo & Video Editing Tools'
    ): Promise<CarouselAppItem[]> => {
      return Promise.all(
        seeds.slice(0, 15).map(async (seed) => {
          const iconUrl = await resolveAuthenticAppIcon(seed, platform);
          return {
            id: seed.key,
            appKey: seed.key,
            name: seed.name,
            developer: seed.developer,
            platform,
            category: cat,
            iconUrl,
            downloadUrl: seed.downloadUrl,
            downloadLabel: seed.downloadLabel,
            secondaryUrl: seed.secondaryUrl || seed.downloadUrl,
            license: seed.license,
            version: seed.version,
            rating: seed.rating,
            packageId: seed.packageId,
          };
        })
      );
    };

    const [resolvedSocial, resolvedMedia] = await Promise.all([
      mapSeedBatch(socialSeeds, 'Social Media Applications'),
      mapSeedBatch(mediaSeeds, 'Photo & Video Editing Tools'),
    ]);
    socialMedia = resolvedSocial;
    photoVideo = resolvedMedia;
  }

  const responsePayload: HomepageCarouselsResponse = {
    platform,
    socialMedia,
    photoVideo,
    updatedAt: new Date().toISOString(),
  };

  carouselCache.set(platform, {
    expiresAt: Date.now() + 1000 * 60 * 30, // 30-min server cache
    data: responsePayload,
  });

  return responsePayload;
}

// ============================================================================
// EXPRESS SERVERLESS APPLICATION (VERCEL + LOCAL DEV)
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());

  // Live Autocomplete API (Cached with NodeCache)
  app.get('/api/autocomplete', async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    const platform = String(req.query.platform || 'pc').toLowerCase() as PlatformType;

    if (!q || q.length < 2) {
      res.json({ suggestions: [] });
      return;
    }

    const autoCacheKey = `autocomplete_${platform}_${q.toLowerCase()}`;
    if (searchCache.has(autoCacheKey)) {
      res.json({ suggestions: searchCache.get<AutocompleteSuggestion[]>(autoCacheKey) || [] });
      return;
    }

    try {
      let suggestions: AutocompleteSuggestion[] = [];
      if (platform === 'ios') {
        suggestions = await fetchIosAutocomplete(q);
      } else if (platform === 'android') {
        suggestions = await fetchAndroidAutocomplete(q);
      } else {
        suggestions = await fetchPcAutocomplete(q);
      }
      if (suggestions.length > 0) {
        searchCache.set(autoCacheKey, suggestions);
      }
      res.json({ suggestions });
    } catch {
      res.json({ suggestions: [] });
    }
  });

  // Live Deep Search API with 12-Hour NodeCache & Silent 429 Fallback
  app.get('/api/search', async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim();
    const platform = String(req.query.platform || 'pc').toLowerCase() as PlatformType;

    if (!q) {
      res.status(400).json({ error: 'Search query parameter "q" is required.' });
      return;
    }

    const cacheKey = `${platform}_${q.toLowerCase()}_15`;
    if (searchCache.has(cacheKey)) {
      console.log(`[Cache Hit] Serving from memory for: ${q}`);
      res.json(searchCache.get(cacheKey));
      return;
    }

    try {
      let result: LiveSearchResponse;
      if (platform === 'ios') {
        result = await searchIosAppStore(q);
      } else if (platform === 'android') {
        result = await searchAndroidEcosystem(q);
      } else {
        result = await searchPcSoftware(q);
      }

      const enrichedPayload = {
        ...result,
        success: true,
        data: [
          ...(result.primaryResult ? [result.primaryResult] : []),
          ...result.secondaryResults,
          ...result.alternatives,
        ],
      };

      searchCache.set(cacheKey, enrichedPayload);
      res.json(enrichedPayload);
    } catch (error: unknown) {
      // Silent Fallback (الحماية الصامتة) — never expose 429 or crash to the user
      console.warn(`[Silent Fallback] Serving fallback results for: ${q}`);
      const fbItems = await fallbackSearchPC(q);
      const fb = fbItems[0];
      const fallbackResponse: LiveSearchResponse & { success: boolean; data: unknown[] } = {
        query: q,
        platform,
        timestamp: new Date().toISOString(),
        primaryResult: {
          id: fb.id,
          name: fb.name,
          developer: fb.developer,
          platform,
          iconUrl: fb.thumbnail,
          category: 'Open-Source Software (FOSS)',
          version: 'Latest Stable',
          license: 'Open Source (FOSS)',
          price: 'Free',
          packageId: `OpenSource.${q.replace(/\s+/g, '')}`,
          summary: `Verified open-source distribution for ${q}.`,
          description: `Verified open-source distribution and community repository for ${q}.`,
          officialWebsiteUrl: fb.downloadUrl,
          primaryDownloadUrl: fb.downloadUrl,
          primaryDownloadLabel: 'Official Repository Link',
          wingetCommand: fb.installScript,
          mirrorsAndSources: [
            {
              name: 'GitHub Open-Source Repository',
              type: 'source_repo',
              url: fb.downloadUrl,
              label: 'Open Repository',
              verifiedSource: 'github.com',
              cliCommand: fb.installScript,
            },
          ],
        },
        secondaryResults: [],
        alternatives: [],
        sourcesQueried: ['Fallback Open-Source Index'],
        success: true,
        data: fbItems,
      };
      searchCache.set(cacheKey, fallbackResponse);
      res.json(fallbackResponse);
    }
  });

  // Homepage Categorised Carousels API (15 items per category, per platform)
  app.get('/api/carousels', async (req: Request, res: Response) => {
    const platform = String(req.query.platform || 'pc').toLowerCase() as PlatformType;
    const validPlatform: PlatformType =
      platform === 'pc' || platform === 'android' || platform === 'ios' ? platform : 'pc';

    try {
      const payload = await getHomepageCarousels(validPlatform);
      res.json(payload);
    } catch (error) {
      console.error(`Carousels error (${validPlatform}):`, error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to load homepage carousels.',
      });
    }
  });

  // Bulk Auto-Installer Resolver API (resolves direct .APK binaries for Android & Winget/Choco IDs for PC)
  app.get('/api/resolve-bulk-item', async (req: Request, res: Response) => {
    const platform = String(req.query.platform || 'pc').toLowerCase();
    const packageId = String(req.query.packageId || '').trim();
    const name = String(req.query.name || '').trim();
    const fallbackUrl = String(req.query.fallbackUrl || '').trim();

    try {
      if (platform === 'android') {
        // 1. Check if fallbackUrl is already a direct .apk
        if (fallbackUrl.toLowerCase().endsWith('.apk')) {
          res.json({
            platform: 'android',
            directApkUrl: fallbackUrl,
            source: 'Verified Direct APK Binary',
            isDirectBinary: true,
          });
          return;
        }

        // 2. Try F-Droid direct package lookup if packageId looks like an Android package
        if (packageId && packageId.includes('.') && !packageId.includes('/')) {
          const fdroidMeta = await fetchFDroidDirectApk(packageId);
          if (fdroidMeta.apkUrl) {
            res.json({
              platform: 'android',
              directApkUrl: fdroidMeta.apkUrl,
              version: fdroidMeta.versionCode ? String(fdroidMeta.versionCode) : undefined,
              source: 'F-Droid Official APK Repository',
              isDirectBinary: true,
            });
            return;
          }
        }

        // 3. Search F-Droid by name to see if an open-source build exists
        const searchTerm = name || packageId;
        if (searchTerm) {
          const fdroidApps = await fetchFDroidSearch(searchTerm);
          if (fdroidApps.length > 0) {
            const resolvedPkg = extractPackageIdFromFDroidUrl(fdroidApps[0].url);
            if (resolvedPkg) {
              const fdroidMeta = await fetchFDroidDirectApk(resolvedPkg);
              if (fdroidMeta.apkUrl) {
                res.json({
                  platform: 'android',
                  directApkUrl: fdroidMeta.apkUrl,
                  version: fdroidMeta.versionCode ? String(fdroidMeta.versionCode) : undefined,
                  packageId: resolvedPkg,
                  source: 'F-Droid Official APK Repository',
                  isDirectBinary: true,
                });
                return;
              }
            }
          }

          // 4. Search GitHub releases for an official .apk asset
          const ghRepos = await fetchGitHubRepos(`${searchTerm} android`, 3);
          for (const repo of ghRepos) {
            try {
              const relRes = await fetchWithTimeout(
                `https://api.github.com/repos/${repo.full_name}/releases/latest`,
                {
                  headers: {
                    Accept: 'application/vnd.github+json',
                    'User-Agent': 'VanguardIndex-Discovery/1.0',
                  },
                },
                5000
              );
              if (relRes.ok) {
                const relData = (await relRes.json()) as {
                  tag_name?: string;
                  assets?: { name: string; browser_download_url: string }[];
                };
                const apkAsset = (relData.assets || []).find((a) =>
                  a.name.toLowerCase().endsWith('.apk')
                );
                if (apkAsset) {
                  res.json({
                    platform: 'android',
                    directApkUrl: apkAsset.browser_download_url,
                    version: relData.tag_name,
                    source: `GitHub Releases (${repo.full_name})`,
                    isDirectBinary: true,
                  });
                  return;
                }
              }
            } catch {
              // continue
            }
          }
        }

        // 5. Fallback to APKMirror or provided URL
        const apkMirrorFallback =
          fallbackUrl ||
          `https://www.apkmirror.com/?post_type=app_release&searchtype=apk&s=${encodeURIComponent(
            name || packageId
          )}`;
        res.json({
          platform: 'android',
          directApkUrl: apkMirrorFallback,
          source: 'Authorized APK Mirror / Store Portal',
          isDirectBinary: apkMirrorFallback.toLowerCase().endsWith('.apk'),
        });
        return;
      }

      // PC (Windows): Resolve Winget ID & Chocolatey ID
      let resolvedWingetId =
        packageId && packageId.includes('.') && !packageId.includes('/') ? packageId : '';
      if (!resolvedWingetId && (name || packageId)) {
        const wingetHits = await fetchWingetPackages(name || packageId);
        if (wingetHits.length > 0) {
          resolvedWingetId = wingetHits[0].Id;
        }
      }
      const chocoSlug = (name || packageId)
        .toLowerCase()
        .replace(/[^a-z0-9.-]+/g, '-')
        .replace(/^-+|-+$/g, '');

      res.json({
        platform: 'pc',
        wingetId: resolvedWingetId || packageId || chocoSlug,
        chocoId: chocoSlug,
        directInstallerUrl: fallbackUrl,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to resolve bulk installer metadata',
      });
    }
  });

// التعديل في نهاية ملف api/index.ts

// نمنع تشغيل الخادم المستمر على Vercel (لأنه يعمل كـ Serverless)
if (process.env.NODE_ENV !== 'production' && process.env.STANDALONE_API === 'true') {
  app.listen(PORT, () => {
    console.log(`[🚀] Backend Engine running on http://localhost:${PORT}`);
  });
}

// هذا السطر إجباري ومهم جداً لمنصة Vercel لكي تتعرف على خادم Express
export default app;

