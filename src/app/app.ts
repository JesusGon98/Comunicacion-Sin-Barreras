import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { InstallButton } from './core/install-button';
import { onlineStatus } from './core/platform';
import { SwNotice } from './core/sw-notice';
import { UpdateNotice } from './core/update-notice';
import { Icon, type IconName } from './shared/icon';

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
  template: `
    <div class="shell">
      <header class="topbar">
        <a routerLink="/" class="brand" aria-label="Comunicación sin Barreras, inicio">
          <img class="brand__logo" src="icons/favicon.svg" alt="" />
          <span>Comunicación <span class="brand__accent">sin Barreras</span></span>
        </a>
      </header>

      <nav class="nav" aria-label="Modos de la app">
        <div class="nav__brand">
          <a routerLink="/" class="brand">
            <img class="brand__logo" src="icons/favicon.svg" alt="" />
            <span>
              Comunicación <span class="brand__accent">sin Barreras</span>
              <span class="brand__sub">Traductor LSM</span>
            </span>
          </a>
        </div>
        <ul class="nav__list">
          @for (item of nav; track item.to) {
            <li>
              <a
                class="nav__link"
                [routerLink]="item.to"
                routerLinkActive="is-active"
                ariaCurrentWhenActive="page"
                [routerLinkActiveOptions]="{ exact: true }"
                [attr.aria-label]="item.label"
                [style.--nav-color]="'var(--mode-' + item.color + ')'"
                [style.--nav-soft]="'var(--mode-' + item.color + '-soft)'"
              >
                <span class="nav__pill"><app-icon [name]="item.icon" /></span>
                <span class="nav__label--full">{{ item.label }}</span>
                <span class="nav__label--short" aria-hidden="true">{{ item.short }}</span>
              </a>
            </li>
          }
        </ul>
        <div class="nav__footer">
          <app-install-button [block]="true" />
        </div>
      </nav>

      <main class="content">
        <div class="stack">
          @if (!online()) {
            <div class="banner banner--warning" role="status">
              <app-icon name="info" />
              <p class="banner__text">
                Sin conexión. La app sigue funcionando, pero el reconocimiento de voz puede no estar disponible.
              </p>
            </div>
          }
          <app-update-notice />
        </div>
        <router-outlet />
      </main>
      <app-sw-notice />
    </div>
  `,
})
export class App {
  protected readonly nav = NAV;
  protected readonly online = onlineStatus();
}
