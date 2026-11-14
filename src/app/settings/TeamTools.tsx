import { useEffect, useMemo, useState } from 'react';
import { currentLanguage } from '../../config/language';
import { buildPackage, buildVersionFile, downloadBytes, type BuiltPackage } from '../../lib/packageBuilder';
import { downloadJson } from '../../lib/share';
import { loadAllSamples, type LoadedSamples } from '../../lib/signData';

interface Props {
  currentVersion: number;
  currentOrigin: string;
}

/** Fecha de hoy en la zona horaria del dispositivo, como "2026-10-31". */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Row {
  label: string;
  personal: number;
  official: number;
}

// Herramienta del equipo: "Generar paquete".
// Crea lsm-senas-vN.json y lsm-version.json (con el sha256 ya calculado), listos para subir a Drive.
export function TeamTools({ currentVersion, currentOrigin }: Props) {
  const lang = currentLanguage;
  const [data, setData] = useState<LoadedSamples | null>(null);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [useOfficial, setUseOfficial] = useState(true);
  const [version, setVersion] = useState(currentVersion + 1);
  const [fecha, setFecha] = useState(todayLocal);
  const [notas, setNotas] = useState('');
  const [origen, setOrigen] = useState('');
  const [built, setBuilt] = useState<BuiltPackage | null>(null);
  const [driveId, setDriveId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadAllSamples(lang.id).then((loaded) => {
      setData(loaded);
      const labels = new Set(loaded.recognition.map((s) => s.label));
      setIncluded(labels);
      // Por defecto, "revisada" se copia del paquete actual
      setReviewed(new Set(loaded.official.filter((s) => s.reviewed).map((s) => s.label)));
    });
  }, [lang.id]);

  useEffect(() => setVersion(currentVersion + 1), [currentVersion]);

  // Tabla de señas: cuántos ejemplos hay de cada una en cada fuente
  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const map = new Map<string, Row>();
    for (const s of data.recognition) {
      const row = map.get(s.label) ?? { label: s.label, personal: 0, official: 0 };
      if (s.source === 'personal') row.personal++;
      else row.official++;
      map.set(s.label, row);
    }
    // Primero las letras en el orden del alfabeto, luego las palabras
    const order = (l: string) => {
      const i = lang.alphabet.indexOf(l);
      return i >= 0 ? i : 1000;
    };
    return [...map.values()].sort((a, b) => order(a.label) - order(b.label) || a.label.localeCompare(b.label, 'es'));
  }, [data, lang.alphabet]);

  const hasPersonal = rows.some((r) => included.has(r.label) && r.personal > 0);
  const suggestedOrigin =
    hasPersonal && useOfficial && currentOrigin
      ? `${currentOrigin} + grabaciones`
      : hasPersonal
        ? 'grabaciones'
        : currentOrigin;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, label: string) => {
    const next = new Set(set);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setter(next);
    setBuilt(null); // cualquier cambio invalida el paquete ya generado
  };

  const generate = async () => {
    if (!data) return;
    setError('');
    if (!Number.isInteger(version) || version < 1) return setError('La versión debe ser un número entero mayor que 0.');
    if (!notas.trim()) return setError('Escribe una nota corta (por ejemplo "Se agregaron 20 palabras").');

    const signs = rows
      .filter((r) => included.has(r.label))
      .map((r) => ({
        label: r.label,
        reviewed: reviewed.has(r.label),
        examples: data.recognition.filter(
          (s) => s.label === r.label && (s.source === 'personal' || useOfficial),
        ),
      }))
      .filter((s) => s.examples.length > 0);
    if (signs.length === 0) return setError('No hay ninguna seña con ejemplos para incluir.');

    setBusy(true);
    try {
      const pkg = await buildPackage({ lang, version, fecha, origen: origen.trim() || suggestedOrigin, notas: notas.trim(), signs });
      if (!pkg.sha256) throw new Error('No se pudo calcular el sha256 (se necesita https o localhost).');
      downloadBytes(pkg.bytes, pkg.fileName);
      setBuilt(pkg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar el paquete.');
    }
    setBusy(false);
  };

  const downloadVersion = () => {
    if (!built) return;
    downloadJson(buildVersionFile(built, { version, fecha, notas: notas.trim() }, driveId), `${lang.id}-version.json`);
  };

  if (!data) return <p className="muted">Cargando señas…</p>;

  return (
    <section className="card card--team" aria-labelledby="titulo-equipo">
      <h2 id="titulo-equipo">Herramientas del equipo: generar paquete</h2>
      <p className="muted small">
        Crea una nueva versión del paquete oficial con las señas elegidas. Solo para el equipo que revisa las señas.
      </p>

      <div className="team-grid">
        <label className="label" htmlFor="pkg-version">
          Versión
          <input
            id="pkg-version"
            className="input"
            type="number"
            min={1}
            value={version}
            onChange={(e) => {
              setVersion(Number(e.target.value));
              setBuilt(null);
            }}
          />
        </label>
        <label className="label" htmlFor="pkg-fecha">
          Fecha
          <input id="pkg-fecha" className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </label>
        <label className="label" htmlFor="pkg-origen">
          Origen de los datos
          <input
            id="pkg-origen"
            className="input"
            value={origen}
            placeholder={suggestedOrigin}
            onChange={(e) => setOrigen(e.target.value)}
          />
        </label>
      </div>
      {version <= currentVersion && (
        <div className="banner banner--warning">
          La versión debe ser mayor que la actual (v{currentVersion}); si no, las apps no la descargarán.
        </div>
      )}
      <label className="label" htmlFor="pkg-notas">
        Notas (se muestran en el aviso de actualización)
      </label>
      <input
        id="pkg-notas"
        className="input"
        value={notas}
        placeholder="Por ejemplo: Se agregaron 20 palabras"
        onChange={(e) => setNotas(e.target.value)}
      />

      <label className="check">
        <input
          type="checkbox"
          checked={useOfficial}
          onChange={(e) => {
            setUseOfficial(e.target.checked);
            setBuilt(null);
          }}
        />
        Incluir también los ejemplos del paquete actual (además de las señas grabadas en este dispositivo)
      </label>

      <div className="row">
        <button type="button" className="btn btn--small" onClick={() => setIncluded(new Set(rows.map((r) => r.label)))}>
          Elegir todas
        </button>
        <button type="button" className="btn btn--small" onClick={() => setIncluded(new Set())}>
          Quitar todas
        </button>
      </div>

      <table className="team-table">
        <thead>
          <tr>
            <th>Incluir</th>
            <th>Seña</th>
            <th>Grabadas aquí</th>
            <th>Del paquete</th>
            <th>Revisada</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={included.has(r.label) ? '' : 'team-table__off'}>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Incluir ${r.label}`}
                  checked={included.has(r.label)}
                  onChange={() => toggle(included, setIncluded, r.label)}
                />
              </td>
              <td>
                <strong>{r.label}</strong>
              </td>
              <td>{r.personal || '—'}</td>
              <td>{useOfficial ? r.official || '—' : <s>{r.official || '—'}</s>}</td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${r.label} revisada por una persona que sabe LSM`}
                  checked={reviewed.has(r.label)}
                  onChange={() => toggle(reviewed, setReviewed, r.label)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {error && <div className="banner banner--error">{error}</div>}

      <button type="button" className="btn btn--primary btn--big" onClick={generate} disabled={busy}>
        {busy ? 'Generando…' : `1. Generar ${lang.id}-senas-v${version}.json`}
      </button>

      {built && (
        <div className="team-result">
          <p>
            ✓ Se descargó <strong>{built.fileName}</strong> ({Math.round(built.bytes.length / 1024)} KB, {built.signCount}{' '}
            señas, {built.exampleCount} ejemplos).
          </p>
          <p className="small">
            sha256: <code className="code">{built.sha256}</code>
          </p>
          <ol className="steps-list">
            <li>Sube {built.fileName} a la carpeta de Google Drive y compártelo como "Cualquier persona con el enlace".</li>
            <li>
              Copia su ID (la parte larga del enlace: drive.google.com/file/d/<strong>ID</strong>/view) y pégalo aquí:
            </li>
          </ol>
          <input
            className="input"
            value={driveId}
            onChange={(e) => setDriveId(e.target.value)}
            placeholder="ID del paquete en Google Drive"
            aria-label="ID del paquete en Google Drive"
          />
          <button type="button" className="btn btn--primary" onClick={downloadVersion}>
            2. Descargar {lang.id}-version.json
          </button>
          <p className="muted small">
            3. En Drive, reemplaza el {lang.id}-version.json anterior con este (usa "Administrar versiones › Subir nueva
            versión" para que conserve su mismo ID). Las apps lo verán la próxima vez que se abran con internet.
          </p>
        </div>
      )}
    </section>
  );
}
