import React, { useEffect, useState, useCallback } from 'react';
import {
  ArrowRight,
  Bell,
  BellOff,
  CheckCircle2,
  AlertTriangle,
  Send,
  Clock,
  Moon,
  Sun,
  Smartphone,
  Globe,
  RefreshCw,
  Calendar,
  ChevronDown,
} from 'lucide-react';
import type { UserPreferencesState } from '../lib/storage';
import {
  detectPushCapabilities,
  disableNotifications,
  enableNotifications,
  fetchLocalNotificationStatus,
  fetchNotificationStatus,
  isWorkerPushConfigured,
  scheduleApproxOneMinuteTest,
  sendTestNotification,
  syncPreferencesToWorker,
  type DeliveryAuditItem,
} from '../lib/push';
import { downloadAdhkarCalendarIcs } from '../lib/icsCalendar';
import { syncPreferencesToCloud } from '../lib/firebase';

interface NotificationsViewProps {
  deviceId: string;
  userId?: string;
  prefs: UserPreferencesState;
  isDark: boolean;
  onUpdatePrefs: (patch: Partial<UserPreferencesState>) => void;
  onOpenInstallGuide: () => void;
  onBackHome: () => void;
}

const COMMON_TIMEZONES = [
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Asia/Amman',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
];

const AppleSwitch: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  activeColor?: string;
}> = ({ checked, onChange, ariaLabel, activeColor = '#81BC00' }) => (
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

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  deviceId,
  userId,
  prefs,
  onUpdatePrefs,
  onOpenInstallGuide,
  onBackHome,
}) => {
  const [caps, setCaps] = useState(() => detectPushCapabilities());
  const [isNotifActive, setIsNotifActive] = useState(() => fetchLocalNotificationStatus().isActive);
  const [workerActive, setWorkerActive] = useState(false);
  const [deliveries, setDeliveries] = useState<DeliveryAuditItem[]>(() => fetchLocalNotificationStatus().deliveries);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [calendarMsg, setCalendarMsg] = useState<string | null>(null);
  const workerConfigured = isWorkerPushConfigured();

  const refreshAudit = useCallback(async () => {
    setCaps(detectPushCapabilities());
    const status = await fetchNotificationStatus(deviceId);
    setIsNotifActive(status.isActive);
    setWorkerActive(status.workerActive);
    setDeliveries(status.deliveries);
  }, [deviceId]);

  useEffect(() => {
    refreshAudit();
  }, [refreshAudit]);

  const handleEnableNotifications = async () => {
    setBusy(true);
    setFeedback(null);
    const res = await enableNotifications(deviceId, prefs);
    if (res.ok) {
      if (userId) {
        syncPreferencesToCloud(userId, prefs).catch(() => {});
      }
      setFeedback({
        type: 'ok',
        text:
          res.mode === 'worker'
            ? 'تم تفعيل إشعارات Web Push المجدولة على هذا الجهاز بنجاح (تعمل حتى بعد إغلاق التطبيق).'
            : 'تم تفعيل تنبيهات وِرد المحلية بنجاح على هذا الجهاز.',
      });
    } else {
      setFeedback({
        type: 'err',
        text: res.error || 'تعذر تفعيل الإشعارات.',
      });
    }
    await refreshAudit();
    setBusy(false);
  };

  const handleDisableNotifications = async () => {
    setBusy(true);
    await disableNotifications(deviceId);
    setFeedback({ type: 'ok', text: 'تم إيقاف الإشعارات وإلغاء الاشتراك على هذا الجهاز.' });
    await refreshAudit();
    setBusy(false);
  };

  const handlePrefChange = async (patch: Partial<UserPreferencesState>) => {
    const merged = { ...prefs, ...patch };
    onUpdatePrefs(patch);
    if (userId) {
      syncPreferencesToCloud(userId, merged).catch(() => {});
    }
    syncPreferencesToWorker(deviceId, merged).catch(() => {});
  };

  const handleSendTest = async (period: 'morning' | 'evening') => {
    setTestBusy(true);
    setFeedback(null);
    const res = await sendTestNotification(period, prefs, deviceId);
    if (res.ok) {
      setFeedback({
        type: 'ok',
        text: res.viaWorker
          ? 'تم إرسال الإشعار التجريبي عبر خادم Push (قبول الخادم لا يضمن 100% ظهوره على الشاشة إذا كانت إعدادات التركيز أو البطارية مفعّلة).'
          : 'تم إرسال الإشعار التجريبي بنجاح! تأكد من ظهوره في شريط التنبيهات.',
      });
    } else {
      setFeedback({ type: 'err', text: res.error || 'تعذر إرسال الإشعار التجريبي.' });
    }
    await refreshAudit();
    setTestBusy(false);
  };

  const handleScheduleOneMinuteTest = async () => {
    setTestBusy(true);
    setFeedback(null);
    const res = await scheduleApproxOneMinuteTest(deviceId, prefs);
    if (res.ok) {
      setFeedback({
        type: 'ok',
        text: 'تمت جدولة إشعار اختباري بعد نحو دقيقة (تقريبي ~1–2 دقيقة حسب دورة Cron). يمكنك إغلاق التطبيق الآن للتحقق من وصوله في الخلفية.',
      });
    } else {
      setFeedback({ type: 'err', text: res.error || 'تعذر جدولة الإشعار التجريبي.' });
    }
    await refreshAudit();
    setTestBusy(false);
  };

  const handleExportCalendar = () => {
    const ok = downloadAdhkarCalendarIcs(prefs);
    if (ok) {
      setCalendarMsg(
        'تم تنزيل ملف المواعيد (wird-adhkar-reminders.ics). افتحه لاستيراده في تقويم iPhone كتذكير يومي متكرر.'
      );
    } else {
      setCalendarMsg('يرجى تفعيل تذكير الصباح أو المساء أولاً قبل تصدير المواعيد إلى التقويم.');
    }
  };

  const tzOptions = Array.from(new Set([prefs.timezone, ...COMMON_TIMEZONES]));
  const isActuallyActive = caps.permission === 'granted' && isNotifActive;

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-14">
      {/* Header Row — cleanly aligned with shrink-0 & truncation */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBackHome}
          className="min-h-[42px] px-3.5 py-2 rounded-2xl flex items-center gap-1.5 text-xs font-semibold bg-[#F5F5F7] dark:bg-[#1C1C1E] text-black dark:text-white border border-black/[0.08] dark:border-white/[0.1] shrink-0 cursor-pointer"
        >
          <ArrowRight className="w-4 h-4 shrink-0" />
          <span>الرئيسية</span>
        </button>

        <h1 className="text-lg sm:text-2xl font-bold font-arabic-display text-black dark:text-white truncate text-center">
          التنبيهات
        </h1>

        <span className="max-w-[130px] truncate text-[11px] font-medium px-2.5 py-1.5 rounded-xl bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.06] dark:border-white/[0.08] text-[#6E6E73] dark:text-[#98989D] shrink-0">
          {caps.platformLabel}
        </span>
      </div>

      {/* Permission & Activation Card */}
      <section className="rounded-[24px] p-4 sm:p-6 bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/[0.1] space-y-4 sm:space-y-5 text-black dark:text-white overflow-hidden">
        <div className="flex items-start gap-3.5 min-w-0">
          <div
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              backgroundColor: isActuallyActive ? '#81BC00' : '#4D6FF4',
              color: '#FFFFFF',
            }}
          >
            {isActuallyActive ? (
              <Bell className="w-5 h-5 shrink-0" />
            ) : (
              <BellOff className="w-5 h-5 shrink-0" />
            )}
          </div>
          <div className="space-y-1.5 min-w-0">
            <h2 className="text-base sm:text-lg font-bold font-arabic-display leading-snug">
              {isActuallyActive
                ? workerActive
                  ? 'إشعارات Web Push المجدولة مفعّلة لهذا الجهاز'
                  : 'تنبيهات التطبيق المحلية مفعّلة لهذا الجهاز'
                : 'تذكير لطيف بأذكار الصباح والمساء وفق جدولك'}
            </h2>
            <p className="text-xs sm:text-sm text-[#3A3A3C] dark:text-[#AEAEB2] leading-relaxed">
              {workerConfigured
                ? 'تصلك إشعارات Web Push المجدولة عبر Cloudflare Worker حتى عند إغلاق التطبيق (على iOS 16.4+ بعد التثبيت على الشاشة الرئيسية)، مع احترام ساعات الهدوء ومنع التكرار وإيقاف التنبيه عند إتمام أذكارك. ملاحظة: قبول خادم Push لا يضمن 100% ظهور التنبيه على الشاشة إذا كانت إعدادات التركيز أو الطاقة مفعّلة.'
                : 'تعمل تنبيهات التطبيق المحلية أثناء استخدام وِرد أو عند العودة إليه في وقت الورد، مع احترام ساعات الهدوء ومنع التكرار وإيقاف التنبيه عند إتمام أذكارك في ذلك اليوم. ولضمان تذكير يومي حتى عند إغلاق التطبيق على iPhone استخدم تصدير التقويم أدناه.'}
            </p>
          </div>
        </div>

        {/* Platform-specific compatibility notice for iOS Safari */}
        {caps.requiresIOSHomeScreenInstall && (
          <div className="p-4 rounded-2xl bg-white dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/[0.1] space-y-2.5 overflow-hidden">
            <div className="flex items-center gap-2.5 font-bold text-sm">
              <span
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: '#54ADD4', color: '#FFFFFF' }}
              >
                <Smartphone className="w-4 h-4 shrink-0" />
              </span>
              <span>متطلب خاص بأجهزة iPhone و iPad (iOS 16.4+)</span>
            </div>
            <p className="text-xs leading-relaxed text-[#6E6E73] dark:text-[#AEAEB2]">
              لا تسمح Apple بإرسال إشعارات الويب داخل تبويب Safari العادي. أضف تطبيق وِرد أولاً إلى الشاشة الرئيسية عبر زر المشاركة (Share) ← «إضافة إلى الشاشة الرئيسية»، ثم افتحه من أيقونته وفعّل الإشعارات.
            </p>
            <button
              type="button"
              onClick={onOpenInstallGuide}
              className="min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold bg-black text-white dark:bg-white dark:text-black cursor-pointer"
            >
              عرض خطوات التثبيت على iPhone
            </button>
          </div>
        )}

        {/* Embedded Preview Frame Guidance */}
        {caps.isInsideIframe && caps.permission !== 'granted' && !caps.requiresIOSHomeScreenInstall && (
          <div className="p-4 rounded-2xl bg-white dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/[0.1] space-y-1.5 overflow-hidden">
            <div className="font-bold text-xs text-black dark:text-white">
              ملاحظة حول نافذة المعاينة المدمجة
            </div>
            <p className="text-xs leading-relaxed text-[#6E6E73] dark:text-[#AEAEB2]">
              تقوم بعض المتصفحات بتقييد طلب إذن الإشعارات داخل نافذة المعاينة المدمجة. بعد رفع التطبيق على Firebase وفتحه مباشرة في المتصفح ستعمل نافذة الإذن والإشعارات فوراً بنقرة واحدة.
            </p>
          </div>
        )}

        {/* Denied Permission Honest Fallback */}
        {caps.permission === 'denied' && (
          <div className="p-4 rounded-2xl bg-white dark:bg-[#2C2C2E] border border-[#E14C70]/40 space-y-2 overflow-hidden">
            <div className="flex items-center gap-2.5 font-bold text-sm" style={{ color: '#E14C70' }}>
              <span
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'rgba(225, 76, 112, 0.14)', color: '#E14C70' }}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" />
              </span>
              <span>الإشعارات محظورة حالياً من إعدادات المتصفح</span>
            </div>
            <p className="text-xs leading-relaxed text-[#6E6E73] dark:text-[#AEAEB2]">
              لن تظهر الإشعارات حتى تسمح بها من أيقونة القفل في شريط العنوان أو من إعدادات النظام ← الإشعارات، ثم تعيد الضغط على تفعيل الإشعارات.
            </p>
          </div>
        )}

        {feedback && (
          <div
            className="p-3.5 rounded-2xl text-xs font-medium flex items-center gap-2.5 bg-white dark:bg-[#2C2C2E] border overflow-hidden"
            style={{
              borderColor: feedback.type === 'ok' ? '#81BC00' : '#E14C70',
            }}
          >
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: '#81BC00' }} />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: '#E14C70' }} />
            )}
            <span className="text-black dark:text-white leading-relaxed min-w-0">{feedback.text}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2.5">
          {!isActuallyActive ? (
            <button
              type="button"
              disabled={busy || caps.requiresIOSHomeScreenInstall || !caps.isSupported}
              onClick={handleEnableNotifications}
              className="min-h-[46px] px-6 py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 bg-black text-white dark:bg-white dark:text-black disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
            >
              <Bell className="w-4 h-4 shrink-0" />
              <span>{busy ? 'جاري التفعيل...' : 'تفعيل الإشعارات'}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={testBusy}
                onClick={() => handleSendTest('morning')}
                className="min-h-[44px] px-5 py-2.5 rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 bg-black text-white dark:bg-white dark:text-black cursor-pointer"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span>{testBusy ? 'جاري الإرسال...' : 'إرسال إشعار صباحي تجريبي'}</span>
              </button>

              <button
                type="button"
                disabled={testBusy}
                onClick={() => handleSendTest('evening')}
                className="min-h-[44px] px-5 py-2.5 rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 bg-white dark:bg-[#2C2C2E] text-black dark:text-white border border-black/[0.08] dark:border-white/[0.1] cursor-pointer"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span>إرسال إشعار مسائي تجريبي</span>
              </button>

              {workerConfigured && (
                <button
                  type="button"
                  disabled={testBusy}
                  onClick={handleScheduleOneMinuteTest}
                  className="min-h-[44px] px-5 py-2.5 rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 bg-white dark:bg-[#2C2C2E] text-black dark:text-white border border-black/[0.08] dark:border-white/[0.1] cursor-pointer"
                >
                  <Clock className="w-4 h-4 shrink-0" />
                  <span>اختبار مجدول (~1–2 دقيقة)</span>
                </button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={handleDisableNotifications}
                className="min-h-[44px] px-4 py-2.5 rounded-2xl text-xs font-semibold text-[#E14C70] hover:bg-[#E14C70]/10 transition-colors cursor-pointer"
              >
                إيقاف الإشعارات
              </button>
            </>
          )}
        </div>
      </section>

      {/* Morning & Evening Schedule & Timezone */}
      <section className="rounded-[24px] p-4 sm:p-6 bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/[0.1] space-y-4 sm:space-y-5 text-black dark:text-white overflow-hidden">
        <div className="flex items-center gap-2.5">
          <span
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: '#54ADD4', color: '#FFFFFF' }}
          >
            <Clock className="w-4 h-4 shrink-0" />
          </span>
          <h2 className="text-base font-bold font-arabic-display">
            مواعيد التذكير والمنطقة الزمنية
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
          {/* Morning reminder card */}
          <div className="p-3.5 sm:p-5 rounded-2xl bg-white dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] space-y-3 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: '#FFAF22', color: '#FFFFFF' }}
                >
                  <Sun className="w-4 h-4 shrink-0" />
                </span>
                <span className="font-semibold text-sm truncate">تذكير أذكار الصباح</span>
              </div>
              <AppleSwitch
                checked={prefs.morningEnabled}
                onChange={(val) => handlePrefChange({ morningEnabled: val })}
                ariaLabel="تفعيل تذكير أذكار الصباح"
                activeColor="#FFAF22"
              />
            </div>

            <label className="block text-xs space-y-1.5 w-full min-w-0">
              <span className="block text-[#6E6E73] dark:text-[#98989D]">وقت التذكير الصباحي</span>
              <div className="w-full min-w-0 h-11 px-3 rounded-xl bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/10 dark:border-white/15 flex items-center justify-center overflow-hidden">
                <input
                  type="time"
                  dir="ltr"
                  value={prefs.morningTime}
                  disabled={!prefs.morningEnabled}
                  onChange={(e) => handlePrefChange({ morningTime: e.target.value })}
                  className="w-full max-w-full min-w-0 h-full bg-transparent border-0 outline-none appearance-none font-numeric text-sm text-center text-black dark:text-white disabled:opacity-45"
                />
              </div>
            </label>

            <p className="text-[11px] text-[#6E6E73] dark:text-[#98989D] leading-relaxed">
              «صباح الخير ☀️ حان وقت أذكار الصباح حفظك الله»
            </p>
          </div>

          {/* Evening reminder card */}
          <div className="p-3.5 sm:p-5 rounded-2xl bg-white dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] space-y-3 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: '#4D6FF4', color: '#FFFFFF' }}
                >
                  <Moon className="w-4 h-4 shrink-0" />
                </span>
                <span className="font-semibold text-sm truncate">تذكير أذكار المساء</span>
              </div>
              <AppleSwitch
                checked={prefs.eveningEnabled}
                onChange={(val) => handlePrefChange({ eveningEnabled: val })}
                ariaLabel="تفعيل تذكير أذكار المساء"
                activeColor="#4D6FF4"
              />
            </div>

            <label className="block text-xs space-y-1.5 w-full min-w-0">
              <span className="block text-[#6E6E73] dark:text-[#98989D]">وقت التذكير المسائي</span>
              <div className="w-full min-w-0 h-11 px-3 rounded-xl bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/10 dark:border-white/15 flex items-center justify-center overflow-hidden">
                <input
                  type="time"
                  dir="ltr"
                  value={prefs.eveningTime}
                  disabled={!prefs.eveningEnabled}
                  onChange={(e) => handlePrefChange({ eveningTime: e.target.value })}
                  className="w-full max-w-full min-w-0 h-full bg-transparent border-0 outline-none appearance-none font-numeric text-sm text-center text-black dark:text-white disabled:opacity-45"
                />
              </div>
            </label>

            <p className="text-[11px] text-[#6E6E73] dark:text-[#98989D] leading-relaxed">
              «مساء الخير 🌙 حان وقت أذكار المساء حفظك الله»
            </p>
          </div>
        </div>

        {/* Timezone & Quiet Hours */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
          <div className="p-3.5 sm:p-5 rounded-2xl bg-white dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] space-y-3 min-w-0 overflow-hidden">
            <div className="flex items-center gap-2.5">
              <span
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: '#81BC00', color: '#FFFFFF' }}
              >
                <Globe className="w-4 h-4 shrink-0" />
              </span>
              <span className="text-sm font-semibold truncate">المنطقة الزمنية المحلية</span>
            </div>

            <div className="relative w-full min-w-0">
              <select
                dir="ltr"
                value={prefs.timezone}
                aria-label="المنطقة الزمنية المحلية"
                onChange={(e) => handlePrefChange({ timezone: e.target.value })}
                className="w-full max-w-full min-w-0 box-border h-11 pl-3.5 pr-9 rounded-xl bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/10 dark:border-white/15 font-numeric text-xs text-black dark:text-white appearance-none"
              >
                {tzOptions.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="w-4 h-4 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#6E6E73] dark:text-[#98989D]"
              />
            </div>
          </div>

          <div className="p-3.5 sm:p-5 rounded-2xl bg-white dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] space-y-3 min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold truncate">ساعات الهدوء (عدم الإزعاج)</span>
              <AppleSwitch
                checked={prefs.quietHoursEnabled}
                onChange={(val) => handlePrefChange({ quietHoursEnabled: val })}
                ariaLabel="تفعيل ساعات الهدوء"
                activeColor="#81BC00"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs w-full min-w-0">
              <label className="block space-y-1.5 w-full min-w-0 overflow-hidden">
                <span className="block text-[#6E6E73] dark:text-[#98989D]">من</span>
                <div className="w-full min-w-0 h-11 px-2 rounded-xl bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/10 dark:border-white/15 flex items-center justify-center overflow-hidden">
                  <input
                    type="time"
                    dir="ltr"
                    value={prefs.quietHoursStart}
                    disabled={!prefs.quietHoursEnabled}
                    onChange={(e) => handlePrefChange({ quietHoursStart: e.target.value })}
                    className="w-full max-w-full min-w-0 h-full bg-transparent border-0 outline-none appearance-none font-numeric text-xs sm:text-sm text-center text-black dark:text-white disabled:opacity-45"
                  />
                </div>
              </label>

              <label className="block space-y-1.5 w-full min-w-0 overflow-hidden">
                <span className="block text-[#6E6E73] dark:text-[#98989D]">إلى</span>
                <div className="w-full min-w-0 h-11 px-2 rounded-xl bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/10 dark:border-white/15 flex items-center justify-center overflow-hidden">
                  <input
                    type="time"
                    dir="ltr"
                    value={prefs.quietHoursEnd}
                    disabled={!prefs.quietHoursEnabled}
                    onChange={(e) => handlePrefChange({ quietHoursEnd: e.target.value })}
                    className="w-full max-w-full min-w-0 h-full bg-transparent border-0 outline-none appearance-none font-numeric text-xs sm:text-sm text-center text-black dark:text-white disabled:opacity-45"
                  />
                </div>
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* iPhone Apple Calendar (.ics) Export Section — Free & Serverless */}
      <section className="rounded-[24px] p-4 sm:p-6 border border-black/[0.08] dark:border-white/[0.1] bg-[#F5F5F7] dark:bg-[#1C1C1E] space-y-4 text-black dark:text-white overflow-hidden">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: '#F0774F', color: '#FFFFFF' }}
          >
            <Calendar className="w-4 h-4 shrink-0" />
          </span>
          <div className="space-y-1.5 min-w-0">
            <h2 className="text-base font-bold font-arabic-display">
              تذكيرات تقويم iPhone (مجانية دون خادم)
            </h2>
            <p className="text-xs text-[#3A3A3C] dark:text-[#AEAEB2] leading-relaxed">
              صدّر مواعيد أذكار الصباح والمساء الحالية كملف تقويم (.ics) واستورده إلى تقويم iPhone ليصلك تنبيه يومي متكرر في أوقاتك المحددة مع رابط مباشر لفتح التطبيق.
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] text-xs text-[#6E6E73] dark:text-[#AEAEB2] leading-relaxed">
          تنبيه مهم: التقويم يستطيع تكرار التذكيرات يومياً، لكن لا يمكننا ضمان وصولها بدقة 100%؛ لأن ذلك يعتمد على إعدادات iOS والتقويم وإشعارات الجهاز.
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <button
            type="button"
            disabled={!prefs.morningEnabled && !prefs.eveningEnabled}
            onClick={handleExportCalendar}
            className="min-h-[44px] px-5 py-2.5 rounded-2xl font-semibold text-xs flex items-center justify-center gap-2 bg-black text-white dark:bg-white dark:text-black disabled:opacity-45 cursor-pointer disabled:cursor-not-allowed"
          >
            <Calendar className="w-4 h-4 shrink-0" />
            <span>تصدير المواعيد إلى تقويم iPhone (.ics)</span>
          </button>
          {!prefs.morningEnabled && !prefs.eveningEnabled && (
            <span className="text-xs text-[#6E6E73] dark:text-[#98989D]">
              فعّل تذكير الصباح أو المساء أولاً لتصدير المواعيد.
            </span>
          )}
        </div>

        {calendarMsg && (
          <p className="text-xs font-medium text-[#466900] dark:text-[#CCE0AD] leading-relaxed">
            {calendarMsg}
          </p>
        )}
      </section>

      {/* Delivery History */}
      <section className="rounded-[24px] p-4 sm:p-6 border border-black/[0.08] dark:border-white/[0.1] bg-[#F5F5F7] dark:bg-[#1C1C1E] space-y-4 text-black dark:text-white overflow-hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: '#C49EE8', color: '#200B3D' }}
            >
              <Bell className="w-4 h-4 shrink-0" />
            </span>
            <h3 className="text-sm font-bold truncate">سجل الإشعارات المرسلة</h3>
          </div>

          <button
            type="button"
            onClick={refreshAudit}
            className="min-h-[34px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 bg-white dark:bg-[#2C2C2E] border border-black/[0.08] dark:border-white/[0.1] shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 shrink-0" />
            <span>تحديث</span>
          </button>
        </div>

        {deliveries.length === 0 ? (
          <p className="text-xs text-[#6E6E73] dark:text-[#98989D] leading-relaxed">
            لا توجد محاولات إرسال مسجلة لهذا الجهاز بعد. بعد تفعيل الإشعارات يمكنك تجربة إرسال إشعار فوري من الأعلى.
          </p>
        ) : (
          <div className="divide-y divide-black/[0.06] dark:divide-white/[0.08] rounded-2xl bg-white dark:bg-[#2C2C2E] border border-black/[0.06] dark:border-white/[0.08] overflow-hidden">
            {deliveries.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-2 text-xs px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className="font-semibold">
                    {item.period === 'morning'
                      ? 'تذكير الصباح'
                      : item.period === 'evening'
                      ? 'تذكير المساء'
                      : 'إشعار تجريبي'}
                  </span>
                  <span aria-hidden="true" className="opacity-40">
                    ·
                  </span>
                  <span className="font-numeric opacity-75">
                    {new Date(item.createdAt).toLocaleString('ar-SA')}
                  </span>
                </div>
                <span
                  className="font-numeric font-semibold shrink-0"
                  style={{
                    color:
                      item.status === 'sent'
                        ? '#466900'
                        : item.status === 'pending' || item.status === 'processing'
                        ? '#4D6FF4'
                        : item.status === 'cancelled'
                        ? '#6E6E73'
                        : '#E14C70',
                  }}
                >
                  {item.status === 'sent'
                    ? item.statusCode === 201
                      ? 'قُبل من خادم Push (201)'
                      : 'تم العرض بنجاح'
                    : item.status === 'pending'
                    ? 'مجدول (قيد الانتظار)'
                    : item.status === 'processing'
                    ? 'جاري المعالجة'
                    : item.status === 'cancelled'
                    ? `ملغى (${item.errorMessage || 'تم إيقافه'})`
                    : `تعذر الإرسال (${item.errorMessage || 'خطأ'})`}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
