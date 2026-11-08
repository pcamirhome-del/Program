import React, { useState, useEffect, useRef } from 'react';
import { Search, ChevronDown, Loader2, X, ArrowRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import type { AutocompleteSuggestion, PlatformType } from '../types.ts';
import { AppIcon } from './AppIcon.tsx';

interface SearchBarWithAutocompleteProps {
  query: string;
  onQueryChange: (val: string) => void;
  platform: PlatformType;
  onPlatformChange: (platform: PlatformType) => void;
  onSubmitSearch: (searchQuery: string, targetPlatform?: PlatformType) => void;
  isSearching: boolean;
}

const PLATFORM_OPTIONS: { value: PlatformType; label: string; shortDesc: string }[] = [
  {
    value: 'pc',
    label: 'PC (Windows)',
    shortDesc: 'Official vendor site, direct installer, Winget & FOSS alternatives',
  },
  {
    value: 'android',
    label: 'Android',
    shortDesc: 'Google Play Store, F-Droid FOSS repo & verified APK mirrors',
  },
  {
    value: 'ios',
    label: 'iOS (iPhone)',
    shortDesc: 'Strictly official Apple App Store APIs only',
  },
];

export const SearchBarWithAutocomplete: React.FC<SearchBarWithAutocompleteProps> = ({
  query,
  onQueryChange,
  platform,
  onPlatformChange,
  onSubmitSearch,
  isSearching,
}) => {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close autocomplete dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced live autocomplete query
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setIsLoadingSuggestions(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setIsLoadingSuggestions(true);
      try {
        const res = await fetch(
          `/api/autocomplete?q=${encodeURIComponent(trimmed)}&platform=${encodeURIComponent(platform)}`,
          { signal: controller.signal }
        );
        if (res.ok) {
          const data = (await res.json()) as { suggestions?: AutocompleteSuggestion[] };
          setSuggestions(data.suggestions || []);
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setSuggestions([]);
        }
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 220);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, platform]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || suggestions.length === 0) {
      if (e.key === 'Enter' && query.trim()) {
        e.preventDefault();
        setShowDropdown(false);
        onSubmitSearch(query.trim(), platform);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        const picked = suggestions[activeIndex];
        onQueryChange(picked.name);
        setShowDropdown(false);
        onSubmitSearch(picked.name, picked.platform);
      } else if (query.trim()) {
        setShowDropdown(false);
        onSubmitSearch(query.trim(), platform);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const handleSuggestionSelect = (item: AutocompleteSuggestion) => {
    onQueryChange(item.name);
    setShowDropdown(false);
    onSubmitSearch(item.name, item.platform);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-4xl mx-auto">
      {/* Unified Search Bar with Platform Dropdown */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) {
            setShowDropdown(false);
            onSubmitSearch(query.trim(), platform);
          }
        }}
        className="relative flex flex-col sm:flex-row items-stretch bg-[#0F172A]/85 backdrop-blur-xl border border-sky-400/30 focus-within:border-sky-400/75 focus-within:shadow-[0_0_28px_rgba(56,189,248,0.18)] rounded-2xl transition-all duration-150"
      >
        {/* Platform Selector Dropdown */}
        <div className="relative flex items-center border-b sm:border-b-0 sm:border-e border-slate-800/90 shrink-0">
          <label htmlFor="platform-select" className="sr-only">
            Target Platform
          </label>
          <select
            id="platform-select"
            value={platform}
            onChange={(e) => {
              const nextPlatform = e.target.value as PlatformType;
              onPlatformChange(nextPlatform);
              setActiveIndex(-1);
              if (query.trim().length >= 2) {
                setShowDropdown(true);
              }
            }}
            className="w-full sm:w-auto appearance-none bg-transparent text-slate-100 font-medium text-base ps-5 pe-11 py-4 cursor-pointer focus:outline-none hover:bg-slate-800/40 rounded-t-2xl sm:rounded-s-2xl sm:rounded-te-none transition-colors"
          >
            {PLATFORM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#0B1120] text-slate-100">
                {t(`platforms.${opt.value}`)} ({opt.label})
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-sky-400 pointer-events-none absolute end-4" />
        </div>

        {/* Search Input (min 16px text-base to prevent iOS Safari zoom) */}
        <div className="relative flex-1 flex items-center">
          <Search className="w-5 h-5 text-slate-400 ms-4 shrink-0 pointer-events-none" />
          <input
            type="text"
            value={query}
            onFocus={() => setShowDropdown(true)}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setActiveIndex(-1);
              setShowDropdown(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            aria-autocomplete="list"
            aria-expanded={showDropdown}
            className="w-full bg-transparent text-slate-100 placeholder-slate-400 text-base px-4 py-4 focus:outline-none"
          />

          {isLoadingSuggestions && (
            <Loader2 className="w-5 h-5 text-sky-400 animate-spin me-3 shrink-0" />
          )}

          {query.length > 0 && !isLoadingSuggestions && (
            <button
              type="button"
              onClick={() => {
                onQueryChange('');
                setSuggestions([]);
              }}
              aria-label="Clear search query"
              className="p-2 me-1 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Submit Action Button */}
        <div className="p-2 flex items-center shrink-0">
          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="w-full sm:w-auto px-6 py-3 bg-sky-500 hover:bg-sky-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-semibold text-base rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isSearching ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Scanning Live</span>
              </>
            ) : (
              <>
                <span>Search Live</span>
                <ArrowRight className="w-4 h-4 rtl:rotate-180" />
              </>
            )}
          </button>
        </div>
      </form>

      {/* Live Autocomplete Suggestions Dropdown with Authentic Thumbnails */}
      <AnimatePresence>
        {showDropdown && query.trim().length >= 2 && (suggestions.length > 0 || isLoadingSuggestions) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="absolute left-0 right-0 mt-2 bg-[#0B1325]/95 backdrop-blur-2xl border border-sky-400/30 rounded-2xl shadow-2xl overflow-hidden z-40"
          >
            <div className="px-4 py-2.5 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <span>
                Live {PLATFORM_OPTIONS.find((p) => p.value === platform)?.label} Suggestions
              </span>
              <span className="font-mono tabular-nums">
                {isLoadingSuggestions
                  ? 'Querying live endpoints...'
                  : `${suggestions.length} live matches`}
              </span>
            </div>

            <div className="divide-y divide-slate-800/60 max-h-96 overflow-y-auto">
              {suggestions.map((item, index) => {
                const isSelected = index === activeIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSuggestionSelect(item)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3.5 transition-colors cursor-pointer ${
                      isSelected ? 'bg-sky-500/15' : 'hover:bg-slate-800/50'
                    }`}
                  >
                    <AppIcon
                      src={item.iconUrl}
                      name={item.name}
                      platform={item.platform}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-100 text-base truncate">
                          {item.name}
                        </span>
                      </div>
                      {/* Zero-Pill Metadata Discipline: Clean unboxed inline text with · separators */}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 truncate mt-0.5">
                        <span className="truncate">{item.developer}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate">{item.category}</span>
                        {item.rating !== undefined && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums text-sky-300">
                              {item.rating.toFixed(1)} ★
                            </span>
                          </>
                        )}
                        {item.price && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{item.price}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0 hidden sm:block">
                      <span className="text-xs font-mono text-slate-400">
                        {item.sourceBadge}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
