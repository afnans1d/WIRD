import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'حدث خطأ غير متوقع',
    };
  }

  componentDidCatch(error: Error) {
    console.error('WIRD ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen flex items-center justify-center p-6 bg-white dark:bg-black text-black dark:text-white"
        >
          <div className="max-w-md w-full rounded-[28px] p-8 bg-[#F5F5F7] dark:bg-[#1C1C1E] border border-black/[0.08] dark:border-white/[0.12] shadow-card-apple text-center space-y-4">
            <h1 className="text-xl font-bold font-arabic-display">عذراً، حدث خلل مؤقت</h1>
            <p className="text-sm text-[#6E6E73] dark:text-[#98989D] leading-relaxed">
              تم حفظ أذكارك وتقدمك محلياً. يمكنك إعادة تحميل الصفحة للمتابعة بأمان.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-6 py-3 rounded-2xl bg-black text-white dark:bg-white dark:text-black font-semibold text-sm hover:opacity-90 transition-opacity min-h-[44px] cursor-pointer"
            >
              إعادة تحميل التطبيق
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
