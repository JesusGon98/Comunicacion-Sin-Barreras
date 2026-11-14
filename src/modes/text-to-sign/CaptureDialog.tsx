import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}

const MAX_VIDEO_SECONDS = 8;

/** Elige un formato de video que el navegador sepa grabar. */
function pickVideoType(): string {
  const options = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
  return options.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';
}

// Ventana para tomar una foto o grabar un video corto de una seña con la cámara.
export function CaptureDialog({ label, onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // Encender la cámara al abrir; apagarla al cerrar
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })
      .then(async (stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        videoRef.current!.srcObject = stream;
        await videoRef.current!.play();
      })
      .catch(() => setError('No se pudo abrir la cámara. Revisa el permiso en el navegador.'));
    return () => {
      cancelled = true;
      recorderRef.current?.state === 'recording' && recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Contador de segundos mientras se graba (y corte automático)
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_VIDEO_SECONDS) recorderRef.current?.stop();
        return s + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [recording]);

  const takePhoto = () => {
    const video = videoRef.current!;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    canvas.toBlob((blob) => blob && onCapture(blob), 'image/jpeg', 0.85);
  };

  const startVideo = () => {
    if (!streamRef.current) return;
    const type = pickVideoType();
    const recorder = new MediaRecorder(streamRef.current, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      setRecording(false);
      if (chunks.length) onCapture(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
    };
    recorderRef.current = recorder;
    recorder.start();
    setSeconds(0);
    setRecording(true);
  };

  return (
    <div className="overlay overlay--dialog" role="dialog" aria-modal="true" aria-labelledby="titulo-captura">
      <div className="dialog">
        <h2 id="titulo-captura">Foto o video de «{label}»</h2>
        {error ? (
          <div className="banner banner--error">{error}</div>
        ) : (
          <div className="dialog__camera">
            <video ref={videoRef} className="dialog__video" playsInline muted />
            {recording && (
              <div className="dialog__rec" role="status">
                ● Grabando {seconds} / {MAX_VIDEO_SECONDS} s
              </div>
            )}
          </div>
        )}
        <div className="row">
          {!recording ? (
            <>
              <button type="button" className="btn btn--primary" onClick={takePhoto} disabled={!!error}>
                Tomar foto
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={startVideo}
                disabled={!!error || typeof MediaRecorder === 'undefined'}
              >
                Grabar video
              </button>
            </>
          ) : (
            <button type="button" className="btn btn--mic-on" onClick={() => recorderRef.current?.stop()}>
              Detener video
            </button>
          )}
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
