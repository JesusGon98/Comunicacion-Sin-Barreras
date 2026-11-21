import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { currentLanguage } from '../../../config/language';
import {
  addHistory,
  clearHistory,
  getHistory,
  getQuickPhrases,
  saveQuickPhrases,
  type HistoryEntry,
  type Speaker,
} from '../../../lib/db';
import {
  createRecognizer,
  isRecognitionSupported,
  isSynthesisSupported,
  speak,
  stopSpeaking,
  vibrate,
  type RecognitionErrorCode,
  type Recognizer,
} from '../../../lib/speech';
import { Icon } from '../../shared/components/icon/icon';
import { ShowOverlay, type LiveInfo } from '../../shared/components/show-overlay/show-overlay';
import { PhrasesEditor } from './components/phrases-editor/phrases-editor';

// Mensajes de error que ve el usuario, en lenguaje sencillo.
const ERROR_MESSAGES: Record<RecognitionErrorCode, string> = {
  permiso:
    'No hay permiso para usar el micrófono. Actívalo en la configuración del navegador (el candado junto a la dirección) y recarga la página.',
  politica:
    'El servidor de esta página bloquea el micrófono (cabecera Permissions-Policy). Hay que permitirlo en la configuración del servidor: microphone=(self).',
  inseguro: 'El micrófono solo funciona si la página se abre con https://.',
  servicio:
    'Este navegador no tiene servicio de reconocimiento de voz (pasa en Brave, en Chromium y en iPhone con Siri o Dictado desactivados). Prueba en Chrome o Edge, o activa Siri y Dictado.',
  'sin-red': 'El reconocimiento de voz necesita internet y no hay conexión. Puedes seguir usando el texto.',
  'sin-microfono': 'No se encontró ningún micrófono conectado.',
  otro: 'Hubo un problema con el reconocimiento de voz. Intenta de nuevo.',
};

const LABELS: Record<Speaker, string> = { oyente: 'Persona oyente', sorda: 'Persona sorda' };

// Modo 1: Conversación (voz ⇄ texto).
// En celular: el micrófono arriba, el historial en medio y la barra para responder
// pegada abajo, al alcance del pulgar (como una app de mensajes).
@Component({
  selector: 'app-conversation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ShowOverlay, PhrasesEditor],
  templateUrl: './conversation.html',
  styleUrl: './conversation.css',
})
export class ConversationPage {
  private readonly lang = currentLanguage.speechLocale;
  protected readonly recognitionSupported = isRecognitionSupported();
  protected readonly synthesisSupported = isSynthesisSupported();
  protected readonly labels = LABELS;

  protected readonly history = signal<HistoryEntry[]>([]);
  protected readonly historyNewestFirst = computed(() => [...this.history()].reverse());
  protected readonly phrases = signal<string[]>([]);
  protected readonly editingPhrases = signal(false);

  // Micrófono
  protected readonly wantListening = signal(false); // el usuario lo activó
  protected readonly listening = signal(false); // realmente está escuchando
  protected readonly interim = signal(''); // texto provisional
  private readonly lastHeard = signal(''); // última frase completa
  protected readonly error = signal<string | null>(null);

  // Respuesta de la persona sorda
  protected readonly draft = signal('');
  protected readonly speakingText = signal<string | null>(null);
  protected readonly showText = signal<string | null>(null);
  protected readonly showLive = signal(false);

  protected readonly liveText = computed(() => this.interim() || this.lastHeard());

  protected readonly micStatus = computed(() => {
    if (!this.wantListening()) return 'Toca el micrófono para empezar.';
    if (this.speakingText()) return 'En pausa mientras la app habla…';
    if (this.listening()) return 'La persona oyente puede hablar.';
    return 'Conectando el micrófono…';
  });

  protected readonly liveInfo = computed<LiveInfo>(() => ({
    interim: !!this.interim(),
    listening: this.wantListening(),
    status: this.micStatus(),
  }));

  private recognizer: Recognizer | null = null;
  private speechId = 0; // identifica la última frase que se mandó a decir

  constructor() {
    getHistory().then((h) => this.history.set(h));
    getQuickPhrases().then((p) => this.phrases.set(p));

    // Al salir de la pantalla, apagar micrófono y voz
    inject(DestroyRef).onDestroy(() => {
      this.wantListening.set(false);
      this.recognizer?.stop();
      stopSpeaking();
    });
  }

  protected formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  }

  private async addEntry(who: Speaker, text: string) {
    const entry = await addHistory({ who, text, time: Date.now() });
    this.history.update((h) => [...h, entry]);
  }

  // ---------- Micrófono ----------

  protected toggleListening() {
    if (this.wantListening()) {
      this.wantListening.set(false);
      this.recognizer?.stop();
      vibrate(40);
      return;
    }
    // Creamos el reconocedor la primera vez que se usa
    this.recognizer ??= createRecognizer({
      lang: this.lang,
      onInterim: (t) => this.interim.set(t),
      onFinal: (text) => {
        this.lastHeard.set(text);
        this.addEntry('oyente', text);
        vibrate(60); // aviso de que llegó texto nuevo
      },
      onError: (code, detail) => {
        // En errores raros mostramos el código del navegador para poder diagnosticarlo
        this.error.set(ERROR_MESSAGES[code] + (code === 'otro' && detail ? ` (código: ${detail})` : ''));
        if (code !== 'otro') this.wantListening.set(false);
        vibrate([100, 60, 100]);
      },
      onListeningChange: (v) => this.listening.set(v),
    });
    this.error.set(null);
    this.wantListening.set(true);
    this.recognizer.start();
    vibrate(40);
  }

  // ---------- Voz de la app ----------

  /** Dice un texto en voz alta. Si "record" es true, lo guarda en el historial. */
  protected say(text: string, record: boolean) {
    const clean = text.trim();
    if (!clean) return;
    if (record) this.addEntry('sorda', clean);
    if (!this.synthesisSupported) return;

    // Pausamos el micrófono mientras habla la app, para que no se escuche a sí misma
    if (this.wantListening()) this.recognizer?.stop();

    // Si se manda otra frase antes de terminar, solo la última reactiva el micrófono
    const id = ++this.speechId;
    speak(clean, {
      lang: this.lang,
      onStart: () => this.speakingText.set(clean),
      onEnd: () => {
        if (id !== this.speechId) return;
        this.speakingText.set(null);
        if (this.wantListening()) this.recognizer?.start();
      },
    });
  }

  protected stopSpeaking() {
    stopSpeaking();
  }

  protected onDraftInput(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    this.draft.set(el.value);
    // La caja crece con el texto (hasta un límite)
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`;
  }

  /** Enter envía; Shift + Enter hace un salto de línea. */
  protected onEnter(e: Event) {
    if ((e as KeyboardEvent).shiftKey) return;
    e.preventDefault();
    this.submitReply(e);
  }

  protected submitReply(e: Event) {
    e.preventDefault();
    this.say(this.draft(), true);
    this.draft.set('');
    const el = document.getElementById('respuesta') as HTMLTextAreaElement | null;
    if (el) {
      el.value = '';
      el.style.height = '';
    }
  }

  protected savePhrases(list: string[]) {
    this.phrases.set(list);
    saveQuickPhrases(list);
    this.editingPhrases.set(false);
  }

  protected closeShow() {
    this.showText.set(null);
    this.showLive.set(false);
  }

  protected async clearAll() {
    if (!window.confirm('¿Borrar todo el historial de la conversación?')) return;
    await clearHistory();
    this.history.set([]);
    this.lastHeard.set('');
  }
}
