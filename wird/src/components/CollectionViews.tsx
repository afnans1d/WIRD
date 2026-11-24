import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Heart,
  Search,
  BookOpen,
  History,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { VERIFIED_ADHKAR, type DhikrItem } from '../data/adhkar';
import { PALETTE_SWATCHES } from '../design/tokens';
import type { HistoryRecord } from '../lib/storage';
import { DhikrText } from './DhikrText';

function stripArabicDiacritics(input: string): string {
  return input
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
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

interface FavoritesViewProps {
  favorites: string[];
  isDark: boolean;
  onToggleFavorite: (id: string) => void;
  onOpenDhikr: (item: DhikrItem) => void;
  onBackHome: () => void;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  favorites,
  isDark,
  onToggleFavorite,
  onOpenDhikr,
  onBackHome,
}) => {
  const favItems = useMemo(
    () => VERIFIED_ADHKAR.filter((d) => favorites.includes(d.id)),
    [favorites]
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackHome}
          className="min-h-[42px] px-4 py-2 rounded-2xl flex items-center gap-2 text-xs font-semibold bg-[#F5F5F7] dark:bg-[#1C1C1E] text-black dark:text-white border border-black/[0.08] dark:border-white/[0.1] cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>الرئيسية</span>
        </button>
        <h1 className="text-xl md:text-2xl font-bold font-arabic-display text-black dark:text-white">
          المفضلة
        </h1>
        <span className="font-numeric text-xs text-[#6E6E73] dark:text-[#98989D]">
          {favItems.length} ذكراً
        </span>
      </div>

      {favItems.length === 0 ? (
        <div className="rounded-[28px] p-10 text-center bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.07] dark:border-white/[0.1] space-y-3">
          <div
            className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: '#FF5099', color: '#FFFFFF' }}
          >
            <Heart className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold font-arabic-display text-black dark:text-white">
            لا توجد أذكار في المفضلة بعد
          </h2>
          <p className="text-sm text-[#6E6E73] dark:text-[#98989D] max-w-md mx-auto leading-relaxed">
            أثناء قراءتك لأذكار الصباح أو المساء، اضغط على أيقونة القلب لحفظ الأذكار التي تحب الرجوع إليها سريعاً.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {favItems.map((item, idx) => {
            const swatch = PALETTE_SWATCHES[(idx * 3 + 2) % PALETTE_SWATCHES.length];
            const accent = isDark ? swatch.accentDark : swatch.accentLight;
            const ink = isDark ? swatch.inkDark : swatch.inkLight;
            const ctaBg = isDark ? swatch.hex : swatch.accentLight;
            const ctaFg = getContrastOnColor(ctaBg);
            const isLightInk = !isDark && getRelativeLuminance(ink) > 0.7;

            return (
              <div
                key={item.id}
                className="rounded-[28px] p-6 border flex flex-col justify-between gap-4 shadow-card-apple"
                style={{
                  backgroundColor: isDark ? swatch.surfaceDark : swatch.surfaceLight,
                  borderColor: isDark ? swatch.borderDark : swatch.borderLight,
                  color: ink,
                }}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold" style={{ color: accent }}>
                        {item.categoryLabel} · <span className="font-numeric">{item.targetCount} مرات</span>
                      </div>
                      <h3 className="text-lg font-bold font-arabic-display mt-0.5" style={{ color: accent }}>
                        {item.title}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(item.id)}
                      aria-label="إزالة من المفضلة"
                      className="w-11 h-11 rounded-2xl flex items-center justify-center cursor-pointer shrink-0"
                      style={{
                        backgroundColor: isDark
                          ? 'rgba(255,255,255,0.1)'
                          : isLightInk
                          ? 'rgba(0,0,0,0.2)'
                          : 'rgba(255,255,255,0.6)',
                      }}
                    >
                      <Heart className="w-4 h-4" fill="#FF5099" stroke="#FF5099" />
                    </button>
                  </div>
                  <p className="font-arabic-quran text-base leading-[1.95] line-clamp-3">
                    <DhikrText text={item.arabicText} accentColor={accent} />
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenDhikr(item)}
                  className="min-h-[44px] px-4 py-2 rounded-2xl text-xs font-semibold self-start cursor-pointer"
                  style={{
                    backgroundColor: ctaBg,
                    color: ctaFg,
                  }}
                >
                  قراءة في البطاقة
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface LibraryViewProps {
  isDark: boolean;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  onOpenDhikr: (item: DhikrItem) => void;
  onBackHome: () => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  isDark,
  favorites,
  onToggleFavorite,
  onOpenDhikr,
  onBackHome,
}) => {
  const [queryText, setQueryText] = useState('');
  const [filter, setFilter] = useState<'all' | 'morning' | 'evening'>('all');

  const filtered = useMemo(() => {
    const normQuery = stripArabicDiacritics(queryText.trim());
    return VERIFIED_ADHKAR.filter((item) => {
      if (filter !== 'all' && !item.periods.includes(filter)) return false;
      if (!normQuery) return true;
      const haystack = stripArabicDiacritics(
        `${item.title} ${item.arabicText} ${item.meaning} ${item.sourceCollection} ${item.categoryLabel}`
      );
      return haystack.includes(normQuery);
    });
  }, [filter, queryText]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackHome}
          className="min-h-[42px] px-4 py-2 rounded-2xl flex items-center gap-2 text-xs font-semibold bg-[#F5F5F7] dark:bg-[#1C1C1E] text-black dark:text-white border border-black/[0.08] dark:border-white/[0.1] cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>الرئيسية</span>
        </button>
        <h1 className="text-xl md:text-2xl font-bold font-arabic-display text-black dark:text-white">
          جميع الأذكار والمصادر
        </h1>
        <span className="font-numeric text-xs text-[#6E6E73] dark:text-[#98989D]">
          {filtered.length} من {VERIFIED_ADHKAR.length}
        </span>
      </div>

      {/* Apple Clean Search & Segmented Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute right-4 top-1/2 -translate-y-1/2 text-[#6E6E73] dark:text-[#98989D] pointer-events-none" />
          <input
            type="search"
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="ابحث في نص الذكر، المعنى، أو المصدر (مثل: البخاري، مسلم، الكرسي)..."
            className="w-full min-h-[46px] pr-11 pl-4 py-2.5 rounded-2xl text-sm bg-[#F5F5F7] dark:bg-[#1C1C1E] text-black dark:text-white placeholder:text-[#6E6E73] dark:placeholder:text-[#98989D] border border-black/[0.08] dark:border-white/[0.1] focus:outline-2 focus:outline-[#4D6FF4]"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-2xl bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/[0.1] shrink-0">
          {(
            [
              { id: 'all', label: 'الكل' },
              { id: 'morning', label: 'الصباح' },
              { id: 'evening', label: 'المساء' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                filter === tab.id
                  ? 'bg-white dark:bg-[#2C2C2E] text-black dark:text-white shadow-sm'
                  : 'text-[#6E6E73] dark:text-[#98989D]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[28px] p-10 text-center bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.07] dark:border-white/[0.1] space-y-2">
          <BookOpen className="w-7 h-7 mx-auto text-[#6E6E73] dark:text-[#98989D]" />
          <p className="font-semibold text-black dark:text-white">لم نعثر على نتائج مطابقة لبحثك</p>
          <p className="text-xs text-[#6E6E73] dark:text-[#98989D]">
            جرّب كلمة أخرى بدون تشكيل أو اختر تصنيف الكل.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((item, idx) => {
            const swatch = PALETTE_SWATCHES[idx % PALETTE_SWATCHES.length];
            const isFav = favorites.includes(item.id);
            const accent = isDark ? swatch.accentDark : swatch.accentLight;
            const ink = isDark ? swatch.inkDark : swatch.inkLight;
            const ctaBg = isDark ? swatch.hex : swatch.accentLight;
            const ctaFg = getContrastOnColor(ctaBg);
            const isLightInk = !isDark && getRelativeLuminance(ink) > 0.7;

            return (
              <div
                key={item.id}
                className="rounded-[28px] p-6 border flex flex-col justify-between gap-4 shadow-card-apple"
                style={{
                  backgroundColor: isDark ? swatch.surfaceDark : swatch.surfaceLight,
                  borderColor: isDark ? swatch.borderDark : swatch.borderLight,
                  color: ink,
                }}
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="text-xs font-semibold flex flex-wrap items-center gap-1.5" style={{ color: accent }}>
                        <span>{item.categoryLabel}</span>
                        <span>·</span>
                        <span className="font-numeric">{item.targetCount}×</span>
                        <span>·</span>
                        <span>
                          {item.periods.includes('morning') && item.periods.includes('evening')
                            ? 'صباح ومساء'
                            : item.periods.includes('morning')
                            ? 'الصباح'
                            : 'المساء'}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold font-arabic-display" style={{ color: accent }}>
                        {item.title}
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={() => onToggleFavorite(item.id)}
                      aria-label={isFav ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}
                      className="w-11 h-11 rounded-2xl flex items-center justify-center cursor-pointer shrink-0"
                      style={{
                        backgroundColor: isDark
                          ? 'rgba(255,255,255,0.1)'
                          : isLightInk
                          ? 'rgba(0,0,0,0.2)'
                          : 'rgba(255,255,255,0.6)',
                      }}
                    >
                      <Heart
                        className="w-4 h-4"
                        fill={isFav ? '#FF5099' : 'none'}
                        stroke={isFav ? '#FF5099' : 'currentColor'}
                      />
                    </button>
                  </div>

                  <p className="font-arabic-quran text-base leading-[1.95] line-clamp-3">
                    <DhikrText text={item.arabicText} accentColor={accent} />
                  </p>
                  <p className="text-xs opacity-85 leading-relaxed line-clamp-2">{item.meaning}</p>
                </div>

                <div
                  className="flex items-center justify-between gap-2 pt-3 border-t"
                  style={{ borderColor: isDark ? swatch.borderDark : swatch.borderLight }}
                >
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs inline-flex items-center gap-1 opacity-85 hover:opacity-100 underline underline-offset-4"
                  >
                    <span>{item.sourceCollection}</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  <button
                    type="button"
                    onClick={() => onOpenDhikr(item)}
                    className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                    style={{
                      backgroundColor: ctaBg,
                      color: ctaFg,
                    }}
                  >
                    فتح البطاقة
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface HistoryViewProps {
  history: HistoryRecord[];
  isDark: boolean;
  onBackHome: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ history, isDark, onBackHome }) => {
  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBackHome}
          className="min-h-[42px] px-4 py-2 rounded-2xl flex items-center gap-2 text-xs font-semibold bg-[#F5F5F7] dark:bg-[#1C1C1E] text-black dark:text-white border border-black/[0.08] dark:border-white/[0.1] cursor-pointer"
        >
          <ArrowRight className="w-4 h-4" />
          <span>الرئيسية</span>
        </button>
        <h1 className="text-xl md:text-2xl font-bold font-arabic-display text-black dark:text-white">
          سجل الأذكار
        </h1>
        <span className="font-numeric text-xs text-[#6E6E73] dark:text-[#98989D]">
          {history.length} جلسة
        </span>
      </div>

      {history.length === 0 ? (
        <div className="rounded-[28px] p-10 text-center bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.07] dark:border-white/[0.1] space-y-3">
          <div
            className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center"
            style={{ backgroundColor: '#81BC00', color: '#FFFFFF' }}
          >
            <History className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold font-arabic-display text-black dark:text-white">
            سجلك ينتظر أول ورد مكتمل
          </h2>
          <p className="text-sm text-[#6E6E73] dark:text-[#98989D] max-w-md mx-auto leading-relaxed">
            نحفظ هنا جلساتك التي أتممتها بهدوء دون أرقام تنافسية أو ضغط.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map((rec, idx) => {
            const swatch = PALETTE_SWATCHES[(idx * 2 + 11) % PALETTE_SWATCHES.length];
            const accent = isDark ? swatch.accentDark : swatch.accentLight;
            const badgeBg = isDark ? 'rgba(255,255,255,0.12)' : accent;
            const badgeFg = isDark ? swatch.inkDark : getContrastOnColor(badgeBg);
            const dateLabel = new Intl.DateTimeFormat('ar-SA', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }).format(new Date(rec.completedAt));

            return (
              <div
                key={rec.id}
                className="rounded-2xl p-5 border flex items-center justify-between gap-4"
                style={{
                  backgroundColor: isDark ? swatch.surfaceDark : swatch.surfaceLight,
                  borderColor: isDark ? swatch.borderDark : swatch.borderLight,
                  color: isDark ? swatch.inkDark : swatch.inkLight,
                }}
              >
                <div className="flex items-center gap-3.5">
                  <div
                    className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: badgeBg,
                      color: badgeFg,
                    }}
                  >
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-base font-arabic-display" style={{ color: accent }}>
                      {rec.period === 'morning' ? 'أذكار الصباح' : 'أذكار المساء'}
                    </div>
                    <div className="text-xs opacity-80">{dateLabel}</div>
                  </div>
                </div>

                <div className="text-left font-numeric text-xs font-semibold">
                  <div>
                    أُتمّ {rec.completedCount} من {rec.totalCount}
                  </div>
                  {rec.skippedCount > 0 && (
                    <div className="opacity-70">تخطي {rec.skippedCount}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
