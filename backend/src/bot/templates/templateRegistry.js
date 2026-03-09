const TEMPLATE_KEYS = Object.freeze({
  MENU_RETOMADA: 'MENU_RETOMADA',
  CONFIRMACAO_AGENDAMENTO: 'CONFIRMACAO_AGENDAMENTO',
  REMARCAR: 'REMARCAR',
  CANCELAR: 'CANCELAR',
});

function toText(value) {
  return String(value ?? '').trim();
}

function pickTemplateName(key) {
  if (key === TEMPLATE_KEYS.MENU_RETOMADA) {
    return toText(process.env.WA_TEMPLATE_NAME_MENU);
  }
  if (key === TEMPLATE_KEYS.CONFIRMACAO_AGENDAMENTO) {
    return (
      toText(process.env.WA_TEMPLATE_NAME_CONFIRMACAO) ||
      toText(process.env.WA_TEMPLATE_NAME_CONFIRM) ||
      toText(process.env.WA_TEMPLATE_NAME)
    );
  }
  if (key === TEMPLATE_KEYS.REMARCAR) {
    return (
      toText(process.env.WA_TEMPLATE_NAME_REMARCAR) ||
      toText(process.env.WA_TEMPLATE_NAME_MENU) ||
      toText(process.env.WA_TEMPLATE_NAME)
    );
  }
  if (key === TEMPLATE_KEYS.CANCELAR) {
    return (
      toText(process.env.WA_TEMPLATE_NAME_CANCELAR) ||
      toText(process.env.WA_TEMPLATE_NAME_MENU) ||
      toText(process.env.WA_TEMPLATE_NAME)
    );
  }
  return '';
}

function buildBodyComponents(params) {
  const values = Array.isArray(params)
    ? params.map((entry) => toText(entry)).filter(Boolean)
    : [];
  if (!values.length) return [];
  return [{
    type: 'body',
    parameters: values.map((value) => ({ type: 'text', text: value })),
  }];
}

function getTemplate(key, params = []) {
  const templateName = pickTemplateName(key);
  if (!templateName) return null;
  const language = toText(process.env.WA_TEMPLATE_LANG) || 'pt_BR';
  const components = buildBodyComponents(params);
  return {
    key,
    templateName,
    language,
    components,
  };
}

export { TEMPLATE_KEYS, getTemplate };
