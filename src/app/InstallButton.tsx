import { useEffect, useState } from 'react';
import { DownloadIcon } from './icons';

// El navegador (Chrome, Edge, Android) lanza el evento "beforeinstallprompt"
// cuando la app se puede instalar. Lo guardamos para mostrar nuestro propio botón.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallButton() {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // evita el aviso automático del navegador
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // Si la app ya está instalada o el navegador no lo permite, no mostramos nada.
  // (En iPhone se instala desde Compartir → "Agregar a inicio").
  if (!installEvent) return null;

  const install = async () => {
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  };

  return (
    <button type="button" className="btn btn--secondary nav__install" onClick={install}>
      <DownloadIcon />
      <span>Instalar app</span>
    </button>
  );
}
