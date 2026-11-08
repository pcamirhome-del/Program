export type PlatformType = 'pc' | 'android' | 'ios';

export interface AutocompleteSuggestion {
  id: string;
  name: string;
  developer: string;
  iconUrl: string;
  platform: PlatformType;
  category: string;
  packageId?: string;
  rating?: number;
  price?: string;
  url?: string;
  sourceBadge: string;
}

export interface AlternativeSoftware {
  id: string;
  name: string;
  developer: string;
  license: string;
  isOpenSource: boolean;
  iconUrl: string;
  summary: string;
  officialUrl: string;
  downloadUrl: string;
  packageId?: string;
  sourceName: string;
  rating?: string;
}

export interface MirrorLink {
  name: string;
  type: 'official_store' | 'direct_installer' | 'fdroid_repo' | 'fdroid_apk' | 'authorized_mirror' | 'source_repo' | 'winget_cli';
  url: string;
  label: string;
  verifiedSource: string;
  version?: string;
  architecture?: string;
  cliCommand?: string;
}

export interface PrimarySoftwareResult {
  id: string;
  name: string;
  developer: string;
  platform: PlatformType;
  iconUrl: string;
  category: string;
  version: string;
  license: string;
  price: string;
  rating?: number;
  ratingCount?: number;
  fileSize?: string;
  minOsVersion?: string;
  packageId: string;
  summary: string;
  description: string;
  releaseNotes?: string;
  lastUpdated?: string;
  officialWebsiteUrl?: string;
  primaryDownloadUrl: string;
  primaryDownloadLabel: string;
  wingetCommand?: string;
  screenshots?: string[];
  mirrorsAndSources: MirrorLink[];
  groundingUrls?: { title: string; uri: string }[];
}

export interface LiveSearchResponse {
  query: string;
  platform: PlatformType;
  timestamp: string;
  strictModeNotice?: string;
  quotaAdvisory?: string;
  primaryResult: PrimarySoftwareResult | null;
  secondaryResults: PrimarySoftwareResult[];
  alternatives: AlternativeSoftware[];
  sourcesQueried: string[];
}

export interface SavedSoftwareRecord {
  id: string;
  appKey: string;
  ownerId: string;
  platform: PlatformType;
  name: string;
  developer: string;
  iconUrl: string;
  primaryUrl: string;
  secondaryUrl: string;
  category: string;
  license: string;
  version: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchHistoryRecord {
  id: string;
  query: string;
  platform: PlatformType;
  ownerId: string;
  resultCount: number;
  topResultName: string;
  topResultIcon: string;
  createdAt: string;
}

export interface CarouselAppItem {
  id: string;
  appKey: string;
  name: string;
  developer: string;
  platform: PlatformType;
  category: 'Social Media Applications' | 'Photo & Video Editing Tools';
  iconUrl: string;
  downloadUrl: string;
  downloadLabel: string;
  secondaryUrl?: string;
  license: string;
  version: string;
  rating?: number;
  packageId: string;
}

export interface HomepageCarouselsResponse {
  platform: PlatformType;
  socialMedia: CarouselAppItem[];
  photoVideo: CarouselAppItem[];
  updatedAt: string;
}

export interface BulkInstallItem {
  id: string;
  appKey: string;
  platform: 'pc' | 'android';
  name: string;
  developer: string;
  iconUrl: string;
  packageId: string;
  version: string;
  license: string;
  primaryDownloadUrl: string;
  directApkUrl?: string;
  wingetId?: string;
  chocoId?: string;
  addedAt: string;
}


