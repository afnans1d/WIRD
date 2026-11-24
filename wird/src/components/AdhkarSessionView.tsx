import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  ArrowRight,
  ExternalLink,
  EyeOff,
  Eye,
  Heart,
  SkipForward,
  CheckCircle2,
  BookOpenText,
  Sparkles,
  Info,
  Type,
  ChevronRight,
  ChevronLeft,
  Hand,
} from 'lucide-react';
import { getAdhkarByPeriod, type DhikrItem } from '../data/adhkar';
import { getSwatchForCard } from '../design/tokens';
import type { FontSizeScale, SessionProgress } from '../lib/storage';
import { DhikrText } from './DhikrText';
import { RepetitionCounter } from './RepetitionCounter';

interface AdhkarSessionViewProps {
  period: 'morning' | 'evening';
  initialSession: SessionProgress | null;
  dateKey: string;
  isDark: boolean;
  fontSize: FontSizeScale;
  hapticsEnabled: boolean;
  reducedMotion: boolean;
  quietModeDefault: boolean;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  onFontSizeCycle: () => void;
  onSaveProgress: (session: SessionProgress) => void;
  onCompleteSession: (session: SessionProgress, items: DhikrItem[]) => void;
  onBackHome: () => void;
  focusDhikrId?: string | null;
}

const FONT_SIZE_CLASSES: Record<FontSizeScale, string> = {
  sm: 'text-xl md:text-2xl leading-[2.05]',
  md: 'text-2xl md:text-[28px] leading-[2.1]',
  lg: 'text-[26px] md:text-[32px] leading-[2.15]',
  xl: 'text-[30px] md:text-[38px] leading-[2.2]',
};

export const AdhkarSessionView: React.FC<AdhkarSessionViewProps> = ({
  period,
  initialSession,
  dateKey,
  isDark,
  fontSize,
  hapticsEnabled,
  reducedMotion,
  quietModeDefault,
  favorites,
  onToggleFavorite,
  onFontSizeCycle,
  onSaveProgress,
  onCompleteSession,
  onBackHome,
  focusDhikrId,
}) => {
  const items = React.useMemo(() => getAdhkarByPeriod(period), [period]);

  const initialIdx = React.useMemo(() => {
    if (focusDhikrId) {
      const found = items.findIndex((i) => i.id === focusDhikrId);
      if (found >= 0) return found;
    }
    if (initialSession && initialSession.currentIndex < items.length) {
      return initialSession.currentIndex;
    }
    return 0;
  }, [focusDhikrId, initialSession, items]);

  const [currentIndex, setCurrentIndex] = useState<number>(initialIdx);
  const [counts, setCounts] = useState<Record<string, number>>(initialSession?.counts || {});
  const [completedIds, setCompletedIds] = useState<string[]>(initialSession?.completedIds || []);
  const [skippedIds, setSkippedIds] = useState<string[]>(initialSession?.skippedIds || []);
  const [quietMode, setQuietMode] = useState<boolean>(quietModeDefault);

  // Direct GPU-composited swipe refs (zero React re-renders during drag)
  const cardRef = useRef<HTMLElement | null>(null);
  const enterDirectionRef = useRef<'right' | 'left' | null>(null);
  const isTransitioningRef = useRef<boolean>(false);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const gestureRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    startTime: number;
    lastDx: number;
    axis: 'horizontal' | 'vertical' | null;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    startTime: 0,
    lastDx: 0,
    axis: null,
  });

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Smoothly animate newly mounted single card into place on index change
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    const dir = enterDirectionRef.current;
    enterDirectionRef.current = null;
    isTransitioningRef.current = false;

    if (reducedMotion || !dir) {
      el.style.transition = 'none';
      el.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
      el.style.opacity = '1';
      return;
    }

    const startOffset = dir === 'right' ? -44 : 44;
    el.style.transition = 'none';
    el.style.transform = `translate3d(${startOffset}px, 0, 0)`;
    el.style.opacity = '0';

    // Force style flush once for clean GPU entrance without layout thrash loops
    void el.offsetWidth;

    el.style.transition =
      'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease-out';
    el.style.transform = 'translate3d(0, 0, 0)';
    el.style.opacity = '1';
  }, [currentIndex, reducedMotion]);

  const activeItem = items[currentIndex] || items[0];
  const swatch = getSwatchForCard(currentIndex, period);
  const activeCount = counts[activeItem.id] || 0;
  const isItemDone = activeCount >= activeItem.targetCount;
  const isFav = favorites.includes(activeItem.id);

  const persist = useCallback(
    (
      nextIndex: number,
      nextCounts: Record<string, number>,
      nextCompleted: string[],
      nextSkipped: string[],
      isCompleted = false
    ) => {
      onSaveProgress({
        period,
        dateKey,
        currentIndex: nextIndex,
        counts: nextCounts,
        completedIds: nextCompleted,
        skippedIds: nextSkipped,
        isCompleted,
        updatedAt: new Date().toISOString(),
      });
    },
    [dateKey, onSaveProgress, period]
  );

  const triggerHaptic = useCallback(
    (pattern: number | number[] = 12) => {
      if (hapticsEnabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(pattern);
        } catch {
          // Ignore unsupported vibrate
        }
      }
    },
    [hapticsEnabled]
  );

  const finishSessionIfReady = useCallback(
    (nextCounts: Record<string, number>, nextCompleted: string[], nextSkipped: string[]) => {
      const sessionPayload: SessionProgress = {
        period,
        dateKey,
        currentIndex,
        counts: nextCounts,
        completedIds: nextCompleted,
        skippedIds: nextSkipped,
        isCompleted: true,
        updatedAt: new Date().toISOString(),
      };
      onCompleteSession(sessionPayload, items);
    },
    [currentIndex, dateKey, items, onCompleteSession, period]
  );

  const animateAndSwitch = useCallback(
    (dir: 'right' | 'left', action: () => void) => {
      if (isTransitioningRef.current) return;
      const el = cardRef.current;
      if (reducedMotion || !el) {
        enterDirectionRef.current = dir;
        action();
        return;
      }

      isTransitioningRef.current = true;
      const exitX = dir === 'right' ? 240 : -240;
      const exitRot = dir === 'right' ? 6 : -6;
      el.style.transition =
        'transform 160ms cubic-bezier(0.32, 0.72, 0, 1), opacity 150ms ease-out';
      el.style.transform = `translate3d(${exitX}px, 0, 0) rotate(${exitRot}deg)`;
      el.style.opacity = '0';

      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        enterDirectionRef.current = dir;
        action();
      }, 155);
    },
    [reducedMotion]
  );

  const advanceCard = useCallback(() => {
    triggerHaptic(8);
    if (currentIndex < items.length - 1) {
      const nextIdx = currentIndex + 1;
      animateAndSwitch('right', () => {
        setCurrentIndex(nextIdx);
        persist(nextIdx, counts, completedIds, skippedIds, false);
      });
    } else {
      animateAndSwitch('right', () => {
        finishSessionIfReady(counts, completedIds, skippedIds);
      });
    }
  }, [
    animateAndSwitch,
    completedIds,
    counts,
    currentIndex,
    finishSessionIfReady,
    items.length,
    persist,
    skippedIds,
    triggerHaptic,
  ]);

  const previousCard = useCallback(() => {
    if (currentIndex <= 0) return;
    triggerHaptic(8);
    const prevIdx = currentIndex - 1;
    animateAndSwitch('left', () => {
      setCurrentIndex(prevIdx);
      persist(prevIdx, counts, completedIds, skippedIds, false);
    });
  }, [animateAndSwitch, completedIds, counts, currentIndex, persist, skippedIds, triggerHaptic]);

  const handleSetCount = useCallback(
    (newVal: number) => {
      const clamped = Math.max(0, Math.min(activeItem.targetCount, newVal));
      const nextCounts = { ...counts, [activeItem.id]: clamped };

      let nextCompleted = completedIds;
      let nextSkipped = skippedIds;

      if (clamped >= activeItem.targetCount) {
        if (!nextCompleted.includes(activeItem.id)) {
          nextCompleted = [...nextCompleted, activeItem.id];
        }
        nextSkipped = nextSkipped.filter((id) => id !== activeItem.id);
        triggerHaptic([16, 40, 22]);
      } else {
        nextCompleted = nextCompleted.filter((id) => id !== activeItem.id);
      }

      setCounts(nextCounts);
      setCompletedIds(nextCompleted);
      setSkippedIds(nextSkipped);

      const allHandled = items.every(
        (item) => nextCompleted.includes(item.id) || nextSkipped.includes(item.id)
      );

      if (clamped >= activeItem.targetCount && allHandled && nextCompleted.length > 0) {
        persist(currentIndex, nextCounts, nextCompleted, nextSkipped, true);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(
          () => {
            timerRef.current = null;
            finishSessionIfReady(nextCounts, nextCompleted, nextSkipped);
          },
          reducedMotion ? 100 : 380
        );
      } else {
        persist(currentIndex, nextCounts, nextCompleted, nextSkipped, false);
      }
    },
    [
      activeItem.id,
      activeItem.targetCount,
      completedIds,
      counts,
      currentIndex,
      finishSessionIfReady,
      items,
      persist,
      reducedMotion,
      skippedIds,
      triggerHaptic,
    ]
  );

  const handleIncrement = useCallback(() => {
    if (activeCount >= activeItem.targetCount) return;
    triggerHaptic(12);
    handleSetCount(activeCount + 1);
  }, [activeCount, activeItem.targetCount, handleSetCount, triggerHaptic]);

  const handleUndo = useCallback(() => {
    if (activeCount <= 0) return;
    triggerHaptic(8);
    handleSetCount(activeCount - 1);
  }, [activeCount, handleSetCount, triggerHaptic]);

  const handleSkip = useCallback(() => {
    const nextCompleted = completedIds.filter((id) => id !== activeItem.id);
    const nextSkipped = skippedIds.includes(activeItem.id)
      ? skippedIds
      : [...skippedIds, activeItem.id];

    setCompletedIds(nextCompleted);
    setSkippedIds(nextSkipped);

    const isLast = currentIndex === items.length - 1;
    const allHandled = items.every(
      (item) => nextCompleted.includes(item.id) || nextSkipped.includes(item.id)
    );

    if (isLast && allHandled && nextCompleted.length > 0) {
      persist(currentIndex, counts, nextCompleted, nextSkipped, true);
      finishSessionIfReady(counts, nextCompleted, nextSkipped);
      return;
    }

    if (isLast) {
      finishSessionIfReady(counts, nextCompleted, nextSkipped);
      return;
    }

    const nextIdx = Math.min(items.length - 1, currentIndex + 1);
    animateAndSwitch('right', () => {
      setCurrentIndex(nextIdx);
      persist(nextIdx, counts, nextCompleted, nextSkipped, false);
    });
  }, [
    activeItem.id,
    animateAndSwitch,
    completedIds,
    counts,
    currentIndex,
    finishSessionIfReady,
    items,
    persist,
    skippedIds,
  ]);

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        advanceCard();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        previousCard();
      } else if (e.key === ' ' && !isItemDone) {
        e.preventDefault();
        handleIncrement();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [advanceCard, handleIncrement, isItemDone, previousCard]);

  // Ultra-smooth pointer drag handlers (0 React re-renders during drag)
  const resetCardPosition = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.transition =
      'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease';
    el.style.transform = 'translate3d(0, 0, 0) rotate(0deg)';
    el.style.opacity = '1';
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (reducedMotion || isTransitioningRef.current || !e.isPrimary) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-no-swipe="true"], button, a, input, textarea')) {
      return;
    }

    gestureRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: performance.now(),
      lastDx: 0,
      axis: null,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g.active || g.pointerId !== e.pointerId || isTransitioningRef.current) return;

    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;

    if (g.axis === null) {
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absX < 8 && absY < 8) return;

      if (absY > absX * 1.05) {
        // Vertical scroll wins — release horizontal gesture cleanly
        g.axis = 'vertical';
        g.active = false;
        return;
      }

      g.axis = 'horizontal';
      const el = cardRef.current;
      if (el) {
        el.style.transition = 'none';
      }
    }

    if (g.axis !== 'horizontal') return;

    // Slight resistance if swiping left on first card
    const effectiveDx = currentIndex === 0 && dx < 0 ? dx * 0.32 : dx;
    g.lastDx = effectiveDx;

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const el = cardRef.current;
      if (!el || !gestureRef.current.active) return;
      const rot = Math.max(-8, Math.min(8, effectiveDx * 0.028));
      const opacity = Math.max(0.55, 1 - Math.abs(effectiveDx) / 540);
      el.style.transform = `translate3d(${effectiveDx}px, 0, 0) rotate(${rot}deg)`;
      el.style.opacity = String(opacity);
    });
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLElement>) => {
    const g = gestureRef.current;
    if (!g.active || g.pointerId !== e.pointerId) return;

    const wasHorizontal = g.axis === 'horizontal';
    const dx = g.lastDx;
    const dt = Math.max(16, performance.now() - g.startTime);
    const vx = dx / dt;

    g.active = false;
    g.pointerId = null;
    g.axis = null;

    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!wasHorizontal) return;

    const swipedRight = dx > 68 || vx > 0.42;
    const swipedLeft = dx < -68 || vx < -0.42;

    if (swipedRight) {
      advanceCard();
    } else if (swipedLeft && currentIndex > 0) {
      previousCard();
    } else {
      resetCardPosition();
    }
  };

  const sessionProgressRatio = (currentIndex + 1) / items.length;
  const isSkipped = skippedIds.includes(activeItem.id);
  const accentColor = isDark ? swatch.accentDark : swatch.accentLight;
  const isWhiteInkLight = !isDark && swatch.inkLight === '#FFFFFF';
  const cardPillBg = isDark
    ? 'rgba(255,255,255,0.1)'
    : isWhiteInkLight
    ? 'rgba(0,0,0,0.2)'
    : 'rgba(255,255,255,0.6)';

  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-12 overflow-x-clip">
      {/* Apple Clean Monochrome Session Bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onBackHome}
            className="min-h-[42px] px-3.5 py-2 rounded-2xl flex items-center gap-1.5 text-xs font-semibold bg-[#F5F5F7] dark:bg-[#1C1C1E] text-black dark:text-white border border-black/[0.08] dark:border-white/[0.1] cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
            <span>الرئيسية</span>
          </button>

          {currentIndex > 0 && (
            <button
              type="button"
              onClick={previousCard}
              title="العودة للبطاقة السابقة"
              aria-label="العودة للبطاقة السابقة"
              className="w-10 h-10 rounded-2xl flex items-center justify-center bg-[#F5F5F7] dark:bg-[#1C1C1E] text-black dark:text-white border border-black/[0.08] dark:border-white/[0.1] cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="text-center">
          <div className="text-[11px] font-medium text-[#6E6E73] dark:text-[#98989D]">
            {period === 'morning' ? 'أذكار الصباح · حصن المسلم' : 'أذكار المساء · حصن المسلم'}
          </div>
          <div className="font-numeric text-sm font-bold text-black dark:text-white">
            {currentIndex + 1} / {items.length}
            <span className="mx-1.5 opacity-30">·</span>
            <span className="text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">
              مُتمّ {completedIds.length}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onFontSizeCycle}
            title="تغيير حجم الخط"
            aria-label="تغيير حجم الخط"
            className="w-10 h-10 rounded-2xl flex items-center justify-center bg-[#F5F5F7] dark:bg-[#1C1C1E] text-black dark:text-white border border-black/[0.08] dark:border-white/[0.1] cursor-pointer"
          >
            <Type className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setQuietMode((q) => !q)}
            title={quietMode ? 'إظهار المعنى والمصدر' : 'وضع القراءة الهادئ'}
            aria-label={quietMode ? 'إظهار المعنى والمصدر' : 'وضع القراءة الهادئ'}
            className="w-10 h-10 rounded-2xl flex items-center justify-center border transition-colors cursor-pointer"
            style={{
              backgroundColor: quietMode
                ? isDark
                  ? '#FFFFFF'
                  : '#000000'
                : isDark
                ? '#1C1C1E'
                : '#F5F5F7',
              color: quietMode
                ? isDark
                  ? '#000000'
                  : '#FFFFFF'
                : isDark
                ? '#FFFFFF'
                : '#000000',
              borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
            }}
          >
            {quietMode ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Progress Track colored with active card's swatch */}
      <div className="h-1.5 rounded-full overflow-hidden bg-black/[0.07] dark:bg-white/[0.1]">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.round(sessionProgressRatio * 100)}%`,
            backgroundColor: swatch.hex,
          }}
        />
      </div>

      {/* Swipe Gesture Hint */}
      <div className="flex items-center justify-center gap-2 text-xs text-[#6E6E73] dark:text-[#98989D]">
        <Hand className="w-3.5 h-3.5" />
        <span>اسحب البطاقة لليمين للانتقال للتالي — أو لليسار للرجوع</span>
      </div>

      {/* Single Active Card ONLY — Zero stacked layers underneath */}
      <article
        ref={cardRef}
        key={activeItem.id}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{
          backgroundColor: isDark ? swatch.surfaceDark : swatch.surfaceLight,
          borderColor: isDark ? swatch.borderDark : swatch.borderLight,
          color: isDark ? swatch.inkDark : swatch.inkLight,
          touchAction: 'pan-y',
          willChange: 'transform, opacity',
        }}
        className="rounded-[32px] p-6 md:p-9 border shadow-card-apple space-y-6 select-none cursor-grab active:cursor-grabbing"
      >
        {/* Card Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div
              className="flex flex-wrap items-center gap-2 text-xs font-semibold"
              style={{ color: accentColor }}
            >
              <span>{activeItem.categoryLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-numeric">التكرار {activeItem.targetCount}</span>
              <span aria-hidden="true">·</span>
              <span>{swatch.nameAr}</span>
              {isItemDone && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    مُتمّ
                  </span>
                </>
              )}
              {isSkipped && !isItemDone && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>مُتخطّى</span>
                </>
              )}
            </div>
            <h2
              className="text-lg md:text-xl font-bold font-arabic-display"
              style={{ color: accentColor }}
            >
              {activeItem.title}
            </h2>
          </div>

          <div
            data-no-swipe="true"
            className="flex items-center gap-1.5 shrink-0"
          >
            <button
              type="button"
              onClick={() => onToggleFavorite(activeItem.id)}
              aria-label={isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
              className="w-11 h-11 rounded-2xl flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
              style={{
                backgroundColor: cardPillBg,
              }}
            >
              <Heart
                className="w-5 h-5"
                fill={isFav ? '#FF5099' : 'none'}
                stroke={isFav ? '#FF5099' : 'currentColor'}
              />
            </button>

            <button
              type="button"
              onClick={handleSkip}
              aria-label="تخطي هذا الذكر"
              title="تخطي الذكر (لا يُحتسب ضمن الأذكار المُتمّة)"
              className="min-h-[44px] px-3 rounded-2xl flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
              style={{
                backgroundColor: cardPillBg,
              }}
            >
              <span>تخطي</span>
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Complete Authentic Arabic Dhikr Text */}
        <div className="py-2 md:py-4 text-center">
          <p
            className={`font-arabic-quran font-normal ${FONT_SIZE_CLASSES[fontSize]}`}
            style={{ textWrap: 'pretty' }}
          >
            <DhikrText text={activeItem.arabicText} accentColor={accentColor} />
          </p>
        </div>

        {/* Interactive Repetition Counter */}
        <div data-no-swipe="true" className="pt-1">
          <RepetitionCounter
            current={activeCount}
            target={activeItem.targetCount}
            swatch={swatch}
            isDark={isDark}
            reducedMotion={reducedMotion}
            onIncrement={handleIncrement}
            onUndo={handleUndo}
            onSetCount={handleSetCount}
          />
        </div>

        {/* Prompt when card repetitions finish */}
        {isItemDone && (
          <div
            data-no-swipe="true"
            className="flex flex-col items-center gap-2.5 pt-1 text-center"
          >
            <div
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full"
              style={{ backgroundColor: cardPillBg, color: accentColor }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {currentIndex === items.length - 1
                  ? 'ما شاء الله! اسحب البطاقة لليمين لرؤية تهنئة الختام'
                  : 'أحسنت — اسحب البطاقة لليمين للذكر التالي'}
              </span>
            </div>

            {currentIndex === items.length - 1 && (
              <button
                type="button"
                onClick={() => finishSessionIfReady(counts, completedIds, skippedIds)}
                className="min-h-[42px] px-5 py-2 rounded-2xl text-xs font-semibold cursor-pointer transition-transform active:scale-95"
                style={{
                  backgroundColor: isDark ? swatch.hex : isWhiteInkLight ? '#FFFFFF' : swatch.inkLight,
                  color: isDark ? '#000000' : isWhiteInkLight ? '#000000' : '#FFFFFF',
                }}
              >
                إتمام الورد الآن
              </button>
            )}
          </div>
        )}

        {/* Meaning, Established Virtue & Source Citations (hidden in Quiet Reading Mode) */}
        {!quietMode && (
          <div
            className="space-y-4 pt-5 border-t"
            style={{ borderColor: isDark ? swatch.borderDark : swatch.borderLight }}
          >
            <div className="space-y-1.5">
              <h3
                className="text-xs font-bold flex items-center gap-1.5"
                style={{ color: accentColor }}
              >
                <BookOpenText className="w-4 h-4" />
                <span>معنى الذكر</span>
              </h3>
              <p className="text-sm leading-relaxed opacity-95">{activeItem.meaning}</p>
            </div>

            <div className="space-y-1.5">
              <h3
                className="text-xs font-bold flex items-center gap-1.5"
                style={{ color: accentColor }}
              >
                <Sparkles className="w-4 h-4" />
                <span>الفضل الوارد</span>
              </h3>
              {activeItem.establishedVirtue ? (
                <p className="text-sm leading-relaxed opacity-95">
                  {activeItem.establishedVirtue}
                </p>
              ) : (
                <p className="text-xs leading-relaxed opacity-80">
                  ذِكر مأثور ثابت في حصن المسلم والسنة النبوية؛ ولم يُذكر في نص روايته ثواب عددي خاص، وفضله في عموم ذكر الله والدعاء والتوكل عليه.
                </p>
              )}
            </div>

            {activeItem.scholarlyNote && (
              <div
                className="p-3.5 rounded-2xl text-xs leading-relaxed flex items-start gap-2"
                style={{
                  backgroundColor: cardPillBg,
                }}
              >
                <Info className="w-4 h-4 shrink-0 mt-0.5 opacity-85" />
                <span>{activeItem.scholarlyNote}</span>
              </div>
            )}

            <div
              data-no-swipe="true"
              className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs opacity-85"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold">{activeItem.sourceCollection}</span>
                <span aria-hidden="true">·</span>
                <span>{activeItem.hadithOrVerseRef}</span>
                <span aria-hidden="true">·</span>
                <span>{activeItem.authenticityGrade}</span>
              </div>
              <a
                href={activeItem.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-4 hover:opacity-100"
              >
                <span>التحقق من المصدر</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        )}
      </article>

      {/* Clean Single-Row Quick Navigation Controls */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={previousCard}
          disabled={currentIndex === 0}
          className="min-h-[44px] px-4 py-2 rounded-2xl flex items-center gap-1.5 text-xs font-semibold bg-[#F5F5F7] dark:bg-[#1C1C1E] text-black dark:text-white border border-black/[0.08] dark:border-white/[0.1] disabled:opacity-35 cursor-pointer disabled:cursor-default transition-opacity"
        >
          <ChevronRight className="w-4 h-4" />
          <span>السابق</span>
        </button>

        <button
          type="button"
          onClick={advanceCard}
          className="min-h-[44px] px-5 py-2 rounded-2xl flex items-center gap-1.5 text-xs font-semibold bg-black text-white dark:bg-white dark:text-black cursor-pointer transition-transform active:scale-95"
        >
          <span>{currentIndex === items.length - 1 ? 'إتمام الورد' : 'التالي'}</span>
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
