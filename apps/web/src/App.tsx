import { useEffect } from 'react';
import { useThemeStore } from '@wms/ui';
import { AppDock } from './dock/AppDock';
import { registerServiceWorker } from './lib/registerSW';

export function App() {
  const initTheme = useThemeStore((s) => s.init);

  useEffect(() => {
    // Keeps 'system' mode in sync with the OS; also re-applies the class the
    // inline bootstrap in index.html already set (no flash, no double work).
    const unsubscribe = initTheme();
    return unsubscribe;
  }, [initTheme]);

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return <AppDock />;
}
