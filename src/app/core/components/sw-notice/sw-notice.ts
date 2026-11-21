import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

// Avisa cuando la app ya quedó guardada para usarse sin internet,
// y cuando hay una versión nueva (pregunta antes de recargar, para no cortar una conversación).
@Component({
  selector: 'app-sw-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sw-notice.html',
  styleUrl: './sw-notice.css',
})
export class SwNotice {
  private readonly sw = inject(SwUpdate);
  protected readonly needRefresh = signal(false);
  protected readonly offlineReady = signal(false);

  constructor() {
    if (!this.sw.isEnabled) return;
    const sub = this.sw.versionUpdates.subscribe((e) => {
      if (e.type === 'VERSION_READY') this.needRefresh.set(true);
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());

    // Primera visita: cuando el service worker termina de guardar todo, avisamos.
    if (!navigator.serviceWorker.controller) {
      navigator.serviceWorker.ready.then(() => {
        this.offlineReady.set(true);
        setTimeout(() => this.offlineReady.set(false), 8000);
      });
    }
  }

  protected async reload() {
    await this.sw.activateUpdate();
    location.reload();
  }
}
