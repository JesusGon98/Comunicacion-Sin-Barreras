import { useRef, useState } from 'react';
import type { HandFrame } from '../../lib/hands';
import { CameraView } from './CameraView';
import { RecognizePanel } from './RecognizePanel';
import { TrainPanel } from './TrainPanel';

type Tab = 'reconocer' | 'entrenar';

// Modo 3: Señas → Texto con cámara (experimental).
//
// Diseño "la cámara primero": mientras alguien hace señas necesita ver, sin hacer scroll,
// la cámara, lo que la app reconoce y el texto que se va armando. Por eso la cámara tiene
// dos espacios que llenan los paneles:
//   - "overlay": encima del video (seña detectada, cuenta regresiva al grabar…)
//   - "footer":  justo debajo del video (texto reconocido, botón de grabar…)
// Los paneles meten ahí su contenido con createPortal.
export function SignToTextMode() {
  const [tab, setTab] = useState<Tab>('reconocer');
  const [cameraOn, setCameraOn] = useState(false);
  // La cámara escribe aquí la mano detectada; los paneles la leen.
  const frameRef = useRef<HandFrame | null>(null);
  // Los dos espacios de la cámara (se guardan en el estado para que los paneles se redibujen al tenerlos)
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);
  const [footerEl, setFooterEl] = useState<HTMLDivElement | null>(null);

  const slots = { overlayEl, footerEl };

  return (
    <section className={`mode s2t s2t--${tab}`} aria-labelledby="titulo-senas-texto">
      <header className="s2t__header">
        <h1 id="titulo-senas-texto" className="s2t__title">
          Señas → Texto <span className="tag">Experimental</span>
        </h1>

        <div className="tabs s2t__tabs" role="tablist" aria-label="Opciones">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'reconocer'}
            className="tabs__tab"
            onClick={() => setTab('reconocer')}
          >
            Reconocer
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'entrenar'}
            className="tabs__tab"
            onClick={() => setTab('entrenar')}
          >
            Entrenar
          </button>
        </div>
      </header>

      <p className="mode__intro s2t__intro">
        Haz señas frente a la cámara y la app intenta reconocerlas. Primero hay que entrenarla con ejemplos. Las
        imágenes de la cámara nunca salen de tu dispositivo.
      </p>

      <div className="sign-layout">
        <div className="sign-layout__camera">
          <CameraView
            active={cameraOn}
            onToggle={() => setCameraOn(!cameraOn)}
            frameRef={frameRef}
            overlayRef={setOverlayEl}
          />
          <div ref={setFooterEl} className="sign-layout__footer" />
        </div>

        <div className="sign-layout__panel" role="tabpanel">
          {/* "key" hace que el panel se recargue al cambiar de pestaña (así toma las señas nuevas) */}
          {tab === 'reconocer' ? (
            <RecognizePanel
              key="reconocer"
              frameRef={frameRef}
              cameraOn={cameraOn}
              onGoTrain={() => setTab('entrenar')}
              {...slots}
            />
          ) : (
            <TrainPanel key="entrenar" frameRef={frameRef} cameraOn={cameraOn} {...slots} />
          )}
        </div>
      </div>
    </section>
  );
}
