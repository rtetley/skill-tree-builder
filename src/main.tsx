import React from 'react';
import ReactDOM from 'react-dom/client';
import { startReactDsfr } from '@codegouvfr/react-dsfr/spa';
import App from './App.tsx';
import './i18n';

startReactDsfr({ defaultColorScheme: 'system' });

import '@codegouvfr/react-dsfr/main.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
