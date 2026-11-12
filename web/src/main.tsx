import './styles.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadHighlighter } from './lib/highlight';
import { LangProvider } from './lib/i18n';
import { queryClient } from './lib/queryClient';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LangProvider>
        <App />
      </LangProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Alongside the first requests, so code in the first text is highlighted when that text arrives.
void loadHighlighter();
