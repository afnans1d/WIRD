import React from 'react';
import { motion } from 'motion/react';
import { Home, BookOpenCheck, RotateCcw, CheckCircle2 } from 'lucide-react';
import { PaperConfettiBurst, WirdLogoMark } from './Illustrations';
import { PALETTE_SWATCHES } from '../design/tokens';

interface CompletionViewProps {
  period: 'morning' | 'evening';
  completedCount: number;
  skippedCount: number;
  totalCount: number;
  isDark: boolean;
  reducedMotion: boolean;
  onReturnHome: () => void;
  onReviewAdhkar: () => void;
  onRestartSkipped?: () => void;
}

export const CompletionView: React.FC<CompletionViewProps> = ({
  period,
  completedCount,
  skippedCount,
  totalCount,
  isDark,
  reducedMotion,
  onReturnHome,
  onReviewAdhkar,
  onRestartSkipped,
}) => {
  const fannedSwatches = [
    PALETTE_SWATCHES[1], // ocean breeze
    PALETTE_SWATCHES[2], // cotton candy sky
    PALETTE_SWATCHES[4], // wisteria
    PALETTE_SWATCHES[6], // mint
    PALETTE_SWATCHES[5], // lemon
  ];

  return (
    <>
      <PaperConfettiBurst reducedMotion={reducedMotion} />

      <div className="max-w-2xl mx-auto py-8 md:py-12 px-2">
        <div className="relative">
          {/* Fanned colorful palette cards behind completion card */}
          <div className="hidden sm:flex justify-center gap-2 mb-[-18px] relative z-0" aria-hidden="true">
            {fannedSwatches.map((sw, idx) => (
              <motion.div
                key={sw.id}
                initial={reducedMotion ? { opacity: 0.9 } : { opacity: 0, y: 24, rotate: 0 }}
                animate={{
                  opacity: 0.94,
                  y: 0,
                  rotate: (idx - 2) * 6,
                }}
                transition={{ duration: 0.55, delay: 0.05 + idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
                className="w-20 h-14 rounded-2xl border border-black/10 dark:border-white/10 shadow-sm"
                style={{ backgroundColor: isDark ? sw.surfaceDark : sw.hex }}
              />
            ))}
          </div>

          <motion.div
            initial={reducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 rounded-[32px] p-8 md:p-12 border shadow-card-apple text-center space-y-7 overflow-hidden bg-[#F5F5F7] dark:bg-[#1C1C1E] border-black/[0.08] dark:border-white/[0.12]"
          >
            {/* Full Palette Top Accent Bar */}
            <div className="flex items-center gap-1 max-w-md mx-auto" aria-hidden="true">
              {PALETTE_SWATCHES.slice(0, 18).map((s) => (
                <span
                  key={s.id}
                  className="h-1.5 flex-1 rounded-full opacity-95"
                  style={{ backgroundColor: s.hex }}
                />
              ))}
            </div>

            {/* Enlarged Official WIRD Logo */}
            <div className="flex justify-center pt-1">
              <WirdLogoMark className="h-16 md:h-20 w-auto" />
            </div>

            {/* Clean Apple Checkmark Badge (no rotating animation) */}
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-full bg-white dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/[0.12] shadow-sm flex items-center justify-center">
                <CheckCircle2 className="w-9 h-9" style={{ color: '#81BC00' }} />
              </div>
            </div>

            {/* Exact User Encouraging Phrase */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-[#6E6E73] dark:text-[#98989D]">
                {period === 'morning' ? 'أذكار الصباح' : 'أذكار المساء'}
                <span className="mx-2">·</span>
                <span className="font-numeric">
                  أتممت {completedCount} من {totalCount} ذكراً
                </span>
                {skippedCount > 0 && (
                  <>
                    <span className="mx-2">·</span>
                    <span className="font-numeric">تم تخطي {skippedCount}</span>
                  </>
                )}
              </p>

              <h1
                className="text-2xl md:text-4xl font-bold font-arabic-display leading-[1.5] text-black dark:text-white"
                style={{ textWrap: 'balance' }}
              >
                ما شاء الله عليك ، أتممت وِردك انت الان في حفظ الله
              </h1>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={onReturnHome}
                className="w-full sm:w-auto min-h-[48px] px-7 py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 bg-black text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity cursor-pointer"
              >
                <Home className="w-4 h-4" />
                <span>العودة إلى الرئيسية</span>
              </button>

              <button
                type="button"
                onClick={onReviewAdhkar}
                className="w-full sm:w-auto min-h-[48px] px-6 py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 bg-white dark:bg-[#2C2C2E] text-black dark:text-white border border-black/10 dark:border-white/12 hover:opacity-90 transition-opacity cursor-pointer"
              >
                <BookOpenCheck className="w-4 h-4" />
                <span>مراجعة الأذكار المُتمّة</span>
              </button>

              {skippedCount > 0 && onRestartSkipped && (
                <button
                  type="button"
                  onClick={onRestartSkipped}
                  className="w-full sm:w-auto min-h-[48px] px-5 py-3 rounded-2xl font-medium text-sm flex items-center justify-center gap-2 text-[#6E6E73] dark:text-[#98989D] hover:underline cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>العودة للأذكار المتخطّاة</span>
                </button>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </>
  );
};
