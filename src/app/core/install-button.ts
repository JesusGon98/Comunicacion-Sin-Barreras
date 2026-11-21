import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Icon } from '../shared/icon';
import { InstallService } from './platform';

@Component({
  selector: 'app-install-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  template: `
    @if (installer.canInstall()) {
      <button type="button" class="btn btn--soft" [class.btn--block]="block()" (click)="installer.install()">
        <app-icon name="download" [size]="20" />
        Instalar app
      </button>
    }
  `,
})
export class InstallButton {
  protected readonly installer = inject(InstallService);
  readonly block = input(false);
}
