import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Download,
  Check,
  Copy,
  Trash2,
  Play,
  Pause,
  RotateCcw,
  Monitor,
  Smartphone,
  FileCode,
  CheckCircle2,
  Loader2,
  ExternalLink,
  ChevronUp,
  ChevronDown,
  X,
  Sparkles,
} from 'lucide-react';
import type { BulkInstallItem } from '../types.ts';
import { AppIcon } from './AppIcon.tsx';
import { useTranslation } from 'react-i18next';

interface AutoInstallerEngineProps {
  items: BulkInstallItem[];
  onRemoveItem: (appKey: string) => void;
  onClearPlatform: (platform: 'pc' | 'android' | 'all') => void;
  onUpdateItemMeta: (appKey: string, patch: Partial<BulkInstallItem>) => void;
}

type PcPackageManager = 'winget' | 'chocolatey' | 'hybrid';
type PcScriptFormat = 'bat' | 'ps1';

type ApkQueueStatus = 'queued' | 'resolving' | 'downloading' | 'completed' | 'failed';

export const AutoInstallerEngine: React.FC<AutoInstallerEngineProps> = ({
  items,
  onRemoveItem,
  onClearPlatform,
  onUpdateItemMeta,
}) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'pc' | 'android'>('pc');

  // PC Script Generator State
  const [pkgManager, setPkgManager] = useState<PcPackageManager>('winget');
  const [scriptFormat, setScriptFormat] = useState<PcScriptFormat>('bat');
  const [copiedScript, setCopiedScript] = useState<boolean>(false);

  // Android Sequential APK Queue State
  const [apkStatuses, setApkStatuses] = useState<Record<string, ApkQueueStatus>>({});
  const [apkSources, setApkSources] = useState<Record<string, string>>({});
  const [isQueueRunning, setIsQueueRunning] = useState<boolean>(false);
  const [isQueuePaused, setIsQueuePaused] = useState<boolean>(false);
  const [currentQueueIndex, setCurrentQueueIndex] = useState<number>(-1);
  const pauseRef = useRef<boolean>(false);

  const pcItems = items.filter((i) => i.platform === 'pc');
  const androidItems = items.filter((i) => i.platform === 'android');

  // Auto-switch active tab based on available items
  useEffect(() => {
    if (pcItems.length === 0 && androidItems.length > 0) {
      setActiveTab('android');
    } else if (androidItems.length === 0 && pcItems.length > 0) {
      setActiveTab('pc');
    }
  }, [pcItems.length, androidItems.length]);

  // Background resolve missing Winget/Choco IDs or direct APK URLs when items are added
  useEffect(() => {
    items.forEach((item) => {
      if (item.platform === 'pc' && (!item.wingetId || !item.chocoId)) {
        fetch(
          `/api/resolve-bulk-item?platform=pc&packageId=${encodeURIComponent(
            item.packageId
          )}&name=${encodeURIComponent(item.name)}&fallbackUrl=${encodeURIComponent(
            item.primaryDownloadUrl
          )}`
        )
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { wingetId?: string; chocoId?: string } | null) => {
            if (data) {
              onUpdateItemMeta(item.appKey, {
                wingetId: data.wingetId || item.packageId,
                chocoId: data.chocoId || item.packageId.toLowerCase(),
              });
            }
          })
          .catch(() => {
            // ignore
          });
      } else if (item.platform === 'android' && !item.directApkUrl) {
        fetch(
          `/api/resolve-bulk-item?platform=android&packageId=${encodeURIComponent(
            item.packageId
          )}&name=${encodeURIComponent(item.name)}&fallbackUrl=${encodeURIComponent(
            item.primaryDownloadUrl
          )}`
        )
          .then((r) => (r.ok ? r.json() : null))
          .then((data: { directApkUrl?: string; source?: string } | null) => {
            if (data?.directApkUrl) {
              onUpdateItemMeta(item.appKey, {
                directApkUrl: data.directApkUrl,
              });
              if (data.source) {
                setApkSources((prev) => ({ ...prev, [item.appKey]: data.source! }));
              }
            }
          })
          .catch(() => {
            // ignore
          });
      }
    });
  }, [items, onUpdateItemMeta]);

  if (items.length === 0) {
    return null;
  }

  // Generate PC .BAT Script
  const generateBatScript = (): string => {
    const lines: string[] = [
      '@echo off',
      'chcp 65001 >nul',
      'title Vanguard Index - Automated Silent PC Installer (التسطيب الأوتوماتيكي)',
      'echo ============================================================================',
      'echo   VANGUARD INDEX - AUTOMATED SILENT SOFTWARE INSTALLER (WINDOWS PC)',
      `echo   Selected Packages: ${pcItems.length} | Engine: ${pkgManager.toUpperCase()}`,
      `echo   Generated: ${new Date().toISOString()}`,
      'echo ============================================================================',
      'echo.',
      '',
      ':: Check for Administrator privileges',
      'net session >nul 2>&1',
      'if %errorLevel% neq 0 (',
      '    echo [!] Requesting Administrator privileges for silent installation...',
      '    powershell -Command "Start-Process \'%~f0\' -Verb RunAs"',
      '    exit /b',
      ')',
      '',
    ];

    if (pkgManager === 'chocolatey') {
      lines.push(
        ':: Verify Chocolatey is installed',
        'where choco >nul 2>&1',
        'if %errorLevel% neq 0 (',
        '    echo [*] Chocolatey not found. Bootstrapping Chocolatey Package Manager...',
        '    powershell -NoProfile -InputFormat None -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::SecurityProtocol = 3072; iex ((New-Object System.Net.WebClient).DownloadString(\'https://community.chocolatey.org/install.ps1\'))"',
        '    SET "PATH=%PATH%;%ALLUSERSPROFILE%\\chocolatey\\bin"',
        ')',
        'echo.'
      );
    } else {
      lines.push(
        ':: Verify Windows Package Manager (winget) is available',
        'where winget >nul 2>&1',
        'if %errorLevel% neq 0 (',
        '    echo [!] Winget CLI was not detected on this system.',
        '    echo [!] Falling back to direct binary download where needed.',
        ')',
        'echo.'
      );
    }

    pcItems.forEach((item, index) => {
      const stepNum = index + 1;
      const wingetId = item.wingetId || item.packageId;
      const chocoSlug =
        item.chocoId ||
        item.name
          .toLowerCase()
          .replace(/[^a-z0-9.-]+/g, '-')
          .replace(/^-+|-+$/g, '');

      lines.push(
        `echo [${stepNum}/${pcItems.length}] Installing ${item.name} (${item.developer})...`
      );

      if (pkgManager === 'winget') {
        lines.push(
          `winget install --id "${wingetId}" -e --silent --accept-package-agreements --accept-source-agreements`
        );
        lines.push('if %errorLevel% neq 0 (');
        lines.push(
          `    echo [~] Exact ID lookup fallback: searching winget by name "${item.name}"...`
        );
        lines.push(
          `    winget install --name "${item.name}" --silent --accept-package-agreements --accept-source-agreements`
        );
        lines.push(')');
      } else if (pkgManager === 'chocolatey') {
        lines.push(`choco install ${chocoSlug} -y --no-progress`);
      } else {
        // Hybrid: Try winget first, then chocolatey, then direct download
        lines.push(
          `winget install --id "${wingetId}" -e --silent --accept-package-agreements --accept-source-agreements`
        );
        lines.push('if %errorLevel% neq 0 (');
        if (
          item.primaryDownloadUrl &&
          (item.primaryDownloadUrl.endsWith('.exe') || item.primaryDownloadUrl.endsWith('.msi'))
        ) {
          const ext = item.primaryDownloadUrl.endsWith('.msi') ? 'msi' : 'exe';
          const tempFile = `%TEMP%\\vanguard_setup_${stepNum}.${ext}`;
          lines.push(`    echo [~] Downloading official installer from ${item.primaryDownloadUrl}...`);
          lines.push(`    curl.exe -L "${item.primaryDownloadUrl}" -o "${tempFile}"`);
          if (ext === 'msi') {
            lines.push(`    msiexec /i "${tempFile}" /qn /norestart`);
          } else {
            lines.push(`    start /wait "" "${tempFile}" /S`);
          }
        } else {
          lines.push(
            `    winget install --name "${item.name}" --silent --accept-package-agreements --accept-source-agreements`
          );
        }
        lines.push(')');
      }
      lines.push(`echo [OK] Completed step ${stepNum}: ${item.name}`);
      lines.push('echo.');
    });

    lines.push(
      'echo ============================================================================',
      `echo   ALL ${pcItems.length} SELECTED PC PACKAGES PROCESSED SUCCESSFULLY!`,
      'echo ============================================================================',
      'pause'
    );

    return lines.join('\r\n');
  };

  // Generate PC .PS1 PowerShell Script
  const generatePs1Script = (): string => {
    const lines: string[] = [
      '#Requires -RunAsAdministrator',
      '<#',
      ' .SYNOPSIS',
      '   Vanguard Index - Automated Silent PC Software Installer (التسطيب الأوتوماتيكي)',
      `   Selected Packages: ${pcItems.length} | Engine: ${pkgManager.toUpperCase()}`,
      `   Generated: ${new Date().toISOString()}`,
      '#>',
      '$ErrorActionPreference = "Continue"',
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      '',
      'Write-Host "============================================================================" -ForegroundColor Cyan',
      'Write-Host "  VANGUARD INDEX - AUTOMATED SILENT PC INSTALLER (POWERSHELL)" -ForegroundColor Cyan',
      `Write-Host "  Packages Queued: ${pcItems.length} | Mode: ${pkgManager.toUpperCase()}" -ForegroundColor Gray`,
      'Write-Host "============================================================================" -ForegroundColor Cyan',
      'Write-Host ""',
      '',
    ];

    if (pkgManager === 'chocolatey') {
      lines.push(
        'if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {',
        '    Write-Host "[*] Installing Chocolatey Package Manager..." -ForegroundColor Yellow',
        '    Set-ExecutionPolicy Bypass -Scope Process -Force',
        '    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072',
        "    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))",
        '}',
        ''
      );
    }

    pcItems.forEach((item, index) => {
      const stepNum = index + 1;
      const wingetId = item.wingetId || item.packageId;
      const chocoSlug =
        item.chocoId ||
        item.name
          .toLowerCase()
          .replace(/[^a-z0-9.-]+/g, '-')
          .replace(/^-+|-+$/g, '');

      lines.push(
        `Write-Host "[${stepNum}/${pcItems.length}] Installing ${item.name} (${item.developer})..." -ForegroundColor SkyBlue`
      );

      if (pkgManager === 'winget') {
        lines.push(
          `winget install --id "${wingetId}" -e --silent --accept-package-agreements --accept-source-agreements`
        );
        lines.push('if ($LASTEXITCODE -ne 0) {');
        lines.push(
          `    Write-Host "  [~] Retrying by application name: ${item.name}" -ForegroundColor Yellow`
        );
        lines.push(
          `    winget install --name "${item.name}" --silent --accept-package-agreements --accept-source-agreements`
        );
        lines.push('}');
      } else if (pkgManager === 'chocolatey') {
        lines.push(`choco install ${chocoSlug} -y --no-progress`);
      } else {
        lines.push(
          `winget install --id "${wingetId}" -e --silent --accept-package-agreements --accept-source-agreements`
        );
        lines.push('if ($LASTEXITCODE -ne 0) {');
        if (
          item.primaryDownloadUrl &&
          (item.primaryDownloadUrl.endsWith('.exe') || item.primaryDownloadUrl.endsWith('.msi'))
        ) {
          const ext = item.primaryDownloadUrl.endsWith('.msi') ? 'msi' : 'exe';
          lines.push(
            `    $InstallerPath = Join-Path $env:TEMP "vanguard_installer_${stepNum}.${ext}"`
          );
          lines.push(
            `    Write-Host "  [~] Downloading direct binary from ${item.primaryDownloadUrl}..." -ForegroundColor Yellow`
          );
          lines.push(
            `    Invoke-WebRequest -Uri "${item.primaryDownloadUrl}" -OutFile $InstallerPath -UseBasicParsing`
          );
          if (ext === 'msi') {
            lines.push(
              '    Start-Process msiexec.exe -ArgumentList "/i `"$InstallerPath`" /qn /norestart" -Wait'
            );
          } else {
            lines.push('    Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait');
          }
        } else {
          lines.push(
            `    winget install --name "${item.name}" --silent --accept-package-agreements --accept-source-agreements`
          );
        }
        lines.push('}');
      }
      lines.push(
        `Write-Host "[OK] Finished ${item.name}" -ForegroundColor Green`,
        'Write-Host ""'
      );
    });

    lines.push(
      'Write-Host "============================================================================" -ForegroundColor Cyan',
      `Write-Host "  ALL ${pcItems.length} PC PACKAGES INSTALLED SUCCESSFULLY!" -ForegroundColor Green`,
      'Write-Host "============================================================================" -ForegroundColor Cyan',
      'Read-Host -Prompt "Press Enter to exit"'
    );

    return lines.join('\r\n');
  };

  const activeScriptContent =
    scriptFormat === 'bat' ? generateBatScript() : generatePs1Script();

  const handleDownloadScript = (format: PcScriptFormat) => {
    const content = format === 'bat' ? generateBatScript() : generatePs1Script();
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vanguard-auto-installer-${pkgManager}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyScript = async () => {
    try {
      await navigator.clipboard.writeText(activeScriptContent);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2000);
    } catch {
      // ignore
    }
  };

  // Trigger a single APK download to the user's device local storage
  const triggerBrowserApkDownload = (apkUrl: string, appName: string) => {
    const safeFilename = `${appName.toLowerCase().replace(/[^a-z0-9.-]+/g, '-')}.apk`;
    const link = document.createElement('a');
    link.href = apkUrl;
    link.setAttribute('download', safeFilename);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Sequential Android APK Download Queue Runner
  const startSequentialApkQueue = async () => {
    if (androidItems.length === 0) return;
    setIsQueueRunning(true);
    setIsQueuePaused(false);
    pauseRef.current = false;

    for (let i = 0; i < androidItems.length; i++) {
      if (pauseRef.current) {
        setIsQueueRunning(false);
        return;
      }

      const item = androidItems[i];
      if (apkStatuses[item.appKey] === 'completed') {
        continue;
      }

      setCurrentQueueIndex(i);
      setApkStatuses((prev) => ({ ...prev, [item.appKey]: 'resolving' }));

      let targetApkUrl = item.directApkUrl || '';
      if (!targetApkUrl) {
        try {
          const res = await fetch(
            `/api/resolve-bulk-item?platform=android&packageId=${encodeURIComponent(
              item.packageId
            )}&name=${encodeURIComponent(item.name)}&fallbackUrl=${encodeURIComponent(
              item.primaryDownloadUrl
            )}`
          );
          if (res.ok) {
            const data = (await res.json()) as {
              directApkUrl?: string;
              source?: string;
            };
            if (data.directApkUrl) {
              targetApkUrl = data.directApkUrl;
              onUpdateItemMeta(item.appKey, { directApkUrl: data.directApkUrl });
              if (data.source) {
                setApkSources((prev) => ({ ...prev, [item.appKey]: data.source! }));
              }
            }
          }
        } catch {
          // fallback to primaryDownloadUrl
        }
      }

      if (!targetApkUrl) {
        targetApkUrl = item.primaryDownloadUrl;
      }

      if (pauseRef.current) {
        setIsQueueRunning(false);
        return;
      }

      setApkStatuses((prev) => ({ ...prev, [item.appKey]: 'downloading' }));

      // Trigger sequential download to local device storage
      triggerBrowserApkDownload(targetApkUrl, item.name);

      // Wait 1.6 seconds before advancing to the next APK in queue so browser handles sequential downloads cleanly
      await new Promise((resolve) => setTimeout(resolve, 1600));

      setApkStatuses((prev) => ({ ...prev, [item.appKey]: 'completed' }));
    }

    setCurrentQueueIndex(-1);
    setIsQueueRunning(false);
  };

  const handlePauseQueue = () => {
    pauseRef.current = true;
    setIsQueuePaused(true);
    setIsQueueRunning(false);
  };

  const handleResetQueue = () => {
    pauseRef.current = true;
    setIsQueueRunning(false);
    setIsQueuePaused(false);
    setCurrentQueueIndex(-1);
    setApkStatuses({});
  };

  const completedApkCount = androidItems.filter(
    (item) => apkStatuses[item.appKey] === 'completed'
  ).length;

  return (
    <div className="fixed bottom-0 inset-x-0 z-40 pointer-events-none px-3 sm:px-6 pb-4">
      <div className="max-w-6xl mx-auto pointer-events-auto">
        <div className="bg-[#0B1325]/95 backdrop-blur-2xl border border-sky-400/40 rounded-2xl shadow-[0_0_50px_-10px_rgba(56,189,248,0.35)] overflow-hidden transition-all">
          {/* Compact Top Bar of the Auto-Installer Dock */}
          <div className="px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 bg-[#0F172A]/90 border-b border-slate-800/80">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/35 flex items-center justify-center text-sky-400 shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display font-bold text-slate-50 text-base">
                    {t('installSelected')}
                  </span>
                  <span className="text-xs font-mono text-sky-300">
                    ({items.length} selected: {pcItems.length} PC · {androidItems.length} Android)
                  </span>
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {pcItems.length > 0 && androidItems.length > 0
                    ? 'Ready to generate PC silent installer script (.bat/.ps1) & sequential Android APK download queue'
                    : pcItems.length > 0
                    ? 'Ready to generate unattended Windows silent installer script (.bat / .ps1 via Winget or Chocolatey)'
                    : 'Ready to run sequential Android APK download queue to device local storage'}
                </p>
              </div>
            </div>

            {/* Quick Action Buttons in Collapsed Bar */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {pcItems.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => handleDownloadScript('bat')}
                    className="px-3.5 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs sm:text-sm rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download .BAT ({pcItems.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadScript('ps1')}
                    className="px-3.5 py-2 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/40 text-sky-200 font-semibold text-xs sm:text-sm rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <FileCode className="w-4 h-4" />
                    <span>Download .PS1</span>
                  </button>
                </>
              )}

              {androidItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('android');
                    setIsExpanded(true);
                    if (!isQueueRunning) {
                      startSequentialApkQueue();
                    }
                  }}
                  className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs sm:text-sm rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>
                    {isQueueRunning
                      ? `Downloading APKs (${completedApkCount}/${androidItems.length})...`
                      : `Start Sequential APK Queue (${androidItems.length})`}
                  </span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="px-3.5 py-2 bg-slate-800/90 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs sm:text-sm font-medium rounded-xl inline-flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>{isExpanded ? 'Hide Engine' : 'Configure & Preview'}</span>
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
              </button>

              <button
                type="button"
                onClick={() => onClearPlatform('all')}
                title="Clear all selected bulk install items"
                className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-950/30 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Expanded Auto-Installer Engine Drawer */}
          {isExpanded && (
            <div className="p-4 sm:p-6 max-h-[72vh] overflow-y-auto space-y-6">
              {/* Platform Mode Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
                <div className="inline-flex items-center gap-1.5 p-1 bg-[#070B14] border border-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setActiveTab('pc')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer ${
                      activeTab === 'pc'
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Monitor className="w-4 h-4" />
                    <span>PC Silent Script ({pcItems.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('android')}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer ${
                      activeTab === 'android'
                        ? 'bg-sky-500 text-slate-950'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Smartphone className="w-4 h-4" />
                    <span>Android APK Queue ({androidItems.length})</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onClearPlatform(activeTab)}
                  className="text-xs font-medium text-slate-400 hover:text-red-400 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear {activeTab.toUpperCase()} Selection</span>
                </button>
              </div>

              {/* ============================================================ */}
              {/* TAB 1: PC SILENT INSTALLER SCRIPT GENERATOR (.BAT / .PS1)    */}
              {/* ============================================================ */}
              {activeTab === 'pc' && (
                <div>
                  {pcItems.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      No Windows PC software selected yet. Check &ldquo;Select for Bulk Install&rdquo; next to any PC search result or carousel card.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                      {/* Left Column: Selected PC Packages & Controls */}
                      <div className="lg:col-span-5 space-y-4">
                        <div className="space-y-2">
                          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Windows Package Manager Engine
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            {(
                              [
                                { id: 'winget', label: 'Winget CLI' },
                                { id: 'chocolatey', label: 'Chocolatey' },
                                { id: 'hybrid', label: 'Hybrid + EXE' },
                              ] as const
                            ).map((mode) => (
                              <button
                                key={mode.id}
                                type="button"
                                onClick={() => setPkgManager(mode.id)}
                                className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                                  pkgManager === mode.id
                                    ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                                }`}
                              >
                                {mode.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Script Format
                          </label>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setScriptFormat('bat')}
                              className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                                scriptFormat === 'bat'
                                  ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              Batch Script (.BAT)
                            </button>
                            <button
                              type="button"
                              onClick={() => setScriptFormat('ps1')}
                              className={`px-3 py-2.5 rounded-xl text-xs font-semibold border transition-colors cursor-pointer ${
                                scriptFormat === 'ps1'
                                  ? 'bg-sky-500/20 border-sky-400 text-sky-200'
                                  : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              PowerShell (.PS1)
                            </button>
                          </div>
                        </div>

                        {/* List of Queued PC Apps */}
                        <div className="space-y-2 pt-2">
                          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Selected PC Software ({pcItems.length})
                          </div>
                          <div className="divide-y divide-slate-800/80 bg-[#070B14]/90 border border-slate-800 rounded-xl max-h-60 overflow-y-auto">
                            {pcItems.map((item) => (
                              <div
                                key={item.appKey}
                                className="p-3 flex items-center justify-between gap-3"
                              >
                                <div className="flex items-center gap-3 min-w-0">
                                  <AppIcon
                                    src={item.iconUrl}
                                    name={item.name}
                                    platform="pc"
                                    size="sm"
                                  />
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-100 truncate">
                                      {item.name}
                                    </div>
                                    <div className="text-xs font-mono text-sky-400 truncate">
                                      {pkgManager === 'chocolatey'
                                        ? `choco: ${item.chocoId || item.packageId}`
                                        : `winget: ${item.wingetId || item.packageId}`}
                                    </div>
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => onRemoveItem(item.appKey)}
                                  className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg cursor-pointer"
                                  title={`Remove ${item.name}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Right Column: Live Script Code Preview & Download Actions */}
                      <div className="lg:col-span-7 flex flex-col justify-between bg-[#070B14] border border-slate-800 rounded-xl overflow-hidden">
                        <div className="px-4 py-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                            <Terminal className="w-4 h-4 text-sky-400" />
                            <span>
                              vanguard-auto-installer-{pkgManager}.{scriptFormat}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleCopyScript}
                              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              {copiedScript ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Copied Script</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copy Code</span>
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadScript(scriptFormat)}
                              className="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download .{scriptFormat.toUpperCase()}</span>
                            </button>
                          </div>
                        </div>

                        <pre className="p-4 text-xs font-mono text-sky-200/90 overflow-x-auto max-h-72 leading-relaxed select-all">
                          {activeScriptContent}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================ */}
              {/* TAB 2: ANDROID SEQUENTIAL APK BULK DOWNLOAD QUEUE            */}
              {/* ============================================================ */}
              {activeTab === 'android' && (
                <div>
                  {androidItems.length === 0 ? (
                    <div className="text-center py-8 text-slate-400 text-sm">
                      No Android apps selected yet. Check &ldquo;Select for Bulk Install&rdquo; next to any Android search result or carousel card.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Queue Control Header */}
                      <div className="bg-[#070B14]/90 border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                            <span>Sequential APK Local Storage Queue</span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-sky-400">
                              {completedApkCount} / {androidItems.length} Downloaded
                            </span>
                          </div>
                          <p className="text-xs text-slate-400">
                            Fetches verified F-Droid / official GitHub release APKs one-by-one to your device&apos;s local Downloads folder for streamlined installation.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                          {!isQueueRunning ? (
                            <button
                              type="button"
                              onClick={startSequentialApkQueue}
                              className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-sm rounded-xl inline-flex items-center gap-2 cursor-pointer"
                            >
                              <Play className="w-4 h-4 fill-slate-950" />
                              <span>
                                {isQueuePaused
                                  ? 'Resume Sequential Queue'
                                  : completedApkCount === androidItems.length &&
                                    androidItems.length > 0
                                  ? 'Re-Run APK Queue'
                                  : 'Start Bulk APK Download'}
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={handlePauseQueue}
                              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm rounded-xl inline-flex items-center gap-2 cursor-pointer"
                            >
                              <Pause className="w-4 h-4 fill-slate-950" />
                              <span>Pause Queue</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={handleResetQueue}
                            className="px-3.5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Reset Status</span>
                          </button>
                        </div>
                      </div>

                      {/* Ordered APK Queue List */}
                      <div className="divide-y divide-slate-800/80 bg-[#070B14]/90 border border-slate-800 rounded-xl">
                        {androidItems.map((item, idx) => {
                          const status: ApkQueueStatus = apkStatuses[item.appKey] || 'queued';
                          const resolvedUrl = item.directApkUrl || item.primaryDownloadUrl;
                          const sourceLabel =
                            apkSources[item.appKey] ||
                            (resolvedUrl.toLowerCase().endsWith('.apk')
                              ? 'Direct APK Binary'
                              : 'Official Package Mirror');

                          return (
                            <div
                              key={item.appKey}
                              className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                                currentQueueIndex === idx ? 'bg-sky-500/10' : ''
                              }`}
                            >
                              <div className="flex items-center gap-3.5 min-w-0">
                                <span className="text-xs font-mono text-slate-500 w-6 text-center shrink-0">
                                  #{idx + 1}
                                </span>
                                <AppIcon
                                  src={item.iconUrl}
                                  name={item.name}
                                  platform="android"
                                  size="md"
                                />
                                <div className="min-w-0">
                                  <div className="text-base font-semibold text-slate-100 truncate">
                                    {item.name}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400 mt-0.5">
                                    <span className="font-mono">{item.packageId}</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-sky-300">{sourceLabel}</span>
                                    <span aria-hidden="true">·</span>
                                    {status === 'queued' && (
                                      <span className="text-slate-400">Queued for download</span>
                                    )}
                                    {status === 'resolving' && (
                                      <span className="text-amber-300 inline-flex items-center gap-1">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Resolving direct APK binary...
                                      </span>
                                    )}
                                    {status === 'downloading' && (
                                      <span className="text-sky-300 inline-flex items-center gap-1">
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                        Downloading APK to local storage...
                                      </span>
                                    )}
                                    {status === 'completed' && (
                                      <span className="text-emerald-400 inline-flex items-center gap-1 font-medium">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        Saved to Device — Tap APK to Install
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <a
                                  href={resolvedUrl}
                                  download={`${item.name
                                    .toLowerCase()
                                    .replace(/[^a-z0-9.-]+/g, '-')}.apk`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() =>
                                    setApkStatuses((prev) => ({
                                      ...prev,
                                      [item.appKey]: 'completed',
                                    }))
                                  }
                                  className="px-3.5 py-2 bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/35 text-sky-200 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  <span>
                                    {resolvedUrl.toLowerCase().endsWith('.apk')
                                      ? 'Direct .APK'
                                      : 'Fetch APK'}
                                  </span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>

                                <button
                                  type="button"
                                  onClick={() => onRemoveItem(item.appKey)}
                                  className="p-2 text-slate-400 hover:text-red-400 rounded-lg cursor-pointer"
                                  title={`Remove ${item.name} from queue`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
