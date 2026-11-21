import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { InstallButton } from './core/components/install-button/install-button';
import { onlineStatus } from './core/utils/platform';
import { SwNotice } from './core/components/sw-notice/sw-notice';
import { UpdateNotice } from './core/components/update-notice/update-notice';
import { Icon, type IconName } from './shared/components/icon/icon';

interface NavItem {
  to: string;
  label: string;
  /** Nombre corto para la barra de abajo del celular (ahí hay poco espacio). */
  short: string;
  icon: IconName;
  /** Color del modo (variables --mode-* de styles.css). */
  color: string;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Conversación', short: 'Conversar', icon: 'chat', color: 'chat' },
  { to: '/texto-a-senas', label: 'Texto a señas', short: 'Ver señas', icon: 'hand', color: 'signs' },
  { to: '/senas-a-texto', label: 'Señas a texto', short: 'Cámara', icon: 'camera', color: 'camera' },
  { to: '/ajustes', label: 'Ajustes', short: 'Ajustes', icon: 'gear', color: 'settings' },
];

// Estructura general: navegación abajo en celular (al alcance del pulgar)
// y a la izquierda en pantallas grandes.
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, InstallButton, SwNotice, UpdateNotice],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly nav = NAV;
  protected readonly online = onlineStatus();
}
