import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Check, RotateCcw, SlidersHorizontal, Plus, Minus } from 'lucide-react';
import type { PastelSwatch } from '../design/tokens';

interface RepetitionCounterProps {
  current: number;
  target: number;
  swatch: PastelSwatch;
  isDark: boolean;
  reducedMotion: boolean;
  onIncrement: () => void;
  onUndo: () => void;
  onSetCount: (value: number) => void;
}

function getRelativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return 0.5;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function getContrastOnColor(hex: string): string {
  return getRelativeLuminance(hex) > 0.55 ? '#000000' : '#FFFFFF';
}

export const RepetitionCounter: React.FC<RepetitionCounterProps> = ({
  current,
  target,
  swatch,
  isDark,
  reducedMotion,
  onIncrement,
  onUndo,
  onSetCount,
}) => {
  const [showManual, setShowManual] = useState(false);
  const isCompleted = current >= target;
  const accent = isDark ? swatch.accentDark : swatch.accentLight;
  const contrastOnAccent = getContrastOnColor(accent);
  const cardInk = isDark ? swatch.inkDark : swatch.inkLight;
  const isWhiteInkOnVividLight = !isDark && getRelativeLuminance(cardInk) > 0.7;

  const pillSurface = isDark
    ? 'rgba(255,255,255,0.08)'
    : isWhiteInkOnVividLight
    ? 'rgba(0,0,0,0.22)'
    : 'rgba(255,255,255,0.72)';

  const secondarySurface = isDark
    ? 'rgba(255,255,255,0.07)'
    : isWhiteInkOnVividLight
    ? 'rgba(0,0,0,0.18)'
    : 'rgba(255,255,255,0.55)';

  const trackBg = isDark
    ? 'rgba(255,255,255,0.14)'
    : isWhiteInkOnVividLight
    ? 'rgba(255,255,255,0.26)'
    : 'rgba(0,0,0,0.1)';

  const renderVisualCounter = () => {
    // Pattern 1: Single repetition — one clean Apple-grade completion indicator
    if (target === 1) {
      return (
        <motion.button
          type="button"
          onClick={onIncrement}
          disabled={isCompleted}
          whileTap={reducedMotion || isCompleted ? undefined : { scale: 0.96 }}
          aria-label={isCompleted ? 'تم إتمام الذكر' : 'اضغط لإتمام الذكر مرة واحدة'}
          className="w-full max-w-xs mx-auto min-h-[64px] px-6 py-4 rounded-2xl flex items-center justify-center gap-3 font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-2 cursor-pointer disabled:cursor-default"
          style={{
            backgroundColor: isCompleted ? accent : pillSurface,
            color: isCompleted ? contrastOnAccent : cardInk,
            border: `1.5px solid ${isCompleted ? accent : isDark ? swatch.borderDark : swatch.borderLight}`,
          }}
        >
          <span
            className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            style={{
              backgroundColor: isCompleted ? contrastOnAccent : trackBg,
              color: isCompleted ? accent : cardInk,
            }}
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
          </span>
          <span className="text-base font-semibold">
            {isCompleted ? 'تم الذكر بحمد الله' : 'اضغط عند القراءة (مرة واحدة)'}
          </span>
        </motion.button>
      );
    }

    // Pattern 2: Three or four repetitions — individual circles filling with each tap
    if (target === 3 || target === 4) {
      return (
        <button
          type="button"
          onClick={onIncrement}
          disabled={isCompleted}
          aria-label={`التكرار ${current} من ${target}`}
          className="w-full max-w-xs mx-auto py-4 px-5 rounded-3xl flex flex-col items-center gap-3 transition-all cursor-pointer disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{
            backgroundColor: pillSurface,
            color: cardInk,
            border: `1.5px solid ${isDark ? swatch.borderDark : swatch.borderLight}`,
          }}
        >
          <div className="flex items-center justify-center gap-3.5">
            {Array.from({ length: target }).map((_, idx) => {
              const filled = idx < current;
              return (
                <motion.div
                  key={idx}
                  initial={false}
                  animate={
                    reducedMotion
                      ? { scale: 1 }
                      : { scale: filled ? 1.04 : 1 }
                  }
                  transition={{ duration: 0.18 }}
                  className="w-11 h-11 rounded-full flex items-center justify-center transition-colors"
                  style={{
                    backgroundColor: filled ? accent : trackBg,
                    color: filled ? contrastOnAccent : cardInk,
                    border: `2px solid ${filled ? accent : 'transparent'}`,
                  }}
                >
                  {filled ? (
                    <Check className="w-5 h-5 stroke-[2.5]" />
                  ) : (
                    <span className="font-numeric text-sm font-semibold">{idx + 1}</span>
                  )}
                </motion.div>
              );
            })}
          </div>
          <span className="text-xs font-medium opacity-85">
            {isCompleted
              ? target === 4
                ? 'اكتملت الأربع مرات'
                : 'اكتملت الثلاث مرات'
              : `المتبقي ${target - current} من ${target} — المس للعدّ`}
          </span>
        </button>
      );
    }

    // Pattern 3: Seven repetitions — circular SVG progress divided into 7 segments
    if (target === 7) {
      const size = 148;
      const cx = size / 2;
      const cy = size / 2;
      const radius = 56;
      const segments = 7;
      const gapAngle = 10;
      const segAngle = (360 - segments * gapAngle) / segments;

      const polarToCartesian = (angleDeg: number) => {
        const rad = ((angleDeg - 90) * Math.PI) / 180;
        return {
          x: cx + radius * Math.cos(rad),
          y: cy + radius * Math.sin(rad),
        };
      };

      const describeArc = (startAngle: number, endAngle: number) => {
        const start = polarToCartesian(endAngle);
        const end = polarToCartesian(startAngle);
        const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
        return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`;
      };

      return (
        <motion.button
          type="button"
          onClick={onIncrement}
          disabled={isCompleted}
          whileTap={reducedMotion || isCompleted ? undefined : { scale: 0.96 }}
          aria-label={`التكرار ${current} من 7`}
          className="relative mx-auto flex items-center justify-center w-[156px] h-[156px] rounded-full cursor-pointer disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ color: cardInk }}
        >
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
            {Array.from({ length: segments }).map((_, idx) => {
              const start = idx * (segAngle + gapAngle);
              const end = start + segAngle;
              const filled = idx < current;
              return (
                <path
                  key={idx}
                  d={describeArc(start, end)}
                  fill="none"
                  stroke={filled ? accent : trackBg}
                  strokeWidth={11}
                  strokeLinecap="round"
                  className="transition-colors duration-200"
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isCompleted ? (
              <motion.div
                initial={reducedMotion ? undefined : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-12 h-12 rounded-full flex items-center justify-center"
                style={{ backgroundColor: accent, color: contrastOnAccent }}
              >
                <Check className="w-6 h-6 stroke-[2.5]" />
              </motion.div>
            ) : (
              <>
                <motion.span
                  key={current}
                  initial={reducedMotion ? undefined : { scale: 1.18, opacity: 0.7 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.16 }}
                  className="font-numeric text-3xl font-bold"
                >
                  {current}
                </motion.span>
                <span className="font-numeric text-xs opacity-75">من {target}</span>
              </>
            )}
          </div>
        </motion.button>
      );
    }

    // Pattern 4: Larger counts (10, 33, 100) — large numerical counter + circular progress ring
    const ringSize = 160;
    const strokeWidth = 10;
    const r = (ringSize - strokeWidth * 2) / 2;
    const circumference = 2 * Math.PI * r;
    const progress = Math.min(1, current / target);
    const dashOffset = circumference * (1 - progress);

    return (
      <motion.button
        type="button"
        onClick={onIncrement}
        disabled={isCompleted}
        whileTap={reducedMotion || isCompleted ? undefined : { scale: 0.96 }}
        aria-label={`العداد ${current} من ${target}`}
        className="relative mx-auto flex items-center justify-center w-[168px] h-[168px] rounded-full cursor-pointer disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2"
        style={{ color: cardInk }}
      >
        <svg width={ringSize} height={ringSize} className="-rotate-90">
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={r}
            fill={isDark ? 'rgba(255,255,255,0.04)' : isWhiteInkOnVividLight ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.58)'}
            stroke={trackBg}
            strokeWidth={strokeWidth}
          />
          <circle
            cx={ringSize / 2}
            cy={ringSize / 2}
            r={r}
            fill="none"
            stroke={accent}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: reducedMotion ? 'none' : 'stroke-dashoffset 220ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {isCompleted ? (
            <motion.div
              initial={reducedMotion ? undefined : { scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center gap-1"
            >
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center"
                style={{ backgroundColor: accent, color: contrastOnAccent }}
              >
                <Check className="w-6 h-6 stroke-[2.5]" />
              </div>
              <span className="font-numeric text-xs font-semibold">{target} / {target}</span>
            </motion.div>
          ) : (
            <>
              <motion.span
                key={current}
                initial={reducedMotion ? undefined : { scale: 1.14, opacity: 0.75 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.14 }}
                className="font-numeric text-4xl font-bold tracking-tight"
              >
                {current}
              </motion.span>
              <span className="font-numeric text-xs opacity-75 mt-0.5">من {target}</span>
            </>
          )}
        </div>
      </motion.button>
    );
  };

  return (
    <div className="flex flex-col items-center gap-3">
      {renderVisualCounter()}

      {/* Accessible Undo & Manual Correction Controls */}
      <div className="flex items-center justify-center gap-3 text-xs">
        <button
          type="button"
          onClick={onUndo}
          disabled={current === 0}
          className="min-h-[40px] px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 opacity-85 hover:opacity-100 disabled:opacity-35 transition-opacity cursor-pointer disabled:cursor-default"
          style={{
            backgroundColor: secondarySurface,
            color: cardInk,
          }}
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>تراجع</span>
        </button>

        {target > 1 && (
          <button
            type="button"
            onClick={() => setShowManual((v) => !v)}
            className="min-h-[40px] px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 opacity-85 hover:opacity-100 transition-opacity cursor-pointer"
            style={{
              backgroundColor: secondarySurface,
              color: cardInk,
            }}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>تصحيح يدوي</span>
          </button>
        )}
      </div>

      {showManual && target > 1 && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-2xl"
          style={{
            backgroundColor: pillSurface,
            color: cardInk,
            border: `1px solid ${isDark ? swatch.borderDark : swatch.borderLight}`,
          }}
        >
          <button
            type="button"
            onClick={() => onSetCount(Math.max(0, current - 1))}
            aria-label="إنقاص واحد"
            className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          >
            <Minus className="w-4 h-4" />
          </button>
          <span className="font-numeric text-sm font-semibold min-w-[54px] text-center">
            {current} / {target}
          </span>
          <button
            type="button"
            onClick={() => onSetCount(Math.min(target, current + 1))}
            aria-label="زيادة واحد"
            className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onSetCount(0)}
            className="px-2.5 h-10 rounded-xl text-xs font-medium hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
          >
            تصفير
          </button>
        </div>
      )}
    </div>
  );
};
