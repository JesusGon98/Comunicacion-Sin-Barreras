import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Pedimos al navegador que no borre los datos guardados (señas entrenadas, historial…)
// cuando le falte espacio. Algunos navegadores lo conceden solo si la app está instalada.
navigator.storage?.persist?.().catch(() => {});

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
