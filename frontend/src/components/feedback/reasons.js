// frontend/src/components/feedback/reasons.js
//
// Rótulos das opções de feedback. Os CÓDIGOS ('preco', 'sem_uso', ...) são contrato com o backend
// (lib/product_feedback.js valida contra a mesma lista) e não mudam; o texto ao lado é livre.
//
// A separação existe para o relatório sobreviver à copy: dá para reescrever "Achei caro" dez vezes
// procurando a frase que menos constrange, sem quebrar a série histórica de `preco`. Trocar um
// código, ao contrário, parte o histórico em dois — só faça isso de propósito.
//
// Ordem importa: a primeira opção é a mais escolhida em SaaS de pequeno negócio, e a lista curta
// (5 a 7 itens) é o que separa uma resposta pensada de um clique no primeiro item para escapar.

export const CANCEL_REASONS = [
  { code: 'preco', label: 'O preço não cabe no meu momento' },
  { code: 'sem_uso', label: 'Não consegui usar no dia a dia' },
  { code: 'falta_recurso', label: 'Faltou um recurso que eu precisava' },
  { code: 'dificuldade', label: 'Achei difícil de configurar ou usar' },
  { code: 'concorrente', label: 'Fui para outro sistema' },
  { code: 'fechei_negocio', label: 'Parei ou fechei o negócio' },
  { code: 'outro', label: 'Outro motivo' },
];

// Sem 'concorrente' e sem 'fechei_negocio': quem faz downgrade não foi para o concorrente nem
// fechou as portas — continua pagando, só que menos. Oferecer essas opções aqui produziria dado
// contraditório com o próprio ato.
export const DOWNGRADE_REASONS = [
  { code: 'preco', label: 'O plano atual está caro para mim' },
  { code: 'sem_uso', label: 'Não uso o que o plano atual oferece' },
  { code: 'falta_recurso', label: 'O que eu precisava não está no plano' },
  { code: 'dificuldade', label: 'Achei difícil de usar' },
  { code: 'outro', label: 'Outro motivo' },
];

export const LANDING_REASONS = [
  { code: 'so_pesquisando', label: 'Só estou pesquisando por enquanto' },
  { code: 'preco', label: 'Achei caro' },
  { code: 'duvida_funciona', label: 'Não entendi se serve para o meu negócio' },
  { code: 'falta_recurso', label: 'Faltou um recurso que eu preciso' },
  { code: 'outro', label: 'Outro motivo' },
];

export const REASONS_BY_TYPE = {
  cancelamento: CANCEL_REASONS,
  downgrade: DOWNGRADE_REASONS,
  landing: LANDING_REASONS,
};

/** Uma frase é exigida só no "Outro" — é a única opção que, sozinha, não informa nada. */
export function requiresComment(code) {
  return code === 'outro';
}
