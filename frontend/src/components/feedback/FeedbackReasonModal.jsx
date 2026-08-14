// frontend/src/components/feedback/FeedbackReasonModal.jsx
//
// O motivo de quem está saindo (cancelamento) ou reduzindo (downgrade).
//
// A ordem dos passos é a coisa mais importante deste arquivo: PRIMEIRO grava o motivo, DEPOIS
// entrega o contato do suporte. Hoje o cancelamento acontece por fora — a pessoa manda mensagem no
// WhatsApp e a conversa some no meio de outras cinquenta. Se o handoff viesse antes, o dado
// dependeria da pessoa concluir uma segunda ação, e quem está de saída não conclui.
//
// Por isso também o envio nunca bloqueia a saída: se o POST falhar, o passo 2 aparece do mesmo
// jeito com o aviso do erro. Impedir alguém de cancelar porque a nossa pesquisa caiu seria
// transformar uma coleta de feedback num obstáculo — exatamente o que dá má fama a pesquisa.
import React, { useState } from 'react';
import Modal from '../Modal.jsx';
import { Api } from '../../utils/api.js';
import { site, waLink } from '../../config/site.js';
import ReasonPicker, { isReasonAnswerComplete } from './ReasonPicker.jsx';
import { REASONS_BY_TYPE } from './reasons.js';
import styles from './Feedback.module.css';

const COPY = {
  cancelamento: {
    title: 'Antes de cancelar',
    lead: 'Uma pergunta só. O que te fez chegar até aqui?',
    submitLabel: 'Enviar e falar com o suporte',
    doneTitle: 'Obrigado — anotamos',
    doneLead: 'O cancelamento é concluído pelo suporte. Chame no WhatsApp e resolvemos no mesmo dia.',
    waMessage: 'Olá! Quero cancelar minha assinatura do Agendamentos Online.',
  },
  downgrade: {
    title: 'Antes de mudar de plano',
    lead: 'Uma pergunta só. O que não está valendo a pena no plano atual?',
    submitLabel: 'Enviar e falar com o suporte',
    doneTitle: 'Obrigado — anotamos',
    doneLead: 'A troca para um plano menor é feita pelo suporte, sem você perder o período já pago. Chame no WhatsApp.',
    waMessage: 'Olá! Quero mudar para um plano menor no Agendamentos Online.',
  },
};

export default function FeedbackReasonModal({ tipo, contexto = null, onClose }) {
  const copy = COPY[tipo] || COPY.cancelamento;
  const reasons = REASONS_BY_TYPE[tipo] || REASONS_BY_TYPE.cancelamento;

  const [answer, setAnswer] = useState({ motivo: '', comentario: '' });
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');

  const completo = isReasonAnswerComplete(answer.motivo, answer.comentario);

  async function enviar() {
    if (!completo || enviando) return;
    setEnviando(true);
    setErro('');
    try {
      await Api.sendFeedback({
        tipo,
        motivo: answer.motivo,
        comentario: answer.comentario,
        contexto: contexto || `assinatura:${tipo}`,
      });
    } catch (err) {
      // Guardado para aparecer no passo 2, não para travar o passo 2.
      setErro(err?.data?.message || 'Não conseguimos registrar sua resposta, mas siga com o suporte normalmente.');
    } finally {
      setEnviando(false);
      setEnviado(true);
    }
  }

  if (enviado) {
    return (
      <Modal
        title={copy.doneTitle}
        onClose={onClose}
        actions={[
          <button key="fechar" type="button" className="btn btn--outline" onClick={onClose}>
            Fechar
          </button>,
          <a
            key="wa"
            className="btn btn--primary"
            href={waLink(site.support.whatsapp, copy.waMessage)}
            target="_blank"
            rel="noreferrer"
            onClick={onClose}
          >
            Falar no WhatsApp
          </a>,
        ]}
      >
        <p className={styles.done}>{copy.doneLead}</p>
        {erro ? <p className={styles.error}>{erro}</p> : null}
      </Modal>
    );
  }

  return (
    <Modal
      title={copy.title}
      onClose={onClose}
      actions={[
        <button key="voltar" type="button" className="btn btn--outline" onClick={onClose} disabled={enviando}>
          Voltar
        </button>,
        <button
          key="enviar"
          type="button"
          className="btn btn--primary"
          onClick={() => void enviar()}
          disabled={!completo || enviando}
        >
          {enviando ? <span className="spinner" /> : copy.submitLabel}
        </button>,
      ]}
    >
      <p className="muted" style={{ marginTop: 0 }}>{copy.lead}</p>
      <ReasonPicker
        name={`feedback-${tipo}`}
        reasons={reasons}
        motivo={answer.motivo}
        comentario={answer.comentario}
        onChange={setAnswer}
        disabled={enviando}
      />
    </Modal>
  );
}
