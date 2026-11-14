import { useState, type ChangeEvent } from 'react';
import { currentLanguage } from '../../config/language';
import { deleteMedia, saveMedia } from '../../lib/db';
import { CaptureDialog } from './CaptureDialog';
import type { MediaInfo } from './SignPlayer';

interface Props {
  /** Seña a la que se asocia la foto o el video. */
  label: string;
  current: MediaInfo | undefined;
  onChanged: () => void;
}

const MAX_FILE_MB = 25;

// Permite asociar una foto o un video propio a una seña (en vez de la mano esqueleto).
export function MediaEditor({ label, current, onChanged }: Props) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');

  const save = async (blob: Blob) => {
    setCapturing(false);
    setError('');
    await saveMedia(currentLanguage.id, label, blob);
    onChanged();
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    if (!file) return;
    if (!file.type.startsWith('image') && !file.type.startsWith('video')) {
      return setError('El archivo debe ser una foto o un video.');
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      return setError(`El archivo es muy grande (máximo ${MAX_FILE_MB} MB).`);
    }
    save(file);
  };

  const remove = async () => {
    if (!window.confirm(`¿Quitar la ${current?.type === 'video' ? 'grabación' : 'foto'} de «${label}»?`)) return;
    await deleteMedia(currentLanguage.id, label);
    onChanged();
  };

  return (
    <section className="card" aria-labelledby="titulo-media">
      <h2 id="titulo-media">Foto o video propio de «{label}»</h2>
      <p className="muted">
        {current
          ? `Esta seña tiene ${current.type === 'video' ? 'un video' : 'una foto'} propio.`
          : 'Puedes grabar tu propia foto o video de esta seña para mostrarlo en vez de la mano esqueleto.'}
      </p>
      <div className="row">
        <button type="button" className="btn btn--secondary" onClick={() => setCapturing(true)}>
          Usar la cámara
        </button>
        <label className="btn btn--secondary">
          Subir archivo
          <input type="file" accept="image/*,video/*" className="sr-only" onChange={onFile} />
        </label>
        {current && (
          <button type="button" className="btn btn--danger" onClick={remove}>
            Quitar
          </button>
        )}
      </div>
      {error && <div className="banner banner--error">{error}</div>}
      <p className="muted small">
        Usa solo fotos y videos grabados por ti o por personas que te dieron permiso. No copies imágenes de
        diccionarios de internet.
      </p>

      {capturing && <CaptureDialog label={label} onCapture={save} onClose={() => setCapturing(false)} />}
    </section>
  );
}
