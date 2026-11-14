import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import './styles.css';

// Pedimos al navegador que no borre los datos guardados (señas entrenadas, historial…)
// cuando le falte espacio. Algunos navegadores lo conceden solo si la app está instalada.
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
