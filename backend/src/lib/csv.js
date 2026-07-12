// CSV para Excel pt-BR, num lugar só.
//
// O Excel brasileiro usa ';' como separador de lista e ',' como decimal. Com o padrão
// americano (',' e '.') o arquivo inteiro cai na coluna A e o valor vira texto. Esta lib
// existe para que a segunda exportação do sistema não reinvente — e divirja — da primeira.

export const CSV_SEPARATOR = ';';

export function escapeCsv(value) {
  if (value === null || value === undefined) return '""';
  const text = String(value).replace(/"/g, '""');
  return `"${text}"`;
}

// Centavos -> "1234,56" (decimal com vírgula, sem separador de milhar: o Excel agrupa sozinho).
export function formatCsvMoney(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
}

export function formatCsvBoolean(value) {
  return value ? 'Sim' : 'Não';
}

export function csvLine(values) {
  return values.map(escapeCsv).join(CSV_SEPARATOR) + '\n';
}

export function sanitizeFilenameSegment(value) {
  return String(value || '')
    .replace(/\s+/g, '-')
    .replace(/[^0-9A-Za-z_\-]/g, '')
    .toLowerCase();
}

// Abre a resposta como download e escreve o BOM — sem ele o Excel lê UTF-8 como latin-1
// e "Serviço" vira "ServiÃ§o".
export function startCsvResponse(res, filename, headerLabels) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write('﻿' + csvLine(headerLabels));
}
