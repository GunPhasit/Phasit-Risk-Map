import {
  Activity,
  Biohazard,
  CloudLightning,
  Droplets,
  Factory,
  Flame,
  Layers,
  Mountain,
  Sun,
  ThermometerSun,
  Waves,
} from 'lucide-react';
import { getPaletteForDimension, NA_RISK_STYLE } from '../../data/riskPalette';
import type { LayerSelection, MapDimension, RiskLevel } from '../../types/risk';

interface RiskBadgeProps {
  level: RiskLevel | null;
  dimension?: MapDimension;
  variant?: 'solid' | 'tinted';
  size?: 'sm' | 'md' | 'lg';
  showLevelNumber?: boolean;
  compact?: boolean;
}

export function RiskBadge({
  level,
  dimension = 'R',
  variant = 'solid',
  size = 'md',
  showLevelNumber = true,
  compact = false,
}: RiskBadgeProps) {
  const sizeClass =
    size === 'sm'
      ? 'px-2 py-0.5 text-xs gap-1'
      : size === 'lg'
        ? 'px-3 py-1.5 text-sm gap-1.5 font-semibold'
        : 'px-2.5 py-1 text-xs gap-1.5 font-medium';

  if (level === null) {
    return (
      <span
        className={`inline-flex items-center rounded-full border ${sizeClass}`}
        style={{
          backgroundColor: variant === 'solid' ? NA_RISK_STYLE.badgeBg : NA_RISK_STYLE.tintBg,
          color: variant === 'solid' ? NA_RISK_STYLE.badgeText : NA_RISK_STYLE.tintText,
          borderColor: NA_RISK_STYLE.tintBorder,
        }}
      >
        <span aria-hidden="true">{NA_RISK_STYLE.symbol}</span>
        <span>{compact ? 'N/A' : 'ไม่เข้าข่าย (N/A)'}</span>
      </span>
    );
  }

  const palette = getPaletteForDimension(dimension);
  const style = palette[level];
  const bg = variant === 'solid' ? style.badgeBg : style.tintBg;
  const color = variant === 'solid' ? style.badgeText : style.tintText;
  const border = variant === 'solid' ? 'transparent' : style.tintBorder;

  return (
    <span
      className={`inline-flex items-center rounded-full border leading-tight ${sizeClass}`}
      style={{ backgroundColor: bg, color, borderColor: border }}
    >
      <span aria-hidden="true" className="text-[0.85em]">
        {style.symbol}
      </span>
      <span className="tabular-nums">
        {showLevelNumber ? `ระดับ ${level} ` : ''}
        {compact ? style.shortLabelTh : style.labelTh}
      </span>
    </span>
  );
}

interface HazardIconProps {
  layer: LayerSelection;
  className?: string;
}

export function HazardIcon({ layer, className = 'w-4 h-4 shrink-0' }: HazardIconProps) {
  switch (layer) {
    case 'composite':
      return <Layers className={className} aria-hidden="true" />;
    case 'flood':
      return <Droplets className={className} aria-hidden="true" />;
    case 'pm25_wildfire':
      return <Flame className={className} aria-hidden="true" />;
    case 'drought':
      return <Sun className={className} aria-hidden="true" />;
    case 'windstorm':
      return <CloudLightning className={className} aria-hidden="true" />;
    case 'landslide':
      return <Mountain className={className} aria-hidden="true" />;
    case 'toxic_pollution':
      return <Factory className={className} aria-hidden="true" />;
    case 'heatwave':
      return <ThermometerSun className={className} aria-hidden="true" />;
    case 'epidemic':
      return <Biohazard className={className} aria-hidden="true" />;
    case 'earthquake':
      return <Activity className={className} aria-hidden="true" />;
    case 'tsunami_coastal':
      return <Waves className={className} aria-hidden="true" />;
  }
}
