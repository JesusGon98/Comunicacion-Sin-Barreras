import { useEffect, useRef, useState } from 'react';
import { MicIcon } from '../../app/icons';

/** Datos extra cuando la pantalla grande muestra la voz en vivo. */
export interface LiveInfo {
  /** true si el texto todavía es provisional (la persona sigue hablando). */
  interim: boolean;
  /** true si el micrófono está activado. */
  listening: boolean;
  /** Texto de estado del micrófono ("Escuchando…", etc.). */
  status: string;
  onToggleMic: () => void;
}

interface Props {
  text: string;
  onClose: () => void;
  /** Si viene, la vista está "en vivo" y el texto cambia mientras la persona habla. */
  live?: LiveInfo;
}

// Elige un tamaño de letra según lo largo del texto, para que quepa en pantalla.
function fontSizeFor(text: string): string {
  const n = text.length;
  if (n <= 15) return '18vmin';
  if (n <= 40) return '12vmin';
  if (n <= 100) return '8vmin';
  if (n <= 200) return '6vmin';
  return '4.5vmin';
}

// Muestra un texto enorme a pantalla completa para enseñárselo a la otra persona.
// El botón "Voltear" gira el texto 180° para quien está enfrente, del otro lado de la mesa.
export function ShowOverlay({ text, onClose, live }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    // Intentamos usar la pantalla completa real del navegador (si lo permite)
    ref.current?.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose]);

  // En vivo y sin texto todavía: mostramos un aviso en lugar de la pantalla vacía
  const placeholder = live && !text;
  const shown = placeholder ? (live.listening ? 'Escuchando…' : 'Toca "Escuchar" para empezar') : text;

  const textClass = [
    'overlay__text',
    flipped && 'overlay__text--flipped',
    (placeholder || live?.interim) && 'overlay__text--interim',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={ref} className="overlay" role="dialog" aria-modal="true" aria-label="Texto en grande">
      {live?.listening && (
        <p className="overlay__status" role="status">
          <span className="pulse" aria-hidden="true" />
          {live.status}
        </p>
      )}

      <p className={textClass} style={{ fontSize: fontSizeFor(shown) }} aria-live={live ? 'polite' : undefined}>
        {shown}
      </p>

      <div className="overlay__bar">
        {live && (
          <button
            type="button"
            className={`btn ${live.listening ? 'btn--mic-on' : 'btn--primary'}`}
            onClick={live.onToggleMic}
            aria-pressed={live.listening}
          >
            <MicIcon />
            {live.listening ? 'Dejar de escuchar' : 'Escuchar'}
          </button>
        )}
        <button type="button" className="btn btn--secondary" onClick={() => setFlipped(!flipped)}>
          Voltear
        </button>
        <button type="button" className={`btn ${live ? 'btn--secondary' : 'btn--primary'}`} onClick={onClose} autoFocus>
          Cerrar
        </button>
      </div>
    </div>
  );
}
