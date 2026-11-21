import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Evento del navegador que permite instalar la app (Chrome, Edge, Android). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Estado de la conexión a internet, como signal. Se debe llamar dentro de un componente. */
export function onlineStatus() {
  const online = signal(navigator.onLine);
  const update = () => online.set(navigator.onLine);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  inject(DestroyRef).onDestroy(() => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  });
  return online.asReadonly();
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

/** Lee una preferencia guardada (puede fallar en modo privado: entonces usamos el valor por defecto). */
export function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // sin almacenamiento: la preferencia solo dura esta sesión
  }
}

export const errorText = (err: unknown, fallback = 'Error desconocido.') =>
  err instanceof Error ? err.message : fallback;
