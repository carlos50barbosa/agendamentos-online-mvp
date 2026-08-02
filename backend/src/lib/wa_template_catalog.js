// backend/src/lib/wa_template_catalog.js
//
// Catálogo dos modelos de mensagem criados na WABA de CADA estabelecimento que conectar a própria
// conta (Embedded Signup). Módulo puro: só dados e validação, sem I/O.
//
// ─── Por que um catálogo separado dos modelos da plataforma ─────────────────────────────────────
//
// Nome de modelo é único POR WABA, então em tese daria para repetir os mesmos nomes da plataforma
// (`confirmacao_agendamento_v2` e companhia) em cada tenant. O que impede é a ESTRUTURA:
//
//   - `lembrete_agendamento_v2` tem cabeçalho de IMAGEM, e imagem de cabeçalho depende de um
//     `header_handle` enviado para AQUELA WABA. Replicar exigiria upload por tenant.
//   - `confirmacao_agendamento_v2` tem cabeçalho de texto fixo "Agendamentos Online" — a marca da
//     plataforma saindo do número do salão, o que não faz sentido para quem recebe.
//
// Mesmo nome com estrutura diferente seria pior: o envio monta os componentes a partir do nome, e
// a divergência só apareceria em produção, no primeiro disparo. Por isso o sufixo `_t1` — ao ler
// um erro de envio dá para saber, pelo nome, de qual catálogo o modelo veio.
//
// Os CORPOS são cópias dos modelos que a Meta já aprovou para a plataforma. É a melhor evidência
// disponível de que passam de novo.
//
// ─── A regra que derruba criação de modelo ──────────────────────────────────────────────────────
//
// Variável não pode abrir nem fechar o corpo. Custou uma recusa em 01/08/2026:
//   "As variáveis não podem estar no início ou no fim do modelo."
// `assertCatalogIsValid()` trava isso em teste, antes de virar chamada à Graph.

/** Avisos ao DONO continuam saindo do número global da plataforma — ele é cliente nosso, não do salão. */
export const TENANT_TEMPLATE_KINDS = Object.freeze([
  'confirm_cli',
  'reminder_cli',
  'cancel_cli',
  'reschedule_cli',
]);

const CATALOG = Object.freeze([
  {
    kind: 'confirm_cli',
    name: 'confirmacao_agendamento_t1',
    language: 'pt_BR',
    category: 'UTILITY',
    // {{1}} serviço · {{2}} data e hora · {{3}} estabelecimento
    paramCount: 3,
    components: [
      {
        type: 'BODY',
        text: '✅ Novo agendamento registrado: {{1}} em {{2}} — {{3}}. Obrigado!',
        example: { body_text: [['Limpeza de pele', '31/12/2026, 17:00', 'Studio Bella']] },
      },
    ],
  },
  {
    kind: 'reminder_cli',
    name: 'lembrete_agendamento_t1',
    language: 'pt_BR',
    category: 'UTILITY',
    // {{1}} cliente · {{2}} estabelecimento · {{3}} data · {{4}} hora
    paramCount: 4,
    components: [
      {
        type: 'BODY',
        text:
          'Olá, {{1}}.\n\nEste é um lembrete sobre o seu próximo compromisso com *{{2}}* em ' +
          '*{{3}}* às *{{4}}*.\n\n_Em caso de imprevistos, entre em contato com o ' +
          'estabelecimento._\n\nEstamos ansiosos por te ver!',
        example: { body_text: [['Juliana', 'Studio Bella', '31 de dezembro de 2026', '13:00']] },
      },
      // O botão é funcional, não enfeite: o bot trata a resposta CONFIRMAR
      // (whatsapp/inbound, regra reminder_confirmation).
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'CONFIRMAR' }] },
    ],
  },
  {
    kind: 'cancel_cli',
    name: 'cancelamento_agendamento_t1',
    language: 'pt_BR',
    category: 'UTILITY',
    // {{1}} cliente · {{2}} estabelecimento · {{3}} data · {{4}} hora
    paramCount: 4,
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Seu compromisso foi cancelado' },
      {
        type: 'BODY',
        text:
          'Olá, {{1}}.\n\nSeu próximo compromisso com {{2}} em {{3}} às {{4}} foi cancelado.\n\n' +
          'Avise-nos se tiver alguma dúvida ou precisar reagendar.',
        example: { body_text: [['Juliana', 'Studio Bella', '31 de dezembro de 2026', '13:00']] },
      },
    ],
  },
  {
    kind: 'reschedule_cli',
    name: 'reagendamento_agendamento_t1',
    language: 'pt_BR',
    category: 'UTILITY',
    // {{1}} cliente · {{2}} novo horário · {{3}} estabelecimento
    paramCount: 3,
    components: [
      {
        type: 'BODY',
        text: 'Olá, {{1}}! Seu horário foi remarcado para {{2}} em {{3}}. Até breve!',
        example: { body_text: [['Juliana', 'sáb, 10h', 'Studio Bella']] },
      },
    ],
  },
]);

export function listTenantTemplates() {
  return CATALOG;
}

export function getTenantTemplate(kind) {
  return CATALOG.find((t) => t.kind === kind) || null;
}

/** O corpo, sem os componentes que não carregam variável. */
function bodyText(entry) {
  return entry.components.find((c) => c.type === 'BODY')?.text || '';
}

/** Quantas variáveis distintas o corpo declara. */
export function countBodyParams(entry) {
  const encontrados = new Set([...bodyText(entry).matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]));
  return encontrados.size;
}

/**
 * Valida o catálogo inteiro. Roda em teste — cada problema aqui seria uma recusa da Graph
 * descoberta só no momento de conectar um estabelecimento real.
 *
 * @returns {string[]} lista de problemas; vazia quando está tudo certo.
 */
export function validateCatalog() {
  const problemas = [];
  const nomes = new Set();

  for (const entry of CATALOG) {
    const id = entry.kind || '(sem kind)';

    if (!TENANT_TEMPLATE_KINDS.includes(entry.kind)) {
      problemas.push(`${id}: kind fora de TENANT_TEMPLATE_KINDS`);
    }
    if (nomes.has(entry.name)) problemas.push(`${id}: nome repetido "${entry.name}"`);
    nomes.add(entry.name);

    // A Meta aceita minúsculas, dígitos e underscore.
    if (!/^[a-z0-9_]+$/.test(entry.name)) {
      problemas.push(`${id}: nome "${entry.name}" tem caractere inválido`);
    }
    if (entry.category !== 'UTILITY') {
      problemas.push(`${id}: categoria ${entry.category} — tudo aqui é transacional`);
    }

    const corpo = bodyText(entry).trim();
    if (!corpo) {
      problemas.push(`${id}: sem componente BODY`);
      continue;
    }
    // A regra que já nos custou uma recusa.
    if (/^\{\{\d+\}\}/.test(corpo)) problemas.push(`${id}: o corpo COMEÇA com variável`);
    if (/\{\{\d+\}\}$/.test(corpo)) problemas.push(`${id}: o corpo TERMINA com variável`);

    const declarados = countBodyParams(entry);
    if (declarados !== entry.paramCount) {
      problemas.push(`${id}: paramCount=${entry.paramCount} mas o corpo usa ${declarados}`);
    }

    // A Meta exige um exemplo por variável, senão recusa o modelo.
    const exemplo = entry.components.find((c) => c.type === 'BODY')?.example?.body_text?.[0];
    if (!Array.isArray(exemplo)) {
      problemas.push(`${id}: sem example.body_text`);
    } else if (exemplo.length !== declarados) {
      problemas.push(`${id}: ${declarados} variáveis mas ${exemplo.length} exemplo(s)`);
    }
  }

  return problemas;
}

export function assertCatalogIsValid() {
  const problemas = validateCatalog();
  if (problemas.length) {
    throw new Error('catalogo de templates invalido:\n  - ' + problemas.join('\n  - '));
  }
}
