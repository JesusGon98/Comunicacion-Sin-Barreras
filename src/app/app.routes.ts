import { Routes } from '@angular/router';

// Una ruta por modo. Cada pantalla se descarga solo cuando se abre
// (así la cámara y la mano 3D no hacen lenta la primera carga).
export const routes: Routes = [
  {
    path: '',
    title: 'Conversación · Sin Barreras',
    loadComponent: () => import('./pages/conversation/conversation').then((m) => m.ConversationPage),
  },
  {
    path: 'texto-a-senas',
    title: 'Ver señas · Sin Barreras',
    loadComponent: () => import('./pages/text-to-sign/text-to-sign').then((m) => m.TextToSignPage),
  },
  {
    path: 'senas-a-texto',
    title: 'Cámara · Sin Barreras',
    loadComponent: () => import('./pages/sign-to-text/sign-to-text').then((m) => m.SignToTextPage),
  },
  {
    path: 'ajustes',
    title: 'Ajustes · Sin Barreras',
    loadComponent: () => import('./pages/settings/settings').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: '' },
];
