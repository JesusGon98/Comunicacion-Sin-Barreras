import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal, viewChild } from '@angular/core';
import { CameraView, type FrameBox } from './camera-view';
import { RecognizePanel } from './recognize-panel';
import { TrainPanel } from './train-panel';

type Tab = 'reconocer' | 'entrenar';

// Modo 3: Señas → Texto con cámara (experimental).
//
// Diseño "la cámara primero": mientras alguien hace señas necesita ver, sin hacer scroll,
// la cámara, lo que la app reconoce y el texto que se va armando. Cada panel expone dos
// plantillas que esta pantalla coloca:
//   - overlay: encima del video (seña detectada, cuenta regresiva al grabar…)
//   - footer:  justo debajo del video (texto reconocido, botón de grabar…)
@Component({
  selector: 'app-sign-to-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, CameraView, RecognizePanel, TrainPanel],
  template: `
    <section class="page page--camera" aria-labelledby="titulo-senas-texto">
      <header class="page-head">
        <div class="page-head__text">
          <h1 id="titulo-senas-texto">
            Cámara <span class="badge badge--accent" style="vertical-align: middle">Experimental</span>
          </h1>
        </div>
        <div class="segmented" role="tablist" aria-label="Opciones">
          <button
            type="button"
            role="tab"
            class="segmented__opt"
            [attr.aria-selected]="tab() === 'reconocer'"
            (click)="tab.set('reconocer')"
          >
            Reconocer
          </button>
          <button
            type="button"
            role="tab"
            class="segmented__opt"
            [attr.aria-selected]="tab() === 'entrenar'"
            (click)="tab.set('entrenar')"
          >
            Entrenar
          </button>
        </div>
      </header>

      <div class="cam-layout">
        <div class="cam-layout__main">
          <app-camera-view [active]="cameraOn()" [frame]="frame" (toggle)="cameraOn.set(!cameraOn())">
            <ng-container [ngTemplateOutlet]="overlayTpl()" />
          </app-camera-view>
          <ng-container [ngTemplateOutlet]="footerTpl()" />
        </div>

        <div role="tabpanel">
          <!-- Al cambiar de pestaña el panel se crea de nuevo (así toma las señas nuevas) -->
          @if (tab() === 'reconocer') {
            <app-recognize-panel [frame]="frame" [cameraOn]="cameraOn()" (goTrain)="tab.set('entrenar')" />
          } @else {
            <app-train-panel [frame]="frame" [cameraOn]="cameraOn()" />
          }
        </div>
      </div>
    </section>
  `,
})
export class SignToTextPage {
  protected readonly tab = signal<Tab>('reconocer');
  protected readonly cameraOn = signal(false);
  /** La cámara escribe aquí la mano detectada; los paneles la leen. */
  protected readonly frame: FrameBox = { current: null };

  private readonly recognize = viewChild(RecognizePanel);
  private readonly train = viewChild(TrainPanel);
  private readonly panel = computed(() => (this.tab() === 'reconocer' ? this.recognize() : this.train()));

  protected readonly overlayTpl = computed(() => this.panel()?.overlayTpl() ?? null);
  protected readonly footerTpl = computed(() => this.panel()?.footerTpl() ?? null);
}
