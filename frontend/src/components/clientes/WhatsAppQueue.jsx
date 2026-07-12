// Fila de envio de WhatsApp.
//
// O wa.me NÃO envia em lote: cada link abre uma conversa e precisa de um clique. Em vez de
// fingir um "enviar para todos" que o navegador bloquearia, a fila percorre os contatos um a
// um, com a mensagem já personalizada e preenchida — o dono só confere e aperta enviar.
// (Envio automático de verdade exigiria a API oficial: template de marketing aprovado,
// créditos da carteira e regra de opt-in.)
import React, { useMemo, useState } from 'react';
import Drawer from '../Drawer.jsx';

const TEMPLATES = [
  {
    id: 'retorno',
    label: 'Sentimos sua falta',
    text: 'Oi {nome}! Faz {dias} dias que você não aparece por aqui. Quer marcar um horário esta semana?',
  },
  {
    id: 'aniversario',
    label: 'Aniversário',
    text: 'Oi {nome}! Passando para desejar um feliz aniversário. Separamos um mimo para você — quer agendar?',
  },
  {
    id: 'horarios',
    label: 'Horários abertos',
    text: 'Oi {nome}! Abriram horários esta semana. Quer garantir o seu?',
  },
];

const toDigits = (value) => String(value || '').replace(/\D/g, '');
const firstName = (value) => String(value || '').trim().split(/\s+/)[0] || '';

function fillTemplate(text, contact) {
  return String(text || '')
    .replace(/\{nome\}/g, firstName(contact?.nome) || 'tudo bem')
    .replace(/\{dias\}/g, contact?.days_since_last_visit ?? '—');
}

export default function WhatsAppQueue({ open, contacts, loading, error, truncated, limit, onClose }) {
  const [templateText, setTemplateText] = useState(TEMPLATES[0].text);
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState(() => new Set());
  const [skipped, setSkipped] = useState(() => new Set());

  // Contato sem telefone não entra na fila — mas o usuário precisa saber quantos ficaram fora.
  const { fila, semTelefone } = useMemo(() => {
    const list = Array.isArray(contacts) ? contacts : [];
    return {
      fila: list.filter((item) => toDigits(item.telefone).length >= 10),
      semTelefone: list.filter((item) => toDigits(item.telefone).length < 10),
    };
  }, [contacts]);

  const atual = fila[index] || null;
  const mensagem = atual ? fillTemplate(templateText, atual) : '';
  const link = atual
    ? `https://wa.me/${toDigits(atual.telefone)}?text=${encodeURIComponent(mensagem)}`
    : null;

  const avancar = () => setIndex((prev) => Math.min(prev + 1, fila.length));

  const marcarEnviado = () => {
    if (!atual) return;
    setSent((prev) => new Set(prev).add(atual.id));
    avancar();
  };

  const pular = () => {
    if (!atual) return;
    setSkipped((prev) => new Set(prev).add(atual.id));
    avancar();
  };

  const reiniciar = () => {
    setIndex(0);
    setSent(new Set());
    setSkipped(new Set());
  };

  const concluida = fila.length > 0 && index >= fila.length;

  return (
    <Drawer open={open} title="Fila de WhatsApp" onClose={onClose}>
      {loading ? (
        <div className="crm-drawer__section">
          <div className="shimmer" style={{ width: '60%', height: 18 }} />
          <div className="shimmer" style={{ width: '90%', height: 12 }} />
        </div>
      ) : error ? (
        <div className="crm-drawer__section">
          <div className="box error">{error}</div>
        </div>
      ) : (
        <div className="crm-drawer__section">
          <p className="muted wa-queue__intro">
            O WhatsApp não permite disparo em lote por link: a fila abre uma conversa por vez,
            com a mensagem já escrita. Você confere e envia.
          </p>

          {truncated && (
            <div className="box info" style={{ marginBottom: 12 }}>
              O recorte tem mais de {limit} clientes. A fila carregou os {limit} primeiros —
              refine o filtro ou use a exportação para o restante.
            </div>
          )}

          <div className="wa-queue__templates">
            {TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`chip ${templateText === template.text ? 'chip--active' : ''}`}
                onClick={() => setTemplateText(template.text)}
              >
                {template.label}
              </button>
            ))}
          </div>

          <label className="label" style={{ marginTop: 10 }}>
            <span>Mensagem — {'{nome}'} e {'{dias}'} são trocados por cliente</span>
            <textarea
              className="input"
              rows={3}
              value={templateText}
              onChange={(event) => setTemplateText(event.target.value)}
            />
          </label>

          <div className="wa-queue__progress">
            <strong>{Math.min(index + (concluida ? 0 : 1), fila.length)} de {fila.length}</strong>
            <span className="muted">
              {sent.size} enviados · {skipped.size} pulados
              {semTelefone.length ? ` · ${semTelefone.length} sem telefone` : ''}
            </span>
          </div>

          {!fila.length ? (
            <div className="empty">Nenhum contato com telefone neste recorte.</div>
          ) : concluida ? (
            <div className="wa-queue__done">
              <strong>Fila concluída.</strong>
              <span className="muted">{sent.size} conversas abertas, {skipped.size} puladas.</span>
              <button type="button" className="btn btn--sm btn--outline" onClick={reiniciar}>
                Recomeçar
              </button>
            </div>
          ) : (
            <div className="wa-queue__card">
              <div className="wa-queue__who">
                <strong>{atual.nome}</strong>
                <span className="muted">
                  {atual.relationship_label}
                  {atual.days_since_last_visit != null ? ` · ${atual.days_since_last_visit} dias sem retorno` : ''}
                </span>
              </div>
              <div className="wa-queue__preview">{mensagem}</div>
              <div className="crm-actions">
                <a
                  className="btn btn--sm"
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={marcarEnviado}
                >
                  Abrir conversa de {firstName(atual.nome)}
                </a>
                <button type="button" className="btn btn--sm btn--outline" onClick={pular}>
                  Pular
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
