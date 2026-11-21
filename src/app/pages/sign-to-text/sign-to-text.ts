import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal, viewChild } from '@angular/core';
import { CameraView, type FrameBox } from './components/camera-view/camera-view';
import { RecognizePanel } from './components/recognize-panel/recognize-panel';
import { TrainPanel } from './components/train-panel/train-panel';

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
  templateUrl: './sign-to-text.html',
  styleUrl: './sign-to-text.css',
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
