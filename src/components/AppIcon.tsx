import React, { useState } from 'react';
import { Monitor, Smartphone, Apple } from 'lucide-react';
import type { PlatformType } from '../types.ts';

interface AppIconProps {
  src?: string;
  name: string;
  platform: PlatformType;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const AppIcon: React.FC<AppIconProps> = ({
  src,
  name,
  platform,
  size = 'md',
  className = '',
}) => {
  const [imgFailed, setImgFailed] = useState(false);

  const sizeClasses = {
    sm: 'w-9 h-9 rounded-lg text-sm',
    md: 'w-12 h-12 rounded-xl text-base',
    lg: 'w-16 h-16 rounded-2xl text-xl',
    xl: 'w-20 h-20 rounded-2xl text-2xl',
  }[size];

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join('') || 'SW';

  const hasValidSrc = Boolean(src && src.trim().length > 4 && !imgFailed);

  if (hasValidSrc) {
    return (
      <div
        className={`relative shrink-0 overflow-hidden bg-slate-900/90 border border-slate-700/60 flex items-center justify-center ${sizeClasses} ${className}`}
      >
        <img
          src={src}
          alt={`${name} icon`}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgFailed(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-gradient-to-br from-slate-800/95 via-slate-900 to-[#0B1325] border border-sky-500/25 flex flex-col items-center justify-center text-sky-300 font-display font-bold select-none ${sizeClasses} ${className}`}
      aria-label={`${name} fallback icon`}
    >
      <span className="leading-none tracking-tight">{initials}</span>
      <span className="mt-0.5 opacity-60">
        {platform === 'pc' && <Monitor className="w-3 h-3" />}
        {platform === 'android' && <Smartphone className="w-3 h-3" />}
        {platform === 'ios' && <Apple className="w-3 h-3" />}
      </span>
    </div>
  );
};
