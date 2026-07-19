// src/utils/pwaInstall.js
// Convite para instalar o app na tela de início.
//
// A assimetria entre plataformas é o fato central aqui:
//
// ANDROID/Chrome — existe API. O navegador dispara `beforeinstallprompt`, a
// gente guarda o evento e chama `.prompt()` no momento que quiser. O usuário vê
// o diálogo NATIVO do sistema e instala com um toque. Automação de verdade.
//
// iOS/Safari — NÃO existe API, e não é lacuna temporária: a Apple nunca
// implementou e não sinaliza que vá. Não dá para criar o atalho por código nem
// abrir o menu Compartilhar. O teto é ensinar o caminho com uma seta.
//
// O iOS é justamente onde isso mais rende: sem instalar na tela de início, o
// Safari não expõe push nenhum — o dono de iPhone que não instala simplesmente
// nunca recebe notificação.
import { isStandalone } from './push.js';

const VISITS_KEY = 'pwa_install_visits';
const DISMISSED_KEY = 'pwa_install_dismissed_at';

// Quantos acessos ao painel antes de convidar. Quem voltou 3 vezes já mostrou
// que usa; convidar na primeira interrompe quem ainda está entendendo o produto,
// e uma dispensa gasta a chance por 30 dias.
const MIN_VISITS = 3;
const DISMISS_DAYS = 30;

export const IS_IOS =
  typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

// O evento chega UMA vez e cedo — antes de qualquer componente montar. Por isso
// a captura vive no módulo e é registrada no boot (main.jsx), não no banner.
let deferredPrompt = null;
let installed = false;
const listeners = new Set();

function emit() {
  for (const fn of listeners) {
    try { fn(); } catch { /* um assinante quebrado não derruba os outros */ }
  }
}

export function initInstallPrompt() {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Sem o preventDefault o Chrome mostra o próprio banner quando quiser, e a
    // gente perde o controle do momento.
    e.preventDefault();
    deferredPrompt = e;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    emit();
  });
}

export function subscribeInstall(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function canPromptNatively() {
  return Boolean(deferredPrompt);
}

/**
 * Dispara o diálogo nativo (Android). Devolve 'accepted' | 'dismissed' | null.
 * O evento só pode ser usado UMA vez: depois de `.prompt()` ele morre, e o
 * navegador só manda outro numa visita futura.
 */
export async function promptInstall() {
  if (!deferredPrompt) return null;
  const evt = deferredPrompt;
  deferredPrompt = null;
  emit();
  try {
    await evt.prompt();
    const choice = await evt.userChoice;
    return choice?.outcome || null;
  } catch {
    return null;
  }
}

function readInt(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

// Conta UMA vez por carregamento de página, não por render — senão qualquer
// re-render do dashboard inflaria o contador e o convite viria cedo demais.
let visitCounted = false;
export function noteVisit() {
  if (visitCounted) return readInt(VISITS_KEY);
  visitCounted = true;
  const next = readInt(VISITS_KEY) + 1;
  try { localStorage.setItem(VISITS_KEY, String(next)); } catch { /* modo privado */ }
  return next;
}

export function dismissInstall() {
  try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* modo privado */ }
  emit();
}

function dismissedRecently() {
  const at = readInt(DISMISSED_KEY);
  if (!at) return false;
  return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Decide se o convite aparece. Devolve { show, mode } —
 * mode: 'native' (Android, botão instala) | 'ios' (instruções manuais).
 */
export function getInstallState() {
  if (typeof window === 'undefined') return { show: false, mode: null };
  // Já está instalado: não há o que convidar.
  if (installed || isStandalone()) return { show: false, mode: null };
  if (dismissedRecently()) return { show: false, mode: null };
  if (readInt(VISITS_KEY) < MIN_VISITS) return { show: false, mode: null };

  // Só faz sentido no celular. No desktop dá para instalar, mas o texto fala de
  // tela de início e notificação no bolso — prometer isso num monitor é mentira.
  const isSmall = window.matchMedia?.('(max-width: 780px)')?.matches === true;
  if (!isSmall) return { show: false, mode: null };

  if (deferredPrompt) return { show: true, mode: 'native' };
  if (IS_IOS) return { show: true, mode: 'ios' };
  // Outros navegadores (Firefox Android, por exemplo) não expõem nem API nem um
  // fluxo previsível de instalação. Melhor não convidar do que dar instrução
  // errada para um menu que muda de lugar a cada navegador.
  return { show: false, mode: null };
}
