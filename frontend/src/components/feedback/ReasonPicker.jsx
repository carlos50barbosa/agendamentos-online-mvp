// frontend/src/components/feedback/ReasonPicker.jsx
//
// Lista de motivos + campo livre. Controlado pelo pai porque quem sabe se dá para enviar é quem
// desenha o botão de enviar — e a regra ("Outro" exige uma frase) precisa valer nos dois lugares.
import React from 'react';
import { requiresComment } from './reasons.js';
import styles from './Feedback.module.css';

export const COMENTARIO_MAX = 1000;

/** Mesma regra do backend, para o botão poder desabilitar antes do round-trip. */
export function isReasonAnswerComplete(motivo, comentario) {
  if (!motivo) return false;
  if (requiresComment(motivo)) return String(comentario || '').trim().length >= 3;
  return true;
}

export default function ReasonPicker({
  name,
  reasons,
  motivo,
  comentario,
  onChange,
  commentLabel = 'Quer contar um pouco mais? (opcional)',
  disabled = false,
}) {
  const needsComment = requiresComment(motivo);
  const commentId = `${name}-comentario`;

  return (
    <div>
      <fieldset className={styles.reasons} disabled={disabled}>
        <legend className="sr-only">Motivo</legend>
        {reasons.map((reason) => (
          <label
            key={reason.code}
            className={motivo === reason.code ? `${styles.reason} ${styles.reasonSelected}` : styles.reason}
          >
            <input
              type="radio"
              name={name}
              value={reason.code}
              checked={motivo === reason.code}
              onChange={() => onChange({ motivo: reason.code, comentario })}
            />
            <span>{reason.label}</span>
          </label>
        ))}
      </fieldset>

      <label className={styles.field} htmlFor={commentId}>
        <span className={styles.fieldLabel}>
          {needsComment ? 'Conte o que aconteceu' : commentLabel}
        </span>
        <textarea
          id={commentId}
          className={styles.textarea}
          value={comentario}
          maxLength={COMENTARIO_MAX}
          disabled={disabled}
          placeholder={needsComment ? 'Em uma frase, o que motivou a decisão?' : 'Escreva à vontade — lemos tudo.'}
          onChange={(event) => onChange({ motivo, comentario: event.target.value })}
        />
      </label>
      {/* O contador só aparece perto do limite: mostrar "0/1000" desde o início parece cota a
          cumprir e encolhe a resposta de quem ia escrever três linhas. */}
      {comentario.length > COMENTARIO_MAX - 100 ? (
        <span className={styles.counter}>{comentario.length}/{COMENTARIO_MAX}</span>
      ) : null}
    </div>
  );
}
