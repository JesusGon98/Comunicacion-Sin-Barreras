import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { currentLanguage } from '../../config/language';
import {
  addHistory,
  clearHistory,
  getHistory,
  getQuickPhrases,
  saveQuickPhrases,
  type HistoryEntry,
  type Speaker,
} from '../../lib/db';
import {
  createRecognizer,
  isRecognitionSupported,
  isSynthesisSupported,
  speak,
  stopSpeaking,
  vibrate,
  type RecognitionErrorCode,
  type Recognizer,
} from '../../lib/speech';
import { Icon } from '../shared/icon';
import { ShowOverlay, type LiveInfo } from '../shared/show-overlay';
import { PhrasesEditor } from './phrases-editor';

// Mensajes de error que ve el usuario, en lenguaje sencillo.
const ERROR_MESSAGES: Record<RecognitionErrorCode, string> = {
  permiso:
    'No hay permiso para usar el micrófono. Actívalo en la configuración del navegador (el candado junto a la dirección).',
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
  template: `
    <section class="page page--chat" aria-labelledby="titulo-conversacion">
      <header class="page-head">
        <div class="page-head__text">
          <h1 id="titulo-conversacion">Conversación</h1>
          <p class="page-head__intro">La app escucha a la persona oyente y lee en voz alta lo que escribes.</p>
        </div>
      </header>

      <!-- Aviso visible cuando la app está hablando (la persona sorda no lo escucha) -->
      @if (speakingText(); as t) {
        <div class="banner banner--accent speaking" role="status">
          <app-icon name="speaker" />
          <p class="banner__text">
            Diciendo en voz alta: <strong>«{{ t }}»</strong>
          </p>
          <button type="button" class="btn btn--sm btn--outline" (click)="stopSpeaking()">
            <app-icon name="stop" [size]="16" />
            Detener
          </button>
        </div>
      }

      <!-- ---------- Lo que dice la persona oyente ---------- -->
      <section class="listen" aria-labelledby="titulo-escuchar">
        @if (recognitionSupported) {
          <div class="listen__top">
            <button
              type="button"
              class="mic-btn"
              [class.mic-btn--on]="wantListening()"
              (click)="toggleListening()"
              [attr.aria-pressed]="wantListening()"
              [attr.aria-label]="wantListening() ? 'Dejar de escuchar' : 'Escuchar a la persona oyente'"
            >
              <app-icon [name]="wantListening() ? 'mic-off' : 'mic'" [size]="34" />
            </button>
            <div class="listen__info">
              <h2 id="titulo-escuchar" class="listen__title">
                {{ wantListening() ? 'Escuchando' : 'Escuchar' }}
              </h2>
              <p class="listen__status" role="status">
                @if (wantListening() && listening() && !speakingText()) {
                  <span class="pulse" aria-hidden="true"></span>
                }
                {{ micStatus() }}
              </p>
            </div>
            <button
              type="button"
              class="icon-btn"
              (click)="showLive.set(true)"
              aria-label="Mostrar en pantalla grande, en vivo"
              title="Pantalla grande en vivo"
            >
              <app-icon name="expand" />
            </button>
          </div>

          <div class="live" aria-live="polite">
            @if (liveText()) {
              <p class="live__text" [class.live__text--interim]="!!interim()">{{ liveText() }}</p>
            } @else {
              <p class="live__placeholder">Aquí aparecerá lo que diga la persona oyente.</p>
            }
          </div>
        } @else {
          <h2 id="titulo-escuchar" class="sr-only">Escuchar</h2>
          <div class="banner banner--warning">
            <app-icon name="info" />
            <p class="banner__text">
              Este navegador no puede convertir voz a texto (pasa en Firefox y en algunos iPhone). Pide a la persona
              oyente que escriba abajo, o abre la app en Chrome o Edge.
            </p>
          </div>
        }

        @if (error(); as e) {
          <div class="banner banner--error" role="alert">
            <app-icon name="info" />
            <p class="banner__text">{{ e }}</p>
          </div>
        }
      </section>

      <!-- ---------- Historial ---------- -->
      <section class="card" aria-labelledby="titulo-historial">
        <div class="card__head">
          <h2 id="titulo-historial">Historial</h2>
          @if (history().length > 0) {
            <button type="button" class="btn btn--sm btn--ghost" (click)="clearAll()">
              <app-icon name="trash" [size]="18" />
              Borrar
            </button>
          }
        </div>

        @if (history().length === 0) {
          <div class="chat__empty">
            <app-icon name="chat" [size]="40" />
            <p>Todavía no hay mensajes.<br />Empieza escuchando o escribiendo abajo.</p>
          </div>
        } @else {
          <ol class="chat" style="list-style: none; margin: 0; padding: 0">
            @for (entry of historyNewestFirst(); track entry.id) {
              <li [class]="'bubble bubble--' + entry.who">
                <span class="bubble__meta">{{ labels[entry.who] }} · {{ formatTime(entry.time) }}</span>
                <p class="bubble__body">{{ entry.text }}</p>
                <div class="bubble__actions">
                  <button type="button" class="btn btn--ghost" (click)="showText.set(entry.text)">
                    <app-icon name="expand" [size]="16" />
                    Mostrar
                  </button>
                  @if (synthesisSupported) {
                    <button type="button" class="btn btn--ghost" (click)="say(entry.text, false)">
                      <app-icon name="speaker" [size]="16" />
                      Decir
                    </button>
                  }
                </div>
              </li>
            }
          </ol>
        }
      </section>

      <!-- ---------- Responder (pegado abajo) ---------- -->
      <form class="composer" (submit)="submitReply($event)" aria-label="Responder">
        @if (!synthesisSupported) {
          <p class="muted small">Este navegador no puede leer en voz alta: usa «Mostrar en grande».</p>
        }
        <div class="phrases-head">
          <div class="chips spacer" role="group" aria-label="Frases rápidas">
            @for (phrase of phrases(); track $index) {
              <button type="button" class="chip" (click)="say(phrase, true)">{{ phrase }}</button>
            }
          </div>
          <button
            type="button"
            class="icon-btn"
            (click)="editingPhrases.set(true)"
            aria-label="Editar frases rápidas"
            title="Editar frases rápidas"
            style="width: 44px; height: 44px"
          >
            <app-icon name="edit" [size]="20" />
          </button>
        </div>

        <div class="composer__row">
          <label for="respuesta" class="sr-only">Escribe tu respuesta</label>
          <textarea
            id="respuesta"
            class="input composer__input"
            rows="1"
            placeholder="Escribe aquí…"
            [value]="draft()"
            (input)="onDraftInput($event)"
            (keydown.enter)="onEnter($event)"
          ></textarea>
          <button
            type="button"
            class="icon-btn"
            [disabled]="!draft().trim()"
            (click)="showText.set(draft().trim())"
            aria-label="Mostrar en grande"
            title="Mostrar en grande"
          >
            <app-icon name="expand" />
          </button>
          <button
            type="submit"
            class="icon-btn icon-btn--primary"
            [disabled]="!draft().trim()"
            [attr.aria-label]="synthesisSupported ? 'Decir en voz alta' : 'Guardar'"
            [title]="synthesisSupported ? 'Decir en voz alta' : 'Guardar'"
          >
            <app-icon [name]="synthesisSupported ? 'speaker' : 'send'" />
          </button>
        </div>
      </form>

      @if (editingPhrases()) {
        <app-phrases-editor [phrases]="phrases()" (saved)="savePhrases($event)" (cancel)="editingPhrases.set(false)" />
      }

      <!-- Pantalla grande en vivo: el texto se va actualizando mientras la persona oyente habla -->
      @if (showLive()) {
        <app-show-overlay
          [text]="liveText()"
          [live]="liveInfo()"
          (close)="closeShow()"
          (toggleMic)="toggleListening()"
        />
      } @else if (showText(); as t) {
        <app-show-overlay [text]="t" (close)="closeShow()" />
      }
    </section>
  `,
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
      onError: (code) => {
        this.error.set(ERROR_MESSAGES[code]);
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
