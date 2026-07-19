// src/utils/push.js
// Ativacao de notificacoes push no navegador.
//
// O fluxo tem quatro etapas que falham por motivos diferentes, e a UI precisa
// distinguir: (1) o navegador suporta push? (2) o backend tem VAPID? (3) o
// usuario concedeu a permissao? (4) a assinatura chegou ao servidor?
//
// Cuidado com o iOS: Safari so expoe PushManager quando o app foi adicionado a
// tela de inicio. Aberto na aba normal, `isPushSupported()` retorna false — e
// isso e correto, nao um bug. A UI usa isso para ensinar o usuario a instalar.
import { Api } from './api.js';

export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// True quando a pagina roda como app instalado (standalone), e nao numa aba.
// `navigator.standalone` e a variante antiga do Safari iOS.
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    window.navigator?.standalone === true
  );
}

export function pushPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

// A chave publica VAPID vem em base64url e o PushManager exige Uint8Array.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration() {
  // `ready` so resolve quando ha um SW ativo. Em dev o SW esta desligado de
  // proposito (devOptions.enabled = false), entao isso nunca resolve — por isso
  // o timeout, senao a UI fica presa em "ativando..." para sempre.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('sw_timeout')), 10_000)),
  ]);
}

export async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  try {
    const reg = await getRegistration();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Estado completo para a UI decidir o que mostrar.
 * { supported, standalone, permission, subscribed, available }
 * `available` = o backend tem VAPID configurado.
 */
export async function getPushState() {
  const supported = isPushSupported();
  const state = {
    supported,
    standalone: isStandalone(),
    permission: pushPermission(),
    subscribed: false,
    available: false,
  };
  if (!supported) return state;

  try {
    const cfg = await Api.publicConfig();
    state.available = Boolean(cfg?.push?.available);
  } catch {
    // Config indisponivel: trate como push indisponivel em vez de oferecer um
    // botao que vai falhar na hora de assinar.
    state.available = false;
  }

  state.subscribed = Boolean(await getExistingSubscription());
  return state;
}

/**
 * Pede permissao, assina e registra no backend.
 * Devolve { ok } ou { ok:false, error } com um codigo que a UI traduz.
 */
export async function enablePush() {
  if (!isPushSupported()) return { ok: false, error: 'unsupported' };

  let publicKey = null;
  try {
    const cfg = await Api.publicConfig();
    if (!cfg?.push?.available || !cfg?.push?.publicKey) return { ok: false, error: 'push_disabled' };
    publicKey = cfg.push.publicKey;
  } catch {
    return { ok: false, error: 'config_failed' };
  }

  // Deve ser chamado a partir de um gesto do usuario (clique). Chamado no load,
  // o Chrome bloqueia o prompt e o usuario nunca ve nada.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, error: permission === 'denied' ? 'denied' : 'dismissed' };
  }

  try {
    const reg = await getRegistration();
    // Reaproveita a assinatura existente se ja houver — assinar de novo geraria
    // um endpoint novo e deixaria o antigo orfao no banco ate expirar.
    const subscription =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        // Obrigatorio: o navegador recusa assinatura que nao entrega payload.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    await Api.pushSubscribe(subscription.toJSON());
    return { ok: true };
  } catch (err) {
    if (err?.message === 'sw_timeout') return { ok: false, error: 'sw_unavailable' };
    console.warn('[push] falha ao assinar:', err);
    return { ok: false, error: 'subscribe_failed' };
  }
}

export async function disablePush() {
  try {
    const subscription = await getExistingSubscription();
    if (!subscription) return { ok: true };
    // Avisa o backend ANTES de cancelar no navegador: cancelando primeiro, o
    // endpoint some e nao ha mais como identificar qual linha apagar.
    await Api.pushUnsubscribe(subscription.endpoint).catch(() => {});
    await subscription.unsubscribe();
    return { ok: true };
  } catch (err) {
    console.warn('[push] falha ao cancelar:', err);
    return { ok: false, error: 'unsubscribe_failed' };
  }
}
