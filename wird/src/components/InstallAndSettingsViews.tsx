import React, { useState } from 'react';
import {
  ArrowRight,
  Download,
  Smartphone,
  Laptop,
  CheckCircle2,
  Sun,
  Moon,
  Palette,
  ShieldCheck,
  BookMarked,
  Cloud,
  LogOut,
  WifiOff,
  Wifi,
  Bell,
  ChevronLeft,
  Vibrate,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { PALETTE_SWATCHES } from '../design/tokens';
import type { FontSizeScale, UserPreferencesState } from '../lib/storage';
import { usePWAInstall, useOnlineStatus, useOfflineCapability } from '../hooks/usePWAInstall';
import { WirdLogoMark } from './Illustrations';

interface AppleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  activeColor?: string;
}

const AppleSwitch: React.FC<AppleSwitchProps> = ({
  checked,
  onChange,
  ariaLabel,
  activeColor = '#81BC00',
}) => (
  <button
    type="button"
    dir="ltr"
    role="switch"
    aria-checked={checked}
    aria-label={ariaLabel}
    onClick={() => onChange(!checked)}
    className="relative inline-flex items-center justify-start w-12 h-7 rounded-full p-0.5 transition-colors duration-200 shrink-0 cursor-pointer overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2"
    style={{
      backgroundColor: checked ? activeColor : 'rgba(120, 120, 128, 0.28)',
    }}
  >
    <span
      aria-hidden="true"
      className="w-6 h-6 rounded-full bg-white shadow-sm transition-transform duration-200"
      style={{
        transform: checked ? 'translateX(20px)' : 'translateX(0px)',
      }}
    />
  </button>
);

interface InstallGuideViewProps {
  isDark: boolean;
  onBackHome: () => void;
}

export const InstallGuideView: React.FC<InstallGuideViewProps> = ({ isDark, onBackHome }) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackHome}
          className="min-h-[42px] px-4 py-2 rounded-2xl flex items-center gap-2 text-xs font-semibold bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/[0.1] shrink-0 cursor-pointer"
        >
          <ArrowRight className="w-4 h-4 shrink-0" />
          <span>الرئيسية</span>
        </button>
        <h1 className="text-lg sm:text-2xl font-bold font-arabic-display truncate text-center">
          دليل تثبيت تطبيق وِرد
        </h1>
        <span className="text-xs font-semibold text-[#6E6E73] dark:text-[#98989D] shrink-0">PWA</span>
      </div>

      <section className="rounded-3xl p-5 sm:p-6 border border-black/[0.08] dark:border-white/[0.1] bg-[#F5F5F7] dark:bg-[#1C1C1E] flex flex-col sm:flex-row sm:items-center justify-between gap-4 overflow-hidden">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-16 h-16 rounded-2xl bg-white border border-black/[0.08] flex items-center justify-center p-2 shrink-0 shadow-sm overflow-hidden">
            <WirdLogoMark className="w-full h-full" />
          </div>
          <div className="space-y-1 min-w-0">
            <h2 className="text-base font-bold font-arabic-display">
              {isInstalled
                ? 'تطبيق وِرد يعمل الآن كتطبيق مستقل مثبت ✓'
                : 'ثبّت وِرد على جهازك للفتح الفوري والعمل دون إنترنت'}
            </h2>
            <p className="text-xs text-[#6E6E73] dark:text-[#98989D] leading-relaxed">
              يعمل التطبيق في نافذة مستقلة (Standalone) بأيقونة وِرد الرسمية ويدعم القراءة بدون اتصال وتلقي الإشعارات.
            </p>
          </div>
        </div>

        {!isInstalled && isInstallable && (
          <button
            type="button"
            onClick={install}
            className="min-h-[44px] px-5 py-2.5 rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 bg-black text-white dark:bg-white dark:text-black shrink-0 cursor-pointer"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>تثبيت التطبيق الآن</span>
          </button>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <article
          className="rounded-3xl p-6 border space-y-3 overflow-hidden"
          style={{
            backgroundColor: isDark ? PALETTE_SWATCHES[2].surfaceDark : PALETTE_SWATCHES[2].surfaceLight,
            borderColor: isDark ? PALETTE_SWATCHES[2].borderDark : PALETTE_SWATCHES[2].borderLight,
            color: isDark ? PALETTE_SWATCHES[2].inkDark : PALETTE_SWATCHES[2].inkLight,
          }}
        >
          <div className="flex items-center gap-2 font-bold text-base font-arabic-display">
            <Smartphone className="w-5 h-5 shrink-0" />
            <span>iPhone و iPad (Safari)</span>
          </div>
          <ol className="text-xs space-y-2 list-decimal list-inside leading-relaxed opacity-90">
            <li>افتح موقع وِرد عبر متصفح Safari.</li>
            <li>اضغط على زر المشاركة (Share) في شريط Safari.</li>
            <li>اختر «إضافة إلى الشاشة الرئيسية» (Add to Home Screen).</li>
            <li>أكّد اسم التطبيق (وِرد) واضغط إضافة.</li>
            <li>افتح وِرد من أيقونته الجديدة لتفعيل الإشعارات (iOS 16.4 فأحدث).</li>
          </ol>
        </article>

        <article
          className="rounded-3xl p-6 border space-y-3 overflow-hidden"
          style={{
            backgroundColor: isDark ? PALETTE_SWATCHES[5].surfaceDark : PALETTE_SWATCHES[5].surfaceLight,
            borderColor: isDark ? PALETTE_SWATCHES[5].borderDark : PALETTE_SWATCHES[5].borderLight,
            color: isDark ? PALETTE_SWATCHES[5].inkDark : PALETTE_SWATCHES[5].inkLight,
          }}
        >
          <div className="flex items-center gap-2 font-bold text-base font-arabic-display">
            <Smartphone className="w-5 h-5 shrink-0" />
            <span>Android (Chrome)</span>
          </div>
          <ol className="text-xs space-y-2 list-decimal list-inside leading-relaxed opacity-90">
            <li>افتح وِرد عبر متصفح Google Chrome.</li>
            <li>اضغط على زر «تثبيت التطبيق الآن» أو من قائمة ⋮ في المتصفح.</li>
            <li>اختر «تثبيت التطبيق» (Install App).</li>
            <li>افتح وِرد من أيقونة التطبيق المثبت.</li>
          </ol>
        </article>

        <article
          className="rounded-3xl p-6 border space-y-3 overflow-hidden"
          style={{
            backgroundColor: isDark ? PALETTE_SWATCHES[1].surfaceDark : PALETTE_SWATCHES[1].surfaceLight,
            borderColor: isDark ? PALETTE_SWATCHES[1].borderDark : PALETTE_SWATCHES[1].borderLight,
            color: isDark ? PALETTE_SWATCHES[1].inkDark : PALETTE_SWATCHES[1].inkLight,
          }}
        >
          <div className="flex items-center gap-2 font-bold text-base font-arabic-display">
            <Laptop className="w-5 h-5 shrink-0" />
            <span>macOS (Safari و Chrome)</span>
          </div>
          <ol className="text-xs space-y-2 list-decimal list-inside leading-relaxed opacity-90">
            <li>في Safari على macOS Sonoma فأحدث: من قائمة ملف ← «إضافة إلى Dock».</li>
            <li>في Chrome: اضغط أيقونة التثبيت في شريط العنوان.</li>
            <li>يدعم Safari و Chrome على macOS إشعارات الويب الدفعية.</li>
          </ol>
        </article>
      </div>
    </div>
  );
};

interface SettingsViewProps {
  prefs: UserPreferencesState;
  isDark: boolean;
  user: User | null;
  onUpdatePrefs: (patch: Partial<UserPreferencesState>) => void;
  onGoogleSignIn: () => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  onOpenNotifications: () => void;
  onOpenInstallGuide: () => void;
  onBackHome: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  prefs,
  isDark,
  user,
  onUpdatePrefs,
  onGoogleSignIn,
  onGoogleSignOut,
  onOpenNotifications,
  onOpenInstallGuide,
  onBackHome,
}) => {
  const isOnline = useOnlineStatus();
  const { swReady, cachedCount, warming, warmOfflineCache } = useOfflineCapability();
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const handleAuth = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      if (user) {
        await onGoogleSignOut();
      } else {
        await onGoogleSignIn();
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'تعذر إتمام تسجيل الدخول');
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-14">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackHome}
          className="min-h-[42px] px-3.5 py-2 rounded-2xl flex items-center gap-1.5 text-xs font-semibold bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/[0.1] shrink-0 cursor-pointer"
        >
          <ArrowRight className="w-4 h-4 shrink-0" />
          <span>الرئيسية</span>
        </button>

        <h1 className="text-lg sm:text-2xl font-bold font-arabic-display truncate text-center">
          الإعدادات
        </h1>

        <div className="min-h-[34px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/[0.08] text-[#6E6E73] dark:text-[#98989D] shrink-0">
          {isOnline ? (
            <Wifi className="w-3.5 h-3.5 shrink-0 text-[#81BC00]" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 shrink-0 text-[#F0774F]" />
          )}
          <span className="whitespace-nowrap">{isOnline ? 'متصل' : 'دون اتصال'}</span>
        </div>
      </div>

      {/* Section 1: Reading & Display Settings (Apple Grouped Card) */}
      <section className="rounded-[26px] border border-black/[0.08] dark:border-white/[0.1] bg-[#F5F5F7] dark:bg-[#1C1C1E] overflow-hidden divide-y divide-black/[0.07] dark:divide-white/[0.08]">
        {/* Theme Mode */}
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: isDark ? '#4D6FF4' : '#FFAF22',
                color: '#FFFFFF',
              }}
            >
              {isDark ? <Moon className="w-4 h-4 shrink-0" /> : <Sun className="w-4 h-4 shrink-0" />}
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-sm">الوضع الصباحي والليلي</div>
              <div className="text-xs text-[#6E6E73] dark:text-[#98989D] leading-relaxed">
                الصباح لأذكار الصباح والوضع الليلي لأذكار المساء
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-white dark:bg-black border border-black/[0.06] dark:border-white/[0.1] w-full sm:w-auto shrink-0">
            {(
              [
                { id: 'light', label: 'الصباح', icon: Sun },
                { id: 'dark', label: 'الليلي', icon: Moon },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active =
                prefs.theme === opt.id ||
                (prefs.theme === 'system' && opt.id === (isDark ? 'dark' : 'light'));
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onUpdatePrefs({ theme: opt.id })}
                  className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                    active
                      ? 'bg-black text-white dark:bg-white dark:text-black'
                      : 'text-[#6E6E73] dark:text-[#98989D]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Arabic Font Size */}
        <div className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#54ADD4', color: '#FFFFFF' }}
            >
              <BookOpen className="w-4 h-4 shrink-0" />
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-sm">حجم الخط العربي</div>
              <div className="text-xs text-[#6E6E73] dark:text-[#98989D] leading-relaxed">
                خط ثمانية سيرف (Thmanyah Serif) للنصوص والآيات
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-white dark:bg-black border border-black/[0.06] dark:border-white/[0.1] w-full sm:w-auto shrink-0">
            {(
              [
                { id: 'sm', label: 'صغير' },
                { id: 'md', label: 'متوسط' },
                { id: 'lg', label: 'كبير' },
                { id: 'xl', label: 'عريض' },
              ] as Array<{ id: FontSizeScale; label: string }>
            ).map((sz) => (
              <button
                key={sz.id}
                type="button"
                onClick={() => onUpdatePrefs({ fontSize: sz.id })}
                className={`min-h-[38px] px-2.5 sm:px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center whitespace-nowrap transition-colors cursor-pointer ${
                  prefs.fontSize === sz.id
                    ? 'bg-black text-white dark:bg-white dark:text-black'
                    : 'text-[#6E6E73] dark:text-[#98989D]'
                }`}
              >
                {sz.label}
              </button>
            ))}
          </div>
        </div>

        {/* Toggle Row 1: Haptics */}
        <div className="px-5 py-3.5 min-h-[58px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#FF5099', color: '#FFFFFF' }}
            >
              <Vibrate className="w-4 h-4 shrink-0" />
            </span>
            <span className="text-sm font-semibold truncate">الاهتزاز عند العدّ</span>
          </div>
          <AppleSwitch
            checked={prefs.hapticsEnabled}
            onChange={(val) => onUpdatePrefs({ hapticsEnabled: val })}
            ariaLabel="الاهتزاز عند العدّ"
            activeColor="#FF5099"
          />
        </div>

        {/* Toggle Row 2: Reduced Motion */}
        <div className="px-5 py-3.5 min-h-[58px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#4D6FF4', color: '#FFFFFF' }}
            >
              <Sparkles className="w-4 h-4 shrink-0" />
            </span>
            <span className="text-sm font-semibold truncate">تقليل الحركة</span>
          </div>
          <AppleSwitch
            checked={prefs.reducedMotion}
            onChange={(val) => onUpdatePrefs({ reducedMotion: val })}
            ariaLabel="تقليل الحركة"
            activeColor="#4D6FF4"
          />
        </div>

        {/* Toggle Row 3: Quiet Mode */}
        <div className="px-5 py-3.5 min-h-[58px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#81BC00', color: '#FFFFFF' }}
            >
              <BookMarked className="w-4 h-4 shrink-0" />
            </span>
            <span className="text-sm font-semibold truncate">القراءة الهادئة افتراضياً</span>
          </div>
          <AppleSwitch
            checked={prefs.quietModeDefault}
            onChange={(val) => onUpdatePrefs({ quietModeDefault: val })}
            ariaLabel="القراءة الهادئة افتراضياً"
            activeColor="#81BC00"
          />
        </div>
      </section>

      {/* Section 2: Quick Navigation Rows (Notifications & Install Guide) */}
      <section className="rounded-[26px] border border-black/[0.08] dark:border-white/[0.1] bg-[#F5F5F7] dark:bg-[#1C1C1E] overflow-hidden divide-y divide-black/[0.07] dark:divide-white/[0.08]">
        <button
          type="button"
          onClick={onOpenNotifications}
          className="w-full px-5 py-3.5 min-h-[58px] flex items-center justify-between gap-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors cursor-pointer text-right"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#4D6FF4', color: '#FFFFFF' }}
            >
              <Bell className="w-4 h-4 shrink-0" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">إعدادات التنبيهات</div>
              <div className="text-xs text-[#6E6E73] dark:text-[#98989D] truncate">
                مواعيد أذكار الصباح والمساء وساعات الهدوء
              </div>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 shrink-0 opacity-60" />
        </button>

        <button
          type="button"
          onClick={onOpenInstallGuide}
          className="w-full px-5 py-3.5 min-h-[58px] flex items-center justify-between gap-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors cursor-pointer text-right"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-black text-white dark:bg-white dark:text-black">
              <Download className="w-4 h-4 shrink-0" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">دليل التثبيت على جهازك</div>
              <div className="text-xs text-[#6E6E73] dark:text-[#98989D] truncate">
                iPhone · Android · iPad · macOS
              </div>
            </div>
          </div>
          <ChevronLeft className="w-4 h-4 shrink-0 opacity-60" />
        </button>
      </section>

      {/* Section 3: Optional Cloud Sync */}
      <section className="rounded-[26px] p-5 sm:p-6 border border-black/[0.08] dark:border-white/[0.1] bg-[#F5F5F7] dark:bg-[#1C1C1E] space-y-3 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
              style={{ backgroundColor: '#54ADD4', color: '#FFFFFF' }}
            >
              <Cloud className="w-4 h-4 shrink-0" />
            </span>
            <div className="space-y-1 min-w-0">
              <h2 className="text-sm sm:text-base font-bold font-arabic-display">
                المزامنة السحابية الاختيارية
              </h2>
              <p className="text-xs text-[#6E6E73] dark:text-[#98989D] leading-relaxed">
                {user
                  ? `متصل بحساب ${user.displayName || user.email} — تُحفظ مفضلاتك وجلساتك وتفضيلاتك بأمان.`
                  : 'يعمل وِرد بالكامل دون الحاجة لتسجيل حساب. يمكنك ربط حساب Google اختيارياً للمزامنة.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={authBusy}
            onClick={handleAuth}
            className="min-h-[42px] px-5 py-2 rounded-2xl text-xs font-semibold shrink-0 flex items-center justify-center gap-2 bg-black text-white dark:bg-white dark:text-black cursor-pointer w-full sm:w-auto"
          >
            {user ? <LogOut className="w-4 h-4 shrink-0" /> : <Cloud className="w-4 h-4 shrink-0" />}
            <span>{authBusy ? 'جاري التنفيذ...' : user ? 'تسجيل الخروج' : 'ربط حساب Google'}</span>
          </button>
        </div>
        {authError && <p className="text-xs text-[#E14C70]">{authError}</p>}
      </section>

      {/* Section 4: Offline & Authentic Sources */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <section className="rounded-[26px] p-5 sm:p-6 border border-black/[0.08] dark:border-white/[0.1] bg-[#F5F5F7] dark:bg-[#1C1C1E] space-y-2.5 overflow-hidden">
          <div className="flex items-center gap-2.5">
            <span
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#F0774F', color: '#FFFFFF' }}
            >
              <BookMarked className="w-4 h-4 shrink-0" />
            </span>
            <h3 className="text-sm font-bold">المصادر الشرعية والتوثيق</h3>
          </div>
          <p className="text-xs text-[#6E6E73] dark:text-[#98989D] leading-relaxed">
            جميع الأذكار مستمدة من كتاب «حصن المسلم» من أذكار الكتاب والسنة والقرآن الكريم وصحيح البخاري ومسلم والسنن المعتمدة.
          </p>
        </section>

        <section className="rounded-[26px] p-5 sm:p-6 border border-black/[0.08] dark:border-white/[0.1] bg-[#F5F5F7] dark:bg-[#1C1C1E] space-y-3 overflow-hidden">
          <div className="flex items-center gap-2.5">
            <span
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#81BC00', color: '#FFFFFF' }}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
            </span>
            <h3 className="text-sm font-bold">العمل بدون إنترنت والخصوصية</h3>
          </div>
          <p className="text-xs text-[#6E6E73] dark:text-[#98989D] leading-relaxed">
            جميع الأذكار والمفضلة والسجل والعدادات محفوظة محلياً وتعمل دون اتصال بالإنترنت.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2 text-xs font-semibold min-w-0">
              <CheckCircle2
                className="w-4 h-4 shrink-0"
                style={{ color: swReady || cachedCount > 0 ? '#81BC00' : '#FFAF22' }}
              />
              <span className="truncate">
                {swReady || cachedCount > 0
                  ? `جاهز بدون نت${cachedCount > 0 ? ` (${cachedCount} مورداً)` : ''}`
                  : 'جاري تجهيز التخزين المحلي...'}
              </span>
            </div>
            <button
              type="button"
              disabled={warming}
              onClick={async () => {
                const ok = await warmOfflineCache();
                setOfflineMsg(
                  ok
                    ? 'تم حفظ الواجهة والخطوط والأذكار للعمل بدون إنترنت بنجاح.'
                    : 'تعذر تحديث الذاكرة المؤقتة أثناء عدم الاتصال.'
                );
              }}
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-black border border-black/[0.08] dark:border-white/[0.12] shrink-0 cursor-pointer disabled:opacity-50"
            >
              {warming ? 'جاري الحفظ...' : 'تجهيز نسخة بدون نت'}
            </button>
          </div>
          {offlineMsg && (
            <p className="text-[11px] font-medium text-[#466900] dark:text-[#CCE0AD]">{offlineMsg}</p>
          )}
        </section>
      </div>

      {/* Section 5: Complete 36-Swatch Attached Palette Showcase */}
      <section className="rounded-[26px] p-5 sm:p-6 border border-black/[0.08] dark:border-white/[0.1] bg-[#F5F5F7] dark:bg-[#1C1C1E] space-y-4 overflow-hidden">
        <div className="flex items-center gap-2.5">
          <span
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: '#C49EE8', color: '#200B3D' }}
          >
            <Palette className="w-4 h-4 shrink-0" />
          </span>
          <h2 className="text-sm sm:text-base font-bold font-arabic-display">
            لوحة ألوان البطاقات والخطوط ({PALETTE_SWATCHES.length} لوناً)
          </h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {PALETTE_SWATCHES.map((swatch) => (
            <div
              key={swatch.id}
              className="rounded-2xl p-2.5 border space-y-1.5 bg-white dark:bg-black border-black/[0.06] dark:border-white/[0.08] min-w-0 overflow-hidden"
            >
              <div
                className="h-9 w-full rounded-xl border border-black/10"
                style={{ backgroundColor: swatch.hex }}
              />
              <div className="min-w-0">
                <div className="text-[11px] font-bold truncate">{swatch.nameEn}</div>
                <div className="font-numeric text-[10px] text-[#6E6E73] dark:text-[#98989D] uppercase truncate">
                  {swatch.hex}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
