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
import React, { useEffect, useState } from 'react';
import { MessageCircle, Check, Loader2 } from 'lucide-react';
import { Api } from '../../utils/api';
import { buildConsentText, CONSENT_AUDIENCE } from '../../utils/whatsappConsent.js';
import { useWhatsAppAvailable, useWhatsAppConsent } from '../../hooks/useWhatsAppStatus.js';
import styles from './WhatsAppOptInBanner.module.css';

const CONSENT_TEXT = buildConsentText({ audience: CONSENT_AUDIENCE.ESTABLISHMENT });

export default function WhatsAppOptInBanner() {
  const available = useWhatsAppAvailable();
  const { loading, precisaReaceitar, refresh } = useWhatsAppConsent();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState(null);
  // Depois de mandar o AUTORIZO, quem grava o consentimento é o WEBHOOK — não esta tela. Então ela
  // fica perguntando ao servidor até o aceite aparecer, e some sozinha quando aparece.
  const [aguardando, setAguardando] = useState(false);

  useEffect(() => {
    if (!aguardando) return undefined;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [aguardando, refresh]);

  if (loading || !precisaReaceitar) return null;

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
    try {
      const r = await Api.whatsappOptin();
      if (!r?.wa_link) throw new Error('sem link');
      // Abre numa aba nova: o dono volta para o painel e encontra o banner já resolvido.
      window.open(r.wa_link, '_blank', 'noopener');
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
        <p className={styles.title}>
          {available
            ? 'Seus avisos no WhatsApp estão pausados'
            : 'Autorize seus avisos no WhatsApp'}
        </p>

        <p className={styles.lead}>
          {available ? (
            <>
              A Meta passou a exigir um aceite explícito e registrado antes de qualquer envio — e o
              seu ainda não existe. Enquanto isso, os avisos continuam chegando por <b>e-mail</b>.
            </>
          ) : (
            <>
              {/* Honestidade custa uma frase e evita um chamado de suporte: sem isto, o dono
                  autoriza, não recebe nada, e abre ticket achando que quebrou. */}
              Nossas mensagens no WhatsApp estão <b>temporariamente suspensas</b>. Autorize agora e
              você volta a receber assim que restabelecermos — sem precisar fazer nada depois. Até
              lá, os avisos chegam por <b>e-mail</b>.
            </>
          )}
        </p>

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
