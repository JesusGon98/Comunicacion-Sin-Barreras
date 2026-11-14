import { NavLink, Outlet } from 'react-router-dom';
import { ChatIcon, HandIcon, CameraIcon, GearIcon } from './icons';
import { InstallButton } from './InstallButton';
import { OfflineNotice } from './OfflineNotice';
import { UpdateNotice } from './UpdateNotice';
import { useOnlineStatus } from './useOnlineStatus';

// Los 3 modos y los ajustes, en la navegación.
// "short" es el nombre corto que se ve en la barra de abajo del celular (ahí hay poco espacio).
const NAV_ITEMS = [
  { to: '/', label: 'Conversación', short: 'Conversar', Icon: ChatIcon },
  { to: '/texto-a-senas', label: 'Texto → Señas', short: 'Ver señas', Icon: HandIcon },
  { to: '/senas-a-texto', label: 'Señas → Texto', short: 'Cámara', Icon: CameraIcon },
  { to: '/ajustes', label: 'Ajustes', short: 'Ajustes', Icon: GearIcon },
];

// Estructura general: barra de navegación (abajo en móvil, a la izquierda en escritorio)
// y el contenido del modo activo.
export function Layout() {
  const online = useOnlineStatus();

  return (
    <div className="layout">
      <nav className="nav" aria-label="Modos de la app">
        <div className="nav__brand">Sin Barreras</div>
        <ul className="nav__list">
          {NAV_ITEMS.map(({ to, label, short, Icon }) => (
            <li key={to}>
              <NavLink to={to} end className="nav__link" aria-label={label}>
                <Icon />
                <span className="nav__label--full">{label}</span>
                <span className="nav__label--short" aria-hidden="true">
                  {short}
                </span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="nav__extra">
          <InstallButton />
        </div>
      </nav>

      <main className="content">
        {!online && (
          <div className="banner banner--warning" role="status">
            Sin conexión a internet. La app sigue funcionando, pero el reconocimiento de voz puede no estar
            disponible.
          </div>
        )}
        <UpdateNotice />
        <Outlet />
      </main>
      <OfflineNotice />
    </div>
  );
}
