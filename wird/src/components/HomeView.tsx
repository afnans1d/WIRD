import React from 'react';
import { motion } from 'motion/react';
import {
  Heart,
  BookOpen,
  History,
  Bell,
  Download,
  CheckCircle2,
  ChevronLeft,
  Sun,
  Moon,
} from 'lucide-react';
import { MorningIllustration, EveningIllustration, WirdLogoMark } from './Illustrations';
import { PALETTE_SWATCHES } from '../design/tokens';
import type { SessionProgress } from '../lib/storage';
import { getAdhkarByPeriod } from '../data/adhkar';

export type AppRoute =
  | 'home'
  | 'morning'
  | 'evening'
  | 'favorites'
  | 'library'
  | 'history'
  | 'notifications'
  | 'install'
  | 'settings';

interface HomeViewProps {
  isDark: boolean;
  reducedMotion: boolean;
  morningSession: SessionProgress | null;
  eveningSession: SessionProgress | null;
  favoritesCount: number;
  historyCount: number;
  onNavigate: (route: AppRoute) => void;
  onSwitchPeriodMode: (period: 'morning' | 'evening') => void;
  onOpenCompletion?: (period: 'morning' | 'evening') => void;
  isInstalled: boolean;
}

export const HomeView: React.FC<HomeViewProps> = ({
  isDark,
  reducedMotion,
  morningSession,
  eveningSession,
  favoritesCount,
  historyCount,
  onNavigate,
  onSwitchPeriodMode,
  onOpenCompletion,
  isInstalled,
}) => {
  // Light mode = Morning Adhkar ONLY; Dark/Night mode = Evening Adhkar ONLY
  const activePeriod: 'morning' | 'evening' = isDark ? 'evening' : 'morning';
  const activeSession = isDark ? eveningSession : morningSession;
  const totalCount = getAdhkarByPeriod(activePeriod).length;
  const completedCount = activeSession?.completedIds.length || 0;
  const isDone = Boolean(activeSession?.isCompleted);
  const progressRatio = Math.min(1, completedCount / Math.max(1, totalCount));

  const formattedArabicDate = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  const appleRows: Array<{
    route: AppRoute;
    title: string;
    detail: string;
    icon: React.ReactNode;
    accentBg: string;
    accentFg: string;
  }> = [
    {
      route: 'favorites',
      title: 'المفضلة',
      detail: favoritesCount > 0 ? `${favoritesCount}` : 'فارغة',
      icon: <Heart className="w-4 h-4" />,
      accentBg: '#FF5099', // snapdragon
      accentFg: '#FFFFFF',
    },
    {
      route: 'history',
      title: 'سجل الأذكار',
      detail: historyCount > 0 ? `${historyCount} جلسة` : 'لا يوجد',
      icon: <History className="w-4 h-4" />,
      accentBg: '#81BC00', // clover
      accentFg: '#FFFFFF',
    },
    {
      route: 'library',
      title: 'جميع الأذكار',
      detail: 'تصفح وبحث',
      icon: <BookOpen className="w-4 h-4" />,
      accentBg: '#54ADD4', // atlantic blue
      accentFg: '#FFFFFF',
    },
    {
      route: 'notifications',
      title: 'التنبيهات',
      detail: 'مواعيد التذكير',
      icon: <Bell className="w-4 h-4" />,
      accentBg: '#4D6FF4', // blueberry
      accentFg: '#FFFFFF',
    },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-12">
      {/* Apple Large Title Header + Enlarged Logo + Morning/Night Mode Segmented Switch */}
      <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-5 pt-2">
        <div className="space-y-3">
          <WirdLogoMark className="h-14 md:h-16 w-auto" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">
              {formattedArabicDate}
            </p>
            <h1 className="text-3xl md:text-4xl font-bold font-arabic-display tracking-tight text-black dark:text-white">
              {activePeriod === 'morning' ? 'صباح الخير' : 'مساء السكينة'}
            </h1>
          </div>
        </div>

        {/* Apple Segmented Control: Morning (Light/White) vs Evening (Night/Black) */}
        <div
          role="group"
          aria-label="تبديل وضع الصباح والمساء"
          className="inline-flex items-center p-1 rounded-2xl bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/[0.1] self-start sm:self-auto"
        >
          <button
            type="button"
            onClick={() => onSwitchPeriodMode('morning')}
            className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              activePeriod === 'morning'
                ? 'bg-white text-black shadow-sm'
                : 'text-[#6E6E73] dark:text-[#98989D] hover:text-white'
            }`}
          >
            <Sun className="w-3.5 h-3.5" style={{ color: activePeriod === 'morning' ? '#FFAF22' : undefined }} />
            <span>الصباح</span>
          </button>

          <button
            type="button"
            onClick={() => onSwitchPeriodMode('evening')}
            className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              activePeriod === 'evening'
                ? 'bg-[#2C2C2E] text-white shadow-sm'
                : 'text-[#6E6E73] hover:text-black'
            }`}
          >
            <Moon className="w-3.5 h-3.5" style={{ color: activePeriod === 'evening' ? '#C49EE8' : undefined }} />
            <span>الوضع الليلي</span>
          </button>
        </div>
      </section>

      {/* Single Focused Hero Card for Active Mode ONLY (Morning in Light, Evening in Dark) */}
      <motion.section
        key={activePeriod}
        initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="space-y-3"
      >
        <button
          type="button"
          onClick={() => onNavigate(activePeriod)}
          className="group w-full text-right rounded-[28px] p-6 md:p-9 bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/[0.12] shadow-card-apple transition-transform active:scale-[0.99] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            <div className="md:col-span-6 space-y-4">
              <div className="text-xs font-medium text-[#6E6E73] dark:text-[#98989D] flex items-center gap-2">
                <span>{activePeriod === 'morning' ? 'الوضع الصباحي' : 'الوضع الليلي'}</span>
                <span aria-hidden="true">·</span>
                <span className="font-numeric">{totalCount} ذكراً من حصن المسلم</span>
              </div>

              <h2 className="text-2xl md:text-3xl font-bold font-arabic-display text-black dark:text-white">
                {activePeriod === 'morning' ? 'أذكار الصباح' : 'أذكار المساء'}
              </h2>

              <p className="text-sm text-[#3A3A3C] dark:text-[#AEAEB2] leading-relaxed">
                {activePeriod === 'morning'
                  ? 'افتح نافذة يومك ببطاقات ملونة هادئة؛ اسحب كل بطاقة بيدك بعد إتمام ذكرها.'
                  : 'اختم ليلتك بسكينة وطمأنينة؛ اسحب البطاقات بلمسة يدك الواحدة تلو الأخرى.'}
              </p>

              {/* Progress Track using Attached Palette Colors */}
              <div className="space-y-2 pt-1">
                <div className="h-2 rounded-full overflow-hidden bg-black/[0.07] dark:bg-white/[0.1] flex">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.round(progressRatio * 100)}%`,
                      background:
                        activePeriod === 'morning'
                          ? 'linear-gradient(90deg, #FFC900, #FF6632, #FF5099)'
                          : 'linear-gradient(90deg, #54ADD4, #4D6FF4, #C49EE8)',
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs">
                  {isDone ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-black dark:text-white">
                      <CheckCircle2 className="w-4 h-4" style={{ color: '#81BC00' }} />
                      <span>ما شاء الله! أتممت الورد في حفظ الله</span>
                    </span>
                  ) : (
                    <span className="text-[#6E6E73] dark:text-[#98989D] font-numeric">
                      {completedCount > 0 ? `أُنجز ${completedCount} من ${totalCount}` : 'جاهز للبداية'}
                    </span>
                  )}
                  <span className="font-semibold text-black dark:text-white inline-flex items-center gap-1 group-hover:-translate-x-1 transition-transform">
                    <span>{completedCount > 0 && !isDone ? 'متابعة' : isDone ? 'قراءة مجدداً' : 'ابدأ الآن'}</span>
                    <ChevronLeft className="w-4 h-4" />
                  </span>
                </div>
              </div>
            </div>

            {/* Attached Open Window Illustration */}
            <div className="md:col-span-6 flex items-center justify-center">
              <div className="w-full rounded-3xl p-3 bg-white dark:bg-[#141416] border border-black/[0.05] dark:border-white/[0.08]">
                {activePeriod === 'morning' ? <MorningIllustration /> : <EveningIllustration />}
              </div>
            </div>
          </div>
        </button>

        {isDone && onOpenCompletion && (
          <button
            type="button"
            onClick={() => onOpenCompletion(activePeriod)}
            className="w-full min-h-[44px] px-5 py-2.5 rounded-2xl text-xs font-semibold flex items-center justify-center gap-2 bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/[0.12] text-black dark:text-white hover:opacity-85 transition-opacity cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" style={{ color: '#81BC00' }} />
            <span>عرض تهنئة إتمام الورد</span>
          </button>
        )}
      </motion.section>

      {/* Subtle Palette Preview Strip (honoring the 36-swatch card palette) */}
      <div className="flex items-center gap-1 px-1" aria-hidden="true">
        {PALETTE_SWATCHES.slice(0, 18).map((s) => (
          <span
            key={s.id}
            className="h-1 flex-1 rounded-full opacity-80"
            style={{ backgroundColor: s.hex }}
          />
        ))}
      </div>

      {/* Apple Inset Grouped List Navigation */}
      <section className="rounded-[22px] overflow-hidden bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.07] dark:border-white/[0.1] divide-y divide-black/[0.07] dark:divide-white/[0.08]">
        {appleRows.map((row) => (
          <button
            key={row.route}
            type="button"
            onClick={() => onNavigate(row.route)}
            className="w-full px-5 py-3.5 min-h-[56px] flex items-center justify-between gap-4 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors cursor-pointer text-right"
          >
            <div className="flex items-center gap-3.5">
              <span
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: row.accentBg, color: row.accentFg }}
              >
                {row.icon}
              </span>
              <span className="text-sm font-semibold text-black dark:text-white">
                {row.title}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#6E6E73] dark:text-[#98989D]">
              <span className="font-numeric">{row.detail}</span>
              <ChevronLeft className="w-4 h-4 opacity-60" />
            </div>
          </button>
        ))}

        {!isInstalled && (
          <button
            type="button"
            onClick={() => onNavigate('install')}
            className="w-full px-5 py-3.5 min-h-[56px] flex items-center justify-between gap-4 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors cursor-pointer text-right"
          >
            <div className="flex items-center gap-3.5">
              <span
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-black text-white dark:bg-white dark:text-black"
              >
                <Download className="w-4 h-4" />
              </span>
              <span className="text-sm font-semibold text-black dark:text-white">
                تثبيت التطبيق على جهازك
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-[#6E6E73] dark:text-[#98989D]">
              <span>iPhone · Android · Mac</span>
              <ChevronLeft className="w-4 h-4 opacity-60" />
            </div>
          </button>
        )}
      </section>
    </div>
  );
};
