import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppErrorBoundary } from '@/components/layout/AppErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';
import { installAccentTheme } from '@/lib/accentTheme';
import { installWindowChrome } from '@/lib/windowChrome';

// The saved accent is on <html> before React paints anything, so there is no orange flash.
installAccentTheme();
// Platform classes are also set before the first paint, so the header never jumps under the window buttons.
installWindowChrome();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
    <Toaster position="bottom-right" richColors />
  </React.StrictMode>,
);
