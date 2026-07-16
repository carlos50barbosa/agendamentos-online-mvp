// src/components/client-appointments/ClientWhatsAppActivate.jsx
// Card que oferece ao CLIENTE logado ativar os lembretes no WhatsApp — pelo AUTORIZO.
//
// Por que não uma caixa que grava direto: consentimento por clique é forjável, e foi o que derrubou
// a conta (duas vezes). A prova de que o número é da pessoa é ela MANDAR "AUTORIZO" do próprio
// WhatsApp — ninguém envia do aparelho de um estranho. O clique aqui só abre o WhatsApp; quem grava
// o consentimento é o webhook, quando a mensagem chega daquele número.
//
// Some sozinho quando: já autorizou, o canal está fora do ar, ou não há telefone cadastrado.
import React, { useEffect, useState } from 'react';
import { Api } from '../../utils/api.js';
import { useWhatsAppConfig, useWhatsAppConsent } from '../../hooks/useWhatsAppStatus.js';

export default function ClientWhatsAppActivate() {
  const { available } = useWhatsAppConfig();
  const { loading, optin, semTelefone, refresh } = useWhatsAppConsent();
  const [busy, setBusy] = useState(false);
  const [aguardando, setAguardando] = useState(false);
  const [erro, setErro] = useState(null);

  // Depois de enviar o AUTORIZO, quem grava é o webhook — não esta tela. Então ela pergunta ao
  // servidor até o aceite aparecer, e o card some sozinho.
  useEffect(() => {
    if (!aguardando) return undefined;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [aguardando, refresh]);

  // Nada a fazer: já autorizou, canal fora do ar, ou sem telefone (aí o caminho é cadastrar o
  // número, não ativar — outra tela cuida disso).
  if (loading || optin || !available || semTelefone) return null;

  const ativar = async () => {
    setBusy(true);
    setErro(null);
    try {
      const r = await Api.whatsappOptin();
      if (!r?.wa_link) throw new Error('sem link');
      window.open(r.wa_link, '_blank', 'noopener');
      setAguardando(true);
    } catch (e) {
      setErro(e?.data?.message || 'Não foi possível abrir o WhatsApp. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="tw-flex tw-flex-col tw-gap-3 tw-rounded-2xl tw-p-4 sm:tw-flex-row sm:tw-items-center sm:tw-justify-between"
      style={{ background: 'var(--surface-soft, #F6F5FB)', border: '1px solid var(--brand-border, #E7E5F5)' }}
    >
      <div className="tw-min-w-0">
        <p className="tw-m-0 tw-text-sm tw-font-semibold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
          Receba a confirmação e os lembretes no WhatsApp
        </p>
        <p className="tw-m-0 tw-mt-0.5 tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
          {aguardando ? (
            <>Abrimos o WhatsApp com a mensagem pronta — <b>envie</b> e este aviso some sozinho. A
            confirmação precisa sair do seu WhatsApp: é assim que sabemos que o número é seu.</>
          ) : (
            <>Sem promoções — só sobre os seus horários. Você ativa enviando uma mensagem.</>
          )}
        </p>
        {erro && (
          <p className="tw-m-0 tw-mt-1 tw-text-xs tw-font-semibold" style={{ color: 'var(--status-cancelado-fg, #991B1B)' }}>
            {erro}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={ativar}
        disabled={busy}
        className="tw-inline-flex tw-shrink-0 tw-items-center tw-justify-center tw-gap-2 tw-rounded-xl tw-px-4 tw-font-semibold tw-text-white"
        style={{ minHeight: 44, background: '#16A34A', opacity: busy ? 0.7 : 1 }}
      >
        {busy ? 'Abrindo…' : aguardando ? 'Aguardando…' : 'Ativar no WhatsApp'}
      </button>
    </section>
  );
}
