import { useState, type ChangeEvent } from 'react';
import { currentLanguage } from '../../config/language';
import { exportSigns, importSigns } from '../../lib/share';

interface Props {
  onImported: () => void;
}

// Exportar e importar las señas entrenadas como archivo .json.
export function SharePanel({ onImported }: Props) {
  const [includeMedia, setIncludeMedia] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const n = await exportSigns(currentLanguage.id, includeMedia);
      setMessage(
        n === 0
          ? { ok: false, text: 'No hay señas para exportar todavía.' }
          : { ok: true, text: `Se descargó un archivo con ${n} ejemplos.` },
      );
    } catch {
      setMessage({ ok: false, text: 'No se pudo crear el archivo.' });
    }
    setBusy(false);
  };

  const doImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const r = await importSigns(file, currentLanguage.id);
      const parts = [`Se agregaron ${r.added} ejemplos`];
      if (r.skipped) parts.push(`${r.skipped} ya existían`);
      if (r.invalid) parts.push(`${r.invalid} tenían errores y se ignoraron`);
      if (r.media) parts.push(`${r.media} fotos o videos`);
      setMessage({ ok: true, text: parts.join(', ') + '.' });
      onImported();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'No se pudo leer el archivo.' });
    }
    setBusy(false);
  };

  return (
    <section className="card" aria-labelledby="titulo-compartir">
      <h2 id="titulo-compartir">Compartir señas</h2>
      <p className="muted">
        Guarda tus señas en un archivo para pasarlas a otro dispositivo o compartirlas con otras personas. Al importar,
        las señas del archivo se <strong>suman</strong> a las que ya tienes.
      </p>
      <label className="check">
        <input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} />
        Incluir mis fotos y videos (el archivo será más grande)
      </label>
      <div className="row">
        <button type="button" className="btn btn--secondary" onClick={doExport} disabled={busy}>
          Exportar (.json)
        </button>
        <label className={`btn btn--secondary${busy ? ' btn--disabled' : ''}`}>
          Importar (.json)
          <input type="file" accept=".json,application/json" className="sr-only" onChange={doImport} disabled={busy} />
        </label>
      </div>
      {message && (
        <div className={`banner ${message.ok ? 'banner--ok' : 'banner--error'}`} role="status">
          {message.text}
        </div>
      )}
    </section>
  );
}
