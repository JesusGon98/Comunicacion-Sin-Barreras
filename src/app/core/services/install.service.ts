import { Injectable, signal } from '@angular/core';

/** Evento del navegador que permite instalar la app (Chrome, Edge, Android). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Guarda el aviso de "instalar app" del navegador para mostrar nuestro propio botón.
// (En iPhone se instala desde Compartir → "Agregar a inicio", sin este evento.)
@Injectable({ providedIn: 'root' })
export class InstallService {
  private readonly event = signal<BeforeInstallPromptEvent | null>(null);
  readonly canInstall = () => this.event() !== null;

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // evita el aviso automático del navegador
      this.event.set(e as BeforeInstallPromptEvent);
    });
    window.addEventListener('appinstalled', () => this.event.set(null));
  }

  async install() {
    const e = this.event();
    if (!e) return;
    await e.prompt();
    await e.userChoice;
    this.event.set(null);
  }
}
