import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Registra el service worker (lo que permite usar la app sin internet) y avisa:
//  - cuando la app ya quedó guardada y funciona sin conexión;
//  - cuando hay una versión nueva disponible.
export function OfflineNotice() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  // El aviso de "lista sin internet" se cierra solo después de unos segundos
  useEffect(() => {
    if (!offlineReady) return;
    const id = setTimeout(() => setOfflineReady(false), 8000);
    return () => clearTimeout(id);
  }, [offlineReady, setOfflineReady]);

  if (!offlineReady && !needRefresh) return null;

  return (
    <div className="toast" role="status">
      {needRefresh ? (
        <>
          <span>Hay una versión nueva de la app.</span>
          <button type="button" className="btn btn--primary btn--small-primary" onClick={() => updateServiceWorker(true)}>
            Actualizar
          </button>
          <button type="button" className="btn btn--small" onClick={() => setNeedRefresh(false)}>
            Después
          </button>
        </>
      ) : (
        <>
          <span>✓ La app está lista para usarse sin internet.</span>
          <button type="button" className="btn btn--small" onClick={() => setOfflineReady(false)}>
            Cerrar
          </button>
        </>
      )}
    </div>
  );
}
