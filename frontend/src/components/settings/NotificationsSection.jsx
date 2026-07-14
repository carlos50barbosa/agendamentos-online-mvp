// src/components/settings/NotificationsSection.jsx
// Tópico "Notificações" (estabelecimento). Save parcial via Api.updateProfile — sem senha atual.
//
// A caixa do WhatsApp mudou de natureza: antes era só uma PREFERÊNCIA ("quero ser avisado"), agora
// é o ACEITE — o consentimento que a Meta exige antes de qualquer mensagem, com texto, data e IP
// registrados. Sem ele o backend não envia nada para este número, nem para o dono do salão.
//
// Por que não são dois controles (aceite + preferência): é a mesma intenção dita duas vezes, e
// separá-las só criaria o estado idiota de quem autorizou mas não recebe — ou o inverso, pior:
// quem desligou o aviso e continua com autorização registrada. O backend mantém as duas em sincronia.
import React, { useEffect, useState } from 'react';
import { Api } from '../../utils/api';
import { getUser, saveUser } from '../../utils/auth';
import { buildConsentText, CONSENT_AUDIENCE } from '../../utils/whatsappConsent.js';
import './settings.css';

const CONSENT_TEXT = buildConsentText({ audience: CONSENT_AUDIENCE.ESTABLISHMENT });

export default function NotificationsSection() {
  const [status, setStatus] = useState('loading');
  const [form, setForm] = useState({ email: false, whatsapp: false });
  // Estado de origem, para saber o que de fato mudou na hora de salvar (e não gravar um aceite
  // idêntico a cada clique em "Salvar").
  const [consented, setConsented] = useState(false);
  // O dono legado: notificação ligada desde antes do opt-in existir, e nenhum aceite registrado.
  // O envio para ele está BLOQUEADO até que ele aceite — e ele precisa saber disso.
  const [precisaReaceitar, setPrecisaReaceitar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let alive = true;
    const user = getUser();
    if (user?.tipo && user.tipo !== 'estabelecimento') { setStatus('forbidden'); return () => {}; }
    (async () => {
      try {
        const [resp, optin] = await Promise.all([Api.me(), Api.whatsappOptinStatus()]);
        if (!alive) return;
        const u = resp?.user || getUser() || {};
        // A caixa do WhatsApp reflete o CONSENTIMENTO, não a preferência antiga: é ele que decide
        // se a mensagem sai. Mostrar a preferência aqui deixaria a caixa marcada para quem está,
        // na prática, bloqueado.
        setConsented(Boolean(optin?.optin));
        setPrecisaReaceitar(Boolean(optin?.precisa_reaceitar));
        setForm({ email: Boolean(u.notify_email_estab), whatsapp: Boolean(optin?.optin) });
        setStatus('ready');
      } catch { if (alive) setStatus('error'); }
    })();
    return () => { alive = false; };
  }, []);

  const onSave = async (e) => {
    e.preventDefault();
    setBusy(true); setFeedback(null);
    try {
      // O e-mail vai pelo perfil; o WhatsApp, pelas rotas de consentimento (que também acertam a
      // preferência no banco). Mandar `notifyWhatsappEstab` aqui junto seria uma segunda fonte de
      // verdade para a mesma coisa — e as duas acabariam divergindo.
      const resp = await Api.updateProfile({ notifyEmailEstab: form.email });
      if (resp?.user) saveUser(resp.user);

      if (form.whatsapp !== consented) {
        if (form.whatsapp) {
          // MARCAR não grava mais consentimento — abre o WhatsApp para o dono ENVIAR "AUTORIZO".
          //
          // Marcar aqui gravava direto, e era o buraco: em 14/07/2026 alguém cadastrou o telefone
          // de uma pessoa aleatória, marcou esta caixa, e a vítima passou a receber template. Um
          // clique prova que alguém clicou. Uma mensagem enviada DAQUELE número prova quem é dono
          // dele — e ninguém manda mensagem do WhatsApp de um estranho.
          const r = await Api.whatsappOptin();
          if (r?.wa_link) window.open(r.wa_link, '_blank', 'noopener');
          setForm((f) => ({ ...f, whatsapp: false }));  // só marca de verdade quando o aceite chegar
          setFeedback({
            type: 'warn',
            message: 'Abrimos o WhatsApp com a mensagem pronta — é só enviar. A confirmação precisa sair do seu WhatsApp: é assim que sabemos que o número é seu.',
          });
          return;
        }
        // DESMARCAR revoga na hora: sair tem de ser sempre mais fácil que entrar.
        const estado = await Api.whatsappOptout();
        setConsented(Boolean(estado?.optin));
        setPrecisaReaceitar(false);
      }

      setFeedback({ type: 'success', message: 'Preferências salvas.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err?.data?.message || 'Não foi possível salvar.' });
    } finally { setBusy(false); }
  };

  if (status === 'loading') return <p className="muted" style={{ padding: 12 }}>Carregando…</p>;
  if (status === 'forbidden') return <p className="muted" style={{ padding: 12 }}>Disponível apenas para contas de estabelecimento.</p>;
  if (status === 'error') return <p className="muted" style={{ padding: 12 }}>Não foi possível carregar. Recarregue a página.</p>;

  return (
    <form onSubmit={onSave} className="set-section">
      <div className="set-block">
        <div className="set-block__head">
          <h4 className="set-block__title">Notificações</h4>
          <p className="set-block__sub">Como você quer receber avisos de novos agendamentos.</p>
        </div>

        {precisaReaceitar && (
          <div className="notice notice--warn" role="alert">
            <b>Seus avisos no WhatsApp estão pausados.</b> A Meta passou a exigir um aceite explícito
            e registrado antes de qualquer envio — e o seu ainda não existe. Marque a caixa abaixo e
            salve para voltar a receber. Enquanto isso, os avisos continuam chegando por e-mail.
          </div>
        )}

        <label className="set-switch">
          <input type="checkbox" checked={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.checked }))} />
          <span>Receber notificações por e-mail</span>
        </label>

        <label className="set-switch set-switch--consent">
          <input type="checkbox" checked={form.whatsapp} onChange={(e) => setForm((f) => ({ ...f, whatsapp: e.target.checked }))} />
          <span>
            Receber notificações no WhatsApp
            {/* O texto do aceite fica À VISTA, não atrás de um link: é ele que vai para o banco
                como prova, e prova de algo que a pessoa não leu não é prova. */}
            <small className="set-switch__consent-text">{CONSENT_TEXT}</small>
          </span>
        </label>
      </div>
      {feedback && <div className={`notice notice--${feedback.type}`} role="alert">{feedback.message}</div>}
      <div className="set-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </form>
  );
}
