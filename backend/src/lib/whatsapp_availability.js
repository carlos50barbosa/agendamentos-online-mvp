// backend/src/lib/whatsapp_availability.js
// "O canal do WhatsApp está no ar?" — uma chave só, e a única fonte de verdade sobre isso.
//
// Nasceu porque a WABA da plataforma foi desabilitada pela Meta e o produto continuou prometendo
// WhatsApp: a caixa de opt-in dizia "quero receber a confirmação e os lembretes no WhatsApp" e o
// cliente não recebia nada. Quem contava com o lembrete não era lembrado — e virava falta no salão.
//
// Isto NÃO é o mesmo que os DISABLE_* de client_notifications.js/estab_notifications.js. Aqueles
// são interruptores de produto ("não quero mandar isso"). Este é um fato sobre o mundo ("não dá
// para mandar nada"), e por isso ele faz duas coisas que um kill switch não faria:
//
//   1. Curto-circuita o envio ANTES da API da Meta. Sem isso, cada confirmação e cada tick do cron
//      de lembrete bate numa conta desabilitada, falha e enche o log — proporcional a quantas
//      pessoas marcaram a caixa.
//
//   2. Aparece na TELA. O front pergunta por /public/config e conta a verdade a quem está prestes a
//      marcar a caixa ("estamos enviando por e-mail; seu aceite fica guardado"), em vez de prometer
//      o que não entrega.
//
// O que ele deliberadamente NÃO faz: parar de colher consentimento. O aceite continua sendo
// gravado, para que no dia em que a conta voltar a base já exista. Um canal fora do ar é motivo
// para não PROMETER, não para não PERGUNTAR.
//
// Para religar: tire WHATSAPP_UNAVAILABLE do .env da VPS e reinicie o PM2. Os dois avisos somem
// sozinhos e os envios voltam — sem build, sem deploy, sem tocar em código.

const TRUTHY = ['1', 'true', 'yes', 'on', 'sim'];

/**
 * O canal está fora do ar (conta suspensa/banida/em migração)?
 *
 * Lê a env A CADA CHAMADA, e não uma vez no import como os DISABLE_* fazem. Custa uma comparação de
 * string por envio — nada — e compra duas coisas que valem muito: o comportamento fica testável nos
 * dois estados (um módulo que congela a env no import só pode ser testado no estado em que o
 * processo nasceu), e a flag deixa de ser refém da ordem dos imports.
 */
export function whatsappUnavailable() {
  const raw = String(process.env.WHATSAPP_UNAVAILABLE ?? 'false').trim().toLowerCase();
  return TRUTHY.includes(raw);
}

export function whatsappAvailable() {
  return !whatsappUnavailable();
}
