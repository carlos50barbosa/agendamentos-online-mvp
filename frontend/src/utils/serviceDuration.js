// Duração de serviço: a mesma lista de opções e o mesmo rótulo em toda a aplicação.
//
// Antes cada tela tinha a sua: o onboarding parava em 180 min (quem tinha um serviço
// mais longo não conseguia cadastrar) e todas mostravam só "195 min", que ninguém lê
// como "3h15" sem fazer a conta de cabeça.

export const SERVICE_DURATION_STEP = 15;
export const SERVICE_DURATION_MIN = 5;
export const SERVICE_DURATION_MAX = 480; // 8h

export const SERVICE_DURATION_OPTIONS = (() => {
  const values = [];
  for (let minutes = SERVICE_DURATION_STEP; minutes <= SERVICE_DURATION_MAX; minutes += SERVICE_DURATION_STEP) {
    values.push(minutes);
  }
  return values;
})();

/** "45 min", "1h", "1h15", "8h" — o jeito que a dona do salão fala o horário. */
export function formatServiceDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  if (!total) return '0 min';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours}h`;
  return `${hours}h${String(rest).padStart(2, '0')}`;
}

/**
 * Lê a duração digitada à mão e devolve minutos — ou null quando não dá para entender.
 *
 * Aceita o que a pessoa escreveria sem pensar: "100", "100 min", "1h40", "1h 40",
 * "1:40", "1 hora e 40", "2 horas", "1,5h". Não valida faixa: quem chama decide o que
 * fazer com 3 min ou 20h (ver SERVICE_DURATION_MIN / SERVICE_DURATION_MAX).
 */
export function parseServiceDuration(input) {
  const raw = String(input ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!raw) return null;

  // "1h40", "1 h 40 min", "1:40", "2h", "2 horas", "1 hora e 15"
  //
  // O defeito era o ramo inteiro não conhecer a unidade por extenso: "2 horas" dava null enquanto
  // "2,0 horas" dava 120 na MESMA caixa de texto, com a dica do campo anunciando "aceita horas".
  // ("horas?" antes de "h" na alternância é só para o casamento não depender de backtracking.)
  const hoursAndMinutes = raw.match(/^(\d{1,2})\s*(?:horas?|hs|h|:)\s*(?:e\s*)?(\d{1,2})?\s*(?:m|min|mins|minutos?)?$/);
  if (hoursAndMinutes) {
    const minutes = hoursAndMinutes[2] ? Number(hoursAndMinutes[2]) : 0;
    if (minutes > 59) return null; // "1h70" é erro de digitação, não 2h10
    return Number(hoursAndMinutes[1]) * 60 + minutes;
  }

  // "1,5h" / "1.5 h" — quem pensa em hora quebrada costuma escrever assim.
  //
  // UM dígito só, de propósito. Com dois, "1,30h" é ambíguo: como decimal dá 78 min, como
  // relógio dá 90. Adivinhar produz o pior desfecho — grava 1h18 calado, com a agenda batendo
  // no cliente seguinte. Recusar faz a tela dizer "não entendi" e a pessoa reescrever "1h30".
  const decimalHours = raw.match(/^(\d{1,2})[.,](\d)\s*(?:horas?|hs|h)$/);
  if (decimalHours) {
    return Math.round(Number(`${decimalHours[1]}.${decimalHours[2]}`) * 60);
  }

  // "100", "100 min", "100 minutos"
  const onlyMinutes = raw.match(/^(\d{1,4})\s*(?:m|min|mins|minutos?)?$/);
  if (onlyMinutes) return Number(onlyMinutes[1]);

  return null;
}
