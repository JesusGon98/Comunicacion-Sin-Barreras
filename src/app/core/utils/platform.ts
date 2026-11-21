import { DestroyRef, inject, signal } from '@angular/core';

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
