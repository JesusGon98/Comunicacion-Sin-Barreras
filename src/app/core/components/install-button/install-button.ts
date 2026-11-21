import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Icon } from '../../../shared/components/icon/icon';
import { InstallService } from '../../services/install.service';

@Component({
  selector: 'app-install-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon],
  templateUrl: './install-button.html',
  styleUrl: './install-button.css',
})
export class InstallButton {
  protected readonly installer = inject(InstallService);
  readonly block = input(false);
}
