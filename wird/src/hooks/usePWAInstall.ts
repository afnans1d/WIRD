import { useCallback, useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice =
      /iphone|ipad|ipod/.test(userAgent) ||
      (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

const OFFLINE_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/wird-logo-cropped.png',
  '/pwa-192x192.png',
  '/apple-touch-icon.png',
  '/assets/aistudio/__________________________7b238392.png',
  '/assets/aistudio/_________________________________80204d67.png',
];

export function useOfflineCapability() {
  const [swReady, setSwReady] = useState(false);
  const [cachedCount, setCachedCount] = useState(0);
  const [warming, setWarming] = useState(false);

  const inspectCaches = useCallback(async () => {
    if (typeof window === 'undefined' || !('caches' in window)) return 0;
    try {
      const names = await caches.keys();
      let total = 0;
      for (const name of names) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        total += keys.length;
      }
      setCachedCount(total);
      return total;
    } catch {
      return 0;
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(async () => {
          if (!active) return;
          setSwReady(true);
          await inspectCaches();
        })
        .catch(() => {});
    }
    inspectCaches();
    return () => {
      active = false;
    };
  }, [inspectCaches]);

  const warmOfflineCache = useCallback(async () => {
    setWarming(true);
    try {
      if ('caches' in window) {
        const cache = await caches.open('wird-offline-shell-v1');
        await Promise.allSettled(
          OFFLINE_ASSETS.map(async (url) => {
            try {
              const res = await fetch(url);
              if (res.ok) await cache.put(url, res);
            } catch {
              // Offline fallback
            }
          })
        );
      }

      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg.active) {
          await new Promise<void>((resolve) => {
            const channel = new MessageChannel();
            const timer = setTimeout(() => resolve(), 2500);
            channel.port1.onmessage = () => {
              clearTimeout(timer);
              resolve();
            };
            reg.active?.postMessage({ type: 'WIRD_WARM_OFFLINE' }, [channel.port2]);
          });
          setSwReady(true);
        }
      }

      await inspectCaches();
      return true;
    } catch {
      return false;
    } finally {
      setWarming(false);
    }
  }, [inspectCaches]);

  return {
    swReady,
    cachedCount,
    warming,
    warmOfflineCache,
  };
}
