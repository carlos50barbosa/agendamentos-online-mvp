// src/components/estab/WhatsAppOptInBanner.jsx
// O aviso que cutuca o DONO do salão a autorizar as mensagens no WhatsApp.
//
// Por que banner e não pop-up: consentimento tem de ser LIVRE. Um modal que bloqueia a tela é o
// exemplo de manual do que não conta como consentimento livre — nem para a Meta, nem para a LGPD.
// Um "sim" arrancado de quem só quer fechar a janela vale menos que nenhum: você teria o registro,
// e ele não sustentaria um recurso. Fora que modal a pessoa fecha no reflexo, e aí você gastou a
// única interação e saiu sem nada. Um banner teimoso, que fica até ser resolvido, converte mais.
//
// Só aparece para quem PRECISA: dono com a notificação ligada de antes do opt-in existir e sem
// aceite registrado. Para ele o envio está BLOQUEADO — e ele precisa saber disso, em vez de achar
// que recebe. Quem já aceitou não vê nada.
//
// E some quando o CANAL está fora do ar (`WHATSAPP_UNAVAILABLE`). Antes ele só trocava o texto e
// continuava pedindo o AUTORIZO — mas o AUTORIZO tem de chegar NO NÚMERO DA PLATAFORMA, e é
// justamente ele que está indisponível. O dono clicava, mandava a mensagem, nada confirmava, e a
// espera acabava em "ainda não recebemos sua confirmação" — para sempre. Pedir uma autorização que
// não tem como ser recebida não é honestidade sobre o apagão, é um beco sem saída.
import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle, Check, Loader2 } from 'lucide-react';
import { Api } from '../../utils/api';
import { buildConsentText, CONSENT_AUDIENCE } from '../../utils/whatsappConsent.js';
import { useWhatsAppAvailable, useWhatsAppConsent } from '../../hooks/useWhatsAppStatus.js';
import styles from './WhatsAppOptInBanner.module.css';

const CONSENT_TEXT = buildConsentText({ audience: CONSENT_AUDIENCE.ESTABLISHMENT });

/**
 * Duas roupagens, uma mecânica só.
 *
 * O pedido nasceu no painel, para o dono que já usava o produto e descobriu que o envio estava
 * bloqueado — daí o tom de aviso ("seus avisos estão pausados"). No ONBOARDING nada está pausado
 * ainda: a pessoa está montando a agenda e nunca recebeu nada. Repetir o texto do painel ali seria
 * anunciar uma pane que não existe.
 *
 * Por que a variante do onboarding foi para o PRIMEIRO passo, e não no último: medido em
 * 02/08/2026, quem termina a configuração cai no painel e vê o banner minutos depois de qualquer
 * jeito — pedir na Revisão alcança justamente quem já seria alcançado. O buraco é antes: 68% da
 * base nunca cadastrou um serviço sequer, e essa gente some sem nunca ver pedido nenhum. O passo 1
 * é o único que todo mundo vê.
 *
 * O que NÃO muda entre as duas: o texto do aceite (é ele que vira prova), o fato de o consentimento
 * só nascer com o AUTORIZO saindo do número da pessoa, e a regra de não bloquear nada. No
 * onboarding isso é ainda mais sensível — um pedido que trave o avanço vira consentimento forçado,
 * que não vale nem para a Meta nem para a LGPD.
 */
const COPY = {
  painel: {
    title: 'Seus avisos no WhatsApp estão pausados',
    lead: (
      <>
        A Meta passou a exigir um aceite explícito e registrado antes de qualquer envio — e o seu
        ainda não existe. Enquanto isso, os avisos continuam chegando por <b>e-mail</b>.
      </>
    ),
  },
  onboarding: {
    title: 'Quando alguém marcar, te aviso onde?',
    lead: (
      <>
        Por <b>e-mail</b> já vai, sempre. Para receber também no <b>WhatsApp</b>, a Meta exige um
        aceite seu — leva 10 segundos e você pode sair quando quiser.
      </>
    ),
  },
};

// Quanto tempo a tela fica perguntando "já autorizou?" antes de desistir. Sem isto, uma aba deixada
// aberta por quem clicou em Autorizar e NÃO enviou o AUTORIZO fica batendo no servidor a cada 3s para
// sempre — o webhook nunca vai confirmar um envio que não aconteceu. Três minutos cobre com folga
// quem foi mesmo mandar a mensagem; passou disso, é aba esquecida.
const ESPERA_MAX_MS = 3 * 60 * 1000;

export default function WhatsAppOptInBanner({ variant = 'painel' }) {
  const copy = COPY[variant] || COPY.painel;
  const available = useWhatsAppAvailable();
  const { loading, precisaReaceitar, refresh } = useWhatsAppConsent();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState(null);
  // Depois de mandar o AUTORIZO, quem grava o consentimento é o WEBHOOK — não esta tela. Então ela
  // fica perguntando ao servidor até o aceite aparecer, e some sozinha quando aparece.
  const [aguardando, setAguardando] = useState(false);
  // A espera desistiu sem confirmação: paramos de perguntar e avisamos que é para reenviar.
  const [expirado, setExpirado] = useState(false);
  // O prazo-limite mora num ref, não no estado do efeito: `refresh` troca de identidade a cada
  // resposta e faz o efeito recriar o intervalo, o que zeraria qualquer contagem local. O ref
  // sobrevive a esses re-renders, então o limite é absoluto — não reinicia a cada poll.
  const prazoRef = useRef(0);

  useEffect(() => {
    if (!aguardando) return undefined;
    const id = setInterval(() => {
      if (Date.now() >= prazoRef.current) {
        setAguardando(false);
        setExpirado(true);
        return;
      }
      refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [aguardando, refresh]);

  // Canal fora do ar: nem pede. Volta sozinho quando a env sair do .env — sem build, sem deploy.
  if (loading || !precisaReaceitar || !available) return null;

  /**
   * Não grava mais nada aqui — só abre o WhatsApp do dono com "AUTORIZO" pronto.
   *
   * Este botão gravava o consentimento direto, e era o buraco: alguém cadastrou o telefone de uma
   * pessoa aleatória, clicou, e a vítima passou a receber template. Um clique prova que alguém
   * clicou. Uma mensagem enviada DAQUELE número prova quem é dono dele — e ninguém manda mensagem
   * do WhatsApp de um estranho.
   */
  const autorizar = async () => {
    setBusy(true);
    setErro(null);
    setExpirado(false);
    try {
      const r = await Api.whatsappOptin();
      if (!r?.wa_link) throw new Error('sem link');
      // Abre numa aba nova: o dono volta para o painel e encontra o banner já resolvido.
      window.open(r.wa_link, '_blank', 'noopener');
      // Zera a contagem A CADA clique: um reenvio começa a espera do zero, não herda o prazo antigo.
      prazoRef.current = Date.now() + ESPERA_MAX_MS;
      setAguardando(true);
    } catch (e) {
      setErro(e?.data?.message || 'Não foi possível abrir o WhatsApp. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.banner} role="region" aria-label="Autorização do WhatsApp">
      <MessageCircle size={20} strokeWidth={2.2} aria-hidden="true" className={styles.icon} />

      <div className={styles.body}>
        <p className={styles.title}>{copy.title}</p>

        {/* Só existe o texto do canal NO AR: com ele fora, o componente inteiro já saiu acima. */}
        <p className={styles.lead}>{copy.lead}</p>

        {/* O texto do aceite fica À VISTA, e não atrás de um "saiba mais": é ele que o servidor
            grava como prova, e prova de algo que a pessoa não leu não é prova. */}
        <p className={styles.consent}>{CONSENT_TEXT}</p>

        {aguardando && (
          <p className={styles.lead}>
            <b>Abrimos o WhatsApp com a mensagem pronta.</b> É só <b>enviar</b> — assim que ela
            chegar, este aviso some sozinho. A confirmação precisa sair <b>do seu WhatsApp</b>: é
            assim que sabemos que o número é seu, e não de outra pessoa.
          </p>
        )}

        {expirado && (
          <p className={styles.lead} role="status">
            <b>Ainda não recebemos sua confirmação.</b> Se você já enviou o <b>AUTORIZO</b>, aguarde
            alguns instantes e recarregue a página. Se ainda não enviou, toque em{' '}
            <b>Autorizar no WhatsApp</b> de novo para reabrir a mensagem.
          </p>
        )}

        {erro && <p className={styles.error} role="alert">{erro}</p>}
      </div>

      <button type="button" className={styles.cta} onClick={autorizar} disabled={busy}>
        {busy ? (
          <><Loader2 size={16} strokeWidth={2.2} className="tw-animate-spin" aria-hidden="true" /> Abrindo…</>
        ) : aguardando ? (
          <><Loader2 size={16} strokeWidth={2.2} className="tw-animate-spin" aria-hidden="true" /> Aguardando…</>
        ) : (
          <><Check size={16} strokeWidth={2.2} aria-hidden="true" /> Autorizar no WhatsApp</>
        )}
      </button>
    </div>
  );
}
