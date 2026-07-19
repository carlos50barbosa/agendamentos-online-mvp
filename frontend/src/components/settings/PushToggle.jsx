// src/components/settings/PushToggle.jsx
// Ativação das notificações push (PWA) do dono do estabelecimento.
//
// Mora dentro de "Notificações" porque é mais um canal, ao lado de e-mail e
// WhatsApp — mas NÃO é uma preferência salva com o botão Salvar da seção. É uma
// permissão do navegador: só existe depois de um clique direto do usuário, e o
// resultado vale para AQUELE aparelho, não para a conta. Por isso tem botão
// próprio e feedback próprio.
//
// A tela some inteira quando o backend não tem VAPID configurado. Oferecer um
// botão que sempre falha é pior que não oferecer nada.
import React, { useCallback, useEffect, useState } from 'react';
import { Api } from '../../utils/api';
import { getPushState, enablePush, disablePush, isStandalone } from '../../utils/push.js';
import './settings.css';

// iPadOS 13+ se anuncia como Mac, então isto erra para iPad. Erra para o lado
// seguro: mostra a dica de "adicione à tela de início", que é inofensiva.
const IS_IOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);

const ERROS = {
  denied: 'Você bloqueou as notificações para este site. Reative nas configurações do navegador e tente de novo.',
  dismissed: 'Você fechou o pedido de permissão sem responder. Toque de novo para ativar.',
  push_disabled: 'As notificações push ainda não estão configuradas no servidor.',
  config_failed: 'Não foi possível falar com o servidor. Tente de novo.',
  sw_unavailable: 'O app ainda não terminou de instalar. Recarregue a página e tente de novo.',
  subscribe_failed: 'Não foi possível ativar. Tente de novo.',
  unsupported: 'Este navegador não suporta notificações push.',
};

export default function PushToggle() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const refresh = useCallback(async () => {
    setState(await getPushState());
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const ativar = async () => {
    setBusy(true); setFeedback(null);
    const r = await enablePush();
    if (r.ok) setFeedback({ type: 'success', message: 'Notificações ativadas neste aparelho.' });
    else setFeedback({ type: 'error', message: ERROS[r.error] || ERROS.subscribe_failed });
    await refresh();
    setBusy(false);
  };

  const desativar = async () => {
    setBusy(true); setFeedback(null);
    const r = await disablePush();
    setFeedback(r.ok
      ? { type: 'success', message: 'Notificações desativadas neste aparelho.' }
      : { type: 'error', message: 'Não foi possível desativar. Tente de novo.' });
    await refresh();
    setBusy(false);
  };

  const testar = async () => {
    setBusy(true); setFeedback(null);
    try {
      await Api.pushTest();
      setFeedback({ type: 'success', message: 'Enviamos um teste. Deve chegar em alguns segundos.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err?.data?.error === 'no_subscriptions'
          ? 'Nenhum aparelho inscrito. Ative as notificações primeiro.'
          : 'Não foi possível enviar o teste.',
      });
    } finally { setBusy(false); }
  };

  if (!state) return null;
  // Sem VAPID no servidor não há o que oferecer.
  if (!state.available) return null;

  return (
    <div className="set-block">
      <div className="set-block__head">
        <h4 className="set-block__title">Notificações no celular</h4>
        <p className="set-block__sub">
          Um aviso na tela assim que um agendamento entrar, mesmo com o app fechado.
          A ativação vale para <b>este aparelho</b> — repita no celular e no computador se quiser nos dois.
        </p>
      </div>

      {!state.supported ? (
        // No iOS o Safari só expõe push depois que o site vira app na tela de
        // início. Sem esta explicação o dono conclui que o recurso não existe.
        <div className="notice notice--warn">
          {IS_IOS && !isStandalone() ? (
            <>
              <b>Falta um passo no iPhone.</b> Toque em <b>Compartilhar</b> e escolha{' '}
              <b>Adicionar à Tela de Início</b>. Abra o app por esse ícone e a opção aparece aqui.
            </>
          ) : (
            <>Este navegador não suporta notificações push. Tente pelo Chrome no Android ou pelo app instalado.</>
          )}
        </div>
      ) : state.permission === 'denied' ? (
        <div className="notice notice--warn">
          <b>As notificações estão bloqueadas para este site.</b> Libere nas configurações do
          navegador (cadeado ao lado do endereço → Notificações) e recarregue a página.
        </div>
      ) : (
        <>
          <p className="muted" style={{ margin: '0 0 10px' }}>
            {state.subscribed
              ? 'Ativadas neste aparelho.'
              : 'Desativadas neste aparelho.'}
          </p>
          {/* type="button" é obrigatório: este bloco vive dentro do <form> da
              seção, e o default seria submit — salvaria o perfil sem querer. */}
          <div className="set-actions" style={{ justifyContent: 'flex-start', gap: 8 }}>
            {state.subscribed ? (
              <>
                <button type="button" className="btn" onClick={testar} disabled={busy}>
                  Enviar teste
                </button>
                <button type="button" className="btn" onClick={desativar} disabled={busy}>
                  {busy ? 'Aguarde…' : 'Desativar'}
                </button>
              </>
            ) : (
              <button type="button" className="btn btn--primary" onClick={ativar} disabled={busy}>
                {busy ? 'Ativando…' : 'Ativar notificações'}
              </button>
            )}
          </div>
        </>
      )}

      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}
    </div>
  );
}
