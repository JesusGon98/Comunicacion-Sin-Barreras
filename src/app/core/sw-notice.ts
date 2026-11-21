import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

// Avisa cuando la app ya quedó guardada para usarse sin internet,
// y cuando hay una versión nueva (pregunta antes de recargar, para no cortar una conversación).
@Component({
  selector: 'app-sw-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (needRefresh()) {
      <div class="toast" role="status">
        <span class="spacer">Hay una versión nueva de la app.</span>
        <button type="button" class="btn btn--ghost btn--sm" (click)="needRefresh.set(false)">Después</button>
        <button type="button" class="btn btn--primary btn--sm" (click)="reload()">Actualizar</button>
      </div>
    } @else if (offlineReady()) {
      <div class="toast" role="status">
        <span class="spacer">✓ La app ya funciona sin internet.</span>
        <button type="button" class="btn btn--ghost btn--sm" (click)="offlineReady.set(false)">Cerrar</button>
      </div>
    }
  `,
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
