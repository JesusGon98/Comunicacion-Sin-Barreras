import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './Layout';
import { ConversationMode } from '../modes/conversation/ConversationMode';
import { TextToSignMode } from '../modes/text-to-sign/TextToSignMode';
import { SignToTextMode } from '../modes/sign-to-text/SignToTextMode';
import { SettingsPage } from './settings/SettingsPage';

// Rutas de la app: una por cada modo.
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<ConversationMode />} />
        <Route path="texto-a-senas" element={<TextToSignMode />} />
        <Route path="senas-a-texto" element={<SignToTextMode />} />
        <Route path="ajustes" element={<SettingsPage />} />
        {/* Cualquier ruta desconocida regresa al inicio */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
