// frontend/src/components/feedback/ExitSurvey.jsx
//
// Uma pergunta, para quem leu a página e não criou conta: "o que faltou?".
//
// É a resposta mais cara de obter no funil inteiro. Quem assina conta o porquê no suporte, no
// churn, no NPS; quem NÃO assina simplesmente fecha a aba, e o analytics registra só que fechou.
// Hoje o Pixel dispara PageView e mais nada — dá para saber quantos visitaram e nenhum motivo.
//
// Regras que mantêm isso tolerável para quem está do outro lado:
//   - aparece uma vez por navegador, para sempre (não é "uma vez por sessão");
//   - nunca aparece para quem está logado — cliente visitando a landing não é lead perdido;
//   - o gatilho é intenção de saída (desktop) ou 70% de rolagem, o que vier primeiro: antes disso
//     a pessoa ainda não leu o suficiente para ter um motivo, e perguntar cedo só atrapalha;
//   - fecha e não volta, inclusive se a resposta falhar.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Api } from '../../utils/api.js';
import { getUser } from '../../utils/auth.js';
import ReasonPicker, { isReasonAnswerComplete } from './ReasonPicker.jsx';
import { LANDING_REASONS } from './reasons.js';
import { markAsked, wasAskedRecently } from './feedbackStorage.js';
import styles from './Feedback.module.css';

const STORAGE_KEY = 'landing-exit';
const SCROLL_TRIGGER = 0.7;
// Uma pausa curta depois do gatilho: disparar no mesmo frame em que o mouse cruza o topo faz a
// caixa parecer que "pulou" na tela, e o reflexo é fechar antes de ler.
const TRIGGER_DELAY_MS = 400;

export default function ExitSurvey({ contexto = 'landing' }) {
  const [visivel, setVisivel] = useState(false);
  const [answer, setAnswer] = useState({ motivo: '', comentario: '' });
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState('');
  const armadoRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (getUser()) return undefined;
    if (wasAskedRecently(STORAGE_KEY)) return undefined;

    let timer = null;

    const disparar = () => {
      if (armadoRef.current) return;
      armadoRef.current = true;
      // Marca ANTES de mostrar: se a pessoa fechar a aba com a caixa aberta, ela não reaparece na
      // próxima visita. Perguntar de novo a quem já ignorou uma vez é como a pesquisa vira spam.
      markAsked(STORAGE_KEY);
      timer = setTimeout(() => setVisivel(true), TRIGGER_DELAY_MS);
    };

    // Intenção de saída: o ponteiro sai pela BORDA DE CIMA (rumo à aba/barra de endereço). Sair
    // pelos lados ou por baixo é uso normal da página e não dispara nada.
    const onMouseOut = (event) => {
      if (event.relatedTarget || event.clientY > 0) return;
      disparar();
    };

    // No celular não existe "sair com o mouse": lá o sinal é ter rolado a página quase toda.
    const onScroll = () => {
      const doc = document.documentElement;
      const alcance = doc.scrollHeight - window.innerHeight;
      if (alcance <= 0) return;
      if (window.scrollY / alcance >= SCROLL_TRIGGER) disparar();
    };

    document.addEventListener('mouseout', onMouseOut);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('mouseout', onMouseOut);
      window.removeEventListener('scroll', onScroll);
      if (timer) clearTimeout(timer);
    };
  }, []);

  const fechar = useCallback(() => setVisivel(false), []);

  const enviar = useCallback(async () => {
    if (!isReasonAnswerComplete(answer.motivo, answer.comentario) || enviando) return;
    setEnviando(true);
    setErro('');
    try {
      await Api.sendFeedback({
        tipo: 'landing',
        motivo: answer.motivo,
        comentario: answer.comentario,
        contexto,
      });
      setEnviado(true);
      setTimeout(() => setVisivel(false), 2600);
    } catch (err) {
      setErro(err?.data?.message || 'Não conseguimos enviar agora. Obrigado mesmo assim!');
      setEnviando(false);
    }
  }, [answer, enviando, contexto]);

  if (!visivel) return null;

  return (
    <aside className={styles.floating} role="dialog" aria-label="Pesquisa rápida">
      <div className={styles.floatingHeader}>
        <h3 className={styles.title}>
          {enviado ? 'Obrigado!' : 'Posso te fazer uma pergunta?'}
        </h3>
        <button type="button" className={styles.dismiss} onClick={fechar} aria-label="Fechar pesquisa">
          <span aria-hidden="true">×</span>
        </button>
      </div>

      {enviado ? (
        <p className={styles.lead} style={{ marginTop: 8 }}>
          Sua resposta ajuda a melhorar a página. Se quiser tirar dúvidas, é só chamar no WhatsApp.
        </p>
      ) : (
        <>
          <p className={styles.lead}>O que faltou para você criar sua conta hoje?</p>
          <div className={styles.body}>
            <ReasonPicker
              name="landing-exit"
              reasons={LANDING_REASONS}
              motivo={answer.motivo}
              comentario={answer.comentario}
              onChange={setAnswer}
              commentLabel="Quer detalhar? (opcional)"
              disabled={enviando}
            />
            {erro ? <p className={styles.error}>{erro}</p> : null}
            <div className={styles.actions}>
              <button type="button" className="btn btn--outline btn--sm" onClick={fechar} disabled={enviando}>
                Agora não
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => void enviar()}
                disabled={!isReasonAnswerComplete(answer.motivo, answer.comentario) || enviando}
              >
                {enviando ? <span className="spinner" /> : 'Enviar'}
              </button>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
