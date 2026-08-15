// frontend/src/components/feedback/NpsPrompt.jsx
//
// NPS do dono do estabelecimento, disparado por MARCO DE USO — não por data no calendário.
//
// A diferença importa: uma pesquisa agendada para "todo dia 1º" pega em cheio quem se cadastrou
// ontem e ainda não viu nada do produto. A nota que vem daí não mede satisfação, mede
// desconhecimento — e polui a série para sempre. Quem decide a elegibilidade é o servidor
// (/feedback/nps/elegivel), que sabe a idade da conta, o volume de agendamentos e se a pessoa já
// respondeu nos últimos 90 dias. Daqui sai só o silêncio local, para não fazer a chamada à toa.
//
// A escala é de UM clique: escolher a nota já envia. O campo de texto aparece depois, opcional,
// e a resposta já está salva quando ele aparece — quem fecha a caixa nesse momento deixou o dado
// mais importante para trás, que é justamente o número.
import React, { useCallback, useEffect, useState } from 'react';
import { Api } from '../../utils/api.js';
import { markAsked, wasAskedRecently } from './feedbackStorage.js';
import styles from './Feedback.module.css';

const STORAGE_KEY = 'nps';
// Adiado de propósito: perguntar no primeiro segundo depois do login interrompe quem entrou para
// fazer alguma coisa. 12s é tempo de a pessoa já estar na tela que veio usar.
const DELAY_MS = 12000;
// Quem fecha sem responder descansa 30 dias. O servidor só conta quem RESPONDEU (90 dias), então
// sem esta memória local o "não quero" viraria a mesma pergunta no dia seguinte.
const SNOOZE_DIAS = 30;
const NOTAS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export default function NpsPrompt({ ativo = false }) {
  const [visivel, setVisivel] = useState(false);
  const [nota, setNota] = useState(null);
  // `nota` é só o que está selecionado na tela; `notaSalva` é o que o servidor confirmou. São
  // estados separados de propósito: enquanto eram um só, a tela avançava para "Obrigado pela
  // nota!" no clique e agradecia por um dado que o POST podia ter perdido no caminho.
  const [notaSalva, setNotaSalva] = useState(false);
  const [enviandoNota, setEnviandoNota] = useState(false);
  // Id da linha criada pelo clique na nota. É o que permite o comentário COMPLETAR a resposta em
  // vez de virar uma segunda — duas linhas com nota contariam esta pessoa duas vezes no NPS.
  const [feedbackId, setFeedbackId] = useState(null);
  const [comentario, setComentario] = useState('');
  const [salvandoComentario, setSalvandoComentario] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!ativo) return undefined;
    if (wasAskedRecently(STORAGE_KEY, SNOOZE_DIAS)) return undefined;

    let cancelado = false;
    let timer = null;

    (async () => {
      try {
        const res = await Api.npsEligibility();
        if (cancelado || !res?.elegivel) return;
        timer = setTimeout(() => { if (!cancelado) setVisivel(true); }, DELAY_MS);
      } catch {
        // Elegibilidade é opcional por natureza: se a chamada falhar, ninguém é perguntado hoje.
        // Uma pesquisa nunca deve virar erro na tela de quem só queria abrir a agenda.
      }
    })();

    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
    };
  }, [ativo]);

  const fechar = useCallback(() => {
    // Fechar depois de uma falha NÃO silencia por 30 dias: o silêncio é para quem escolheu não
    // responder, não para quem tentou e foi derrubado pelo nosso lado. Essa pessoa continua
    // elegível — e o servidor, que é quem manda na elegibilidade, ainda não registrou nada dela.
    if (!erro) markAsked(STORAGE_KEY);
    setVisivel(false);
  }, [erro]);

  // A nota vai embora no clique. Se a pessoa fechar antes de escrever o comentário, o número já
  // está salvo — é ele que compõe a métrica.
  const escolherNota = useCallback(async (valor) => {
    if (enviandoNota) return;
    setNota(valor);
    setErro('');
    setEnviandoNota(true);
    try {
      const res = await Api.sendFeedback({ tipo: 'nps', nota: valor, contexto: 'app' });
      setFeedbackId(res?.id || null);
      // Só aqui a tela avança e só aqui a pessoa passa a descansar os 30 dias. Marcar antes do
      // resultado gastava a janela de quem não chegou a ser ouvido.
      setNotaSalva(true);
      markAsked(STORAGE_KEY);
    } catch (err) {
      setErro(err?.data?.message || 'Não conseguimos registrar sua nota. Toque de novo para tentar.');
    } finally {
      setEnviandoNota(false);
    }
  }, [enviandoNota]);

  // Completa a linha da nota. Sem `feedbackId` não há o que completar: insistir aqui criaria uma
  // resposta solta, com comentário e sem nota, que entraria no relatório como respondente novo.
  const enviarComentario = useCallback(async () => {
    if (!comentario.trim() || salvandoComentario) return;

    // Antes isto caía no `finally` e mostrava "sua resposta foi registrada" com o comentário
    // jogado fora. O aviso troca de tom porque o fato é outro: a nota está salva, o texto não.
    if (!feedbackId) {
      setErro('Sua nota foi registrada, mas não conseguimos anexar o comentário.');
      return;
    }

    setSalvandoComentario(true);
    setErro('');
    try {
      await Api.updateFeedbackComment(feedbackId, comentario);
      setConcluido(true);
      setTimeout(() => setVisivel(false), 2200);
    } catch {
      // A caixa fica aberta: a nota já compõe a métrica, então aqui não se perde a resposta —
      // mas fingir que o texto entrou seria mentir para quem parou para escrever.
      setErro('Não conseguimos anexar seu comentário. Sua nota já está registrada.');
    } finally {
      setSalvandoComentario(false);
    }
  }, [comentario, feedbackId, salvandoComentario]);

  if (!visivel) return null;

  return (
    <aside className={`${styles.floating} ${styles.npsCard}`} role="dialog" aria-label="Pesquisa de satisfação">
      <div className={styles.floatingHeader}>
        <h3 className={styles.title}>
          {concluido ? 'Obrigado!' : notaSalva ? 'Obrigado pela nota!' : 'Como estamos indo?'}
        </h3>
        <button type="button" className={styles.dismiss} onClick={fechar} aria-label="Fechar pesquisa">
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {concluido ? (
        <p className={styles.lead} style={{ marginTop: 8 }}>Sua resposta foi registrada. Isso ajuda de verdade.</p>
      ) : notaSalva ? (
        <>
          <p className={styles.lead}>
            {nota >= 9
              ? 'Que bom! O que mais tem funcionado para você?'
              : nota >= 7
                ? 'O que faria você dar uma nota maior?'
                : 'O que precisa melhorar primeiro?'}
          </p>
          <div className={styles.body}>
            <label className={styles.field} htmlFor="nps-comentario">
              <span className="sr-only">Comentário</span>
              <textarea
                id="nps-comentario"
                className={styles.textarea}
                value={comentario}
                maxLength={1000}
                autoFocus
                placeholder="Opcional — escreva à vontade."
                onChange={(event) => setComentario(event.target.value)}
              />
            </label>
            {erro ? <p className={styles.error}>{erro}</p> : null}
            <div className={styles.actions}>
              <button type="button" className="btn btn--outline btn--sm" onClick={fechar} disabled={salvandoComentario}>
                Fechar
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => void enviarComentario()}
                disabled={!comentario.trim() || salvandoComentario}
              >
                {salvandoComentario ? <span className="spinner" /> : 'Enviar'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className={styles.lead}>
            De 0 a 10, o quanto você recomendaria o Agendamentos Online para outro dono de negócio?
          </p>
          <div className={styles.body}>
            <div className={styles.scale} role="group" aria-label="Nota de 0 a 10">
              {NOTAS.map((valor) => (
                <button
                  key={valor}
                  type="button"
                  className={nota === valor ? `${styles.scaleButton} ${styles.scaleButtonSelected}` : styles.scaleButton}
                  onClick={() => void escolherNota(valor)}
                  disabled={enviandoNota}
                >
                  {valor}
                </button>
              ))}
            </div>
            {/* Sem estas âncoras, 0 e 10 são ambíguos — há escalas por aí em que 0 é o melhor. */}
            <div className={styles.scaleLegend}>
              <span>Não recomendaria</span>
              <span>Recomendaria muito</span>
            </div>
            {/* O erro precisa aparecer AQUI: quando a gravação falha a tela não avança mais para o
                painel de comentário, que era o único lugar que mostrava esta mensagem. */}
            {erro ? <p className={styles.error}>{erro}</p> : null}
          </div>
        </>
      )}
    </aside>
  );
}
