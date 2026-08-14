// frontend/src/components/feedback/feedbackStorage.js
//
// Memória local de "já perguntei isso a esta pessoa".
//
// É deliberadamente frágil: localStorage some com uma limpeza de cache ou uma janela anônima, e
// tudo bem — o pior caso é a pesquisa da landing reaparecer para alguém que já respondeu. Para o
// NPS, onde repetir a pergunta é caro, o servidor é quem manda (a rota /feedback/nps/elegivel
// consulta o histórico real); daqui sai só o silêncio rápido, para nem fazer a chamada.
//
// Todo acesso é try/catch: em Safari com "bloquear cookies" o simples `localStorage.getItem`
// lança, e uma pesquisa opcional não pode derrubar a página que ela está visitando.

const PREFIX = 'ao_feedback:';

export function readAskedAt(key) {
  try {
    const raw = localStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return null;
    const at = Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

export function markAsked(key, at = Date.now()) {
  try {
    localStorage.setItem(`${PREFIX}${key}`, String(at));
  } catch {}
}

/** `dias = null` significa "para sempre" (o caso da pesquisa da landing). */
export function wasAskedRecently(key, dias = null) {
  const at = readAskedAt(key);
  if (at == null) return false;
  if (dias == null) return true;
  return Date.now() - at < dias * 86400000;
}
