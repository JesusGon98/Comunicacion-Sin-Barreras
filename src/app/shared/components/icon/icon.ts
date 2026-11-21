import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'chat'
  | 'hand'
  | 'camera'
  | 'mic'
  | 'mic-off'
  | 'speaker'
  | 'gear'
  | 'switch-camera'
  | 'power'
  | 'backspace'
  | 'trash'
  | 'space'
  | 'expand'
  | 'sliders'
  | 'download'
  | 'upload'
  | 'send'
  | 'play'
  | 'pause'
  | 'prev'
  | 'next'
  | 'repeat'
  | 'flip'
  | 'close'
  | 'edit'
  | 'plus'
  | 'check'
  | 'info'
  | 'stop'
  | 'refresh'
  | 'chevron-down'
  | 'sparkle'
  | 'record';

// Íconos SVG sencillos (sin librerías externas, para que funcionen sin internet).
// Siempre van acompañados de texto visible o de un aria-label en el botón, por eso aria-hidden.
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'icon', 'aria-hidden': 'true' },
  templateUrl: './icon.html',
  styleUrl: './icon.css',
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(24);
}
