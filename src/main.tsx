import React from 'react';
import ReactDOM from 'react-dom/client';
import { startReactDsfr } from '@codegouvfr/react-dsfr/spa';
import { useTranslation } from 'react-i18next';
import App from './App.tsx';
import './i18n';

startReactDsfr({
  defaultColorScheme: 'system',
  useLang: function useLanguage() {
    const { i18n } = useTranslation();
    return i18n.language as 'fr' | 'en';
  },
});

import '@codegouvfr/react-dsfr/main.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
