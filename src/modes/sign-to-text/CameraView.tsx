import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { CameraIcon, PowerIcon, SwitchCameraIcon } from '../../app/icons';
import { detectHand, drawHand, getHandLandmarker, type HandFrame } from '../../lib/hands';
import { handGeometry, normalizeHand } from '../../lib/normalize';

type Status = 'off' | 'loading' | 'running' | 'error';

interface Props {
  /** Si es true, la cámara está encendida. */
  active: boolean;
  /** Encender o apagar la cámara. */
  onToggle: () => void;
  /** Aquí se escribe la mano detectada en cada cuadro (o null si no hay mano). */
  frameRef: MutableRefObject<HandFrame | null>;
  /** Recibe el espacio que está encima del video, para que los paneles pongan cosas ahí. */
  overlayRef?: (el: HTMLDivElement | null) => void;
}

// Mensajes de error en lenguaje sencillo
function errorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (!window.isSecureContext) {
    return 'La cámara solo funciona en una dirección segura (https) o en localhost.';
  }
  if (name === 'NotAllowedError') {
    return 'No hay permiso para usar la cámara. Actívalo en la configuración del navegador (el candado junto a la dirección).';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No se encontró ninguna cámara.';
  if (name === 'NotReadableError') return 'La cámara está ocupada por otra aplicación. Ciérrala e intenta de nuevo.';
  return 'No se pudo iniciar la detección de manos. Recarga la página e intenta de nuevo.';
}

// Muestra la cámara con los puntos de la mano dibujados encima.
export function CameraView({ active, onToggle, frameRef, overlayRef }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>('off');
  const [error, setError] = useState('');
  const [handVisible, setHandVisible] = useState(false);
  // 'user' = cámara frontal (selfie), 'environment' = cámara trasera
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [cameraCount, setCameraCount] = useState(0);

  useEffect(() => {
    if (!active) {
      setStatus('off');
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;

    (async () => {
      try {
        setStatus('loading');
        setError('');
        const landmarker = await getHandLandmarker();
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) return;

        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        // ¿Cuántas cámaras hay? (para mostrar el botón "Cambiar cámara")
        const devices = await navigator.mediaDevices.enumerateDevices();
        setCameraCount(devices.filter((d) => d.kind === 'videoinput').length);
        setStatus('running');

        // Bucle: en cada cuadro nuevo del video, detectamos la mano
        let lastVideoTime = -1;
        let lastVisible = false;
        const loop = () => {
          if (cancelled) return;
          const canvas = canvasRef.current;
          if (canvas && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
            lastVideoTime = video.currentTime;
            if (canvas.width !== video.videoWidth) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
            }
            const ctx = canvas.getContext('2d')!;
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const hand = detectHand(landmarker, video, performance.now());
            const aspect = video.videoWidth / video.videoHeight;
            const isLeft = hand?.handedness === 'Left';
            const vector = hand ? normalizeHand(hand.landmarks, isLeft, aspect) : null;

            if (hand && vector) {
              drawHand(ctx, hand.landmarks);
              const { wrist, size } = handGeometry(hand.landmarks, isLeft, aspect);
              frameRef.current = { vector, handedness: hand.handedness, wrist, size, time: performance.now() };
            } else {
              frameRef.current = null;
            }
            // Solo actualizamos la pantalla cuando cambia (para no redibujar 30 veces por segundo)
            const visible = Boolean(hand && vector);
            if (visible !== lastVisible) {
              lastVisible = visible;
              setHandVisible(visible);
            }
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setError(errorMessage(err));
        setStatus('error');
      }
    })();

    // Al apagar: detener el bucle y la cámara
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      frameRef.current = null;
      setHandVisible(false);
    };
  }, [active, facing, frameRef]);

  const mirrored = facing === 'user'; // la cámara frontal se ve como espejo

  return (
    <div className="camera">
      <div className={`camera__stage${mirrored ? ' camera__stage--mirrored' : ''}`}>
        <video ref={videoRef} className="camera__video" playsInline muted />
        <canvas ref={canvasRef} className="camera__canvas" />

        {/* Cámara apagada: todo el recuadro es un botón grande para encenderla */}
        {status === 'off' && (
          <button type="button" className="camera__start" onClick={onToggle}>
            <CameraIcon />
            <span>Encender cámara</span>
          </button>
        )}
        {status === 'loading' && (
          <div className="camera__message">Cargando la cámara y el detector de manos… (la primera vez tarda unos segundos)</div>
        )}
        {status === 'error' && (
          <div className="camera__message camera__message--error">
            <p>{error}</p>
            <button type="button" className="btn btn--secondary" onClick={onToggle}>
              Cerrar
            </button>
          </div>
        )}

        {/* Espacio para los paneles (seña detectada, cuenta regresiva…) */}
        <div className="camera__overlay" ref={overlayRef} />

        {/* Controles encima del video: indicador de mano, cambiar cámara y apagar */}
        {(status === 'running' || status === 'loading') && (
          <div className="camera__top">
            {status === 'running' ? (
              <span className={`hand-indicator${handVisible ? ' hand-indicator--on' : ''}`} role="status">
                {handVisible ? 'Mano detectada' : 'Sin mano'}
              </span>
            ) : (
              <span />
            )}
            <div className="camera__buttons">
              {status === 'running' && cameraCount > 1 && (
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')}
                  aria-label="Cambiar cámara"
                  title="Cambiar cámara"
                >
                  <SwitchCameraIcon />
                </button>
              )}
              <button type="button" className="icon-btn" onClick={onToggle} aria-label="Apagar cámara" title="Apagar cámara">
                <PowerIcon />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
