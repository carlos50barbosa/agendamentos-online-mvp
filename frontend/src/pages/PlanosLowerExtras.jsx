// Parte de baixo da landing de planos: comparativo (colapsado), FAQ, CTA final e rodapé.
// Carregado lazy — nada aqui aparece antes da rolagem.
//
// O FAQ antigo repetia os limites na copy ("Starter: até 2 profissionais. Pro: até 5...") —
// uma terceira cópia dos mesmos números, que envelheceria sozinha. Agora o comparativo sai do
// catálogo do backend e o FAQ só responde o que é comportamento, não número.
import React from 'react';
import { Link } from 'react-router-dom';

const UNLIMITED = 'Ilimitado';
const YES = 'Sim';
const NO = '—';

const fmt = (value) => (value == null ? UNLIMITED : Number(value).toLocaleString('pt-BR'));

const ROWS = [
  { label: 'Agendamentos por mês', get: (plan) => fmt(plan.max_monthly_appointments) },
  { label: 'Serviços', get: (plan) => fmt(plan.max_services) },
  { label: 'Profissionais', get: (plan) => fmt(plan.max_professionals) },
  { label: 'Mensagens de WhatsApp por mês', get: (plan) => fmt(plan.whatsapp_included_messages) },
  { label: 'Fotos na galeria pública', get: (plan) => fmt(plan.max_gallery_images) },
  { label: 'Sinal via PIX', get: (plan) => (plan.allow_deposit ? YES : NO) },
  { label: 'Relatórios avançados', get: (plan) => (plan.allow_advanced_reports ? YES : NO) },
  { label: 'Cadastro de clientes (CRM)', get: () => YES },
  { label: 'Página pública de agendamento', get: () => YES },
];

// As perguntas que travam a compra de verdade. Cada resposta é verificável no produto.
const FAQ = [
  {
    q: 'Preciso de cartão para testar?',
    a: 'Não. O teste começa no próprio cadastro e não pede cartão. Se você não assinar ao fim do período, nada é cobrado.',
  },
  {
    q: 'Posso trocar de plano ou cancelar depois?',
    a: 'Sim, pelo painel. Upgrades liberam os recursos na hora e o novo valor entra no ciclo seguinte. Downgrades valem no próximo ciclo, desde que você esteja dentro dos limites do plano menor.',
  },
  {
    q: 'E se as mensagens de WhatsApp acabarem no meio do mês?',
    a: 'Nenhum agendamento deixa de ser confirmado: os avisos continuam por e-mail e no painel. A franquia renova no ciclo seguinte, e dá para comprar um pacote extra por PIX a qualquer momento.',
  },
  {
    q: 'O sinal cai na minha conta?',
    a: 'Sim. O valor vai para a sua conta no Asaas, descontada a taxa de processamento do pagamento. Se o cliente não aparecer, o sinal fica com você — isso é uma opção nas configurações.',
  },
  {
    q: 'Tenho mais profissionais do que o Premium permite.',
    a: 'Fale com a gente. Operações maiores têm implantação assistida e limites combinados caso a caso.',
  },
];

export default function PlanosLowerExtras({ plans = [], trialDays = 7, onTrial, onTalkSpecialist }) {
  return (
    <>
      {/* Comparativo colapsado: quem quer o detalhe abre, quem não quer não tropeça nele. */}
      {plans.length > 0 && (
        <section className="lp-compare">
          <div className="lp-shell">
            <details className="lp-details">
              <summary>Ver comparativo completo</summary>
              <div className="lp-table-wrap">
                <table className="lp-table">
                  <thead>
                    <tr>
                      <th scope="col">Recurso</th>
                      {plans.map((plan) => <th key={plan.code} scope="col">{plan.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => (
                      <tr key={row.label}>
                        <th scope="row">{row.label}</th>
                        {plans.map((plan) => <td key={plan.code}>{row.get(plan)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        </section>
      )}

      <section className="lp-faq">
        <div className="lp-shell">
          <h2>Perguntas frequentes</h2>
          <div className="lp-faq__list">
            {FAQ.map((item) => (
              <details key={item.q} className="lp-details">
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-final">
        <div className="lp-shell lp-final__inner">
          <h2>Descubra quanto o no-show está te custando.</h2>
          <p>Em 7 dias você vê, no seu próprio relatório, o valor que cancelamentos e faltas levaram.</p>
          <div className="lp-final__actions">
            <button type="button" className="btn btn--primary btn--lg" onClick={onTrial}>
              Testar {trialDays} dias grátis
            </button>
            <button type="button" className="btn btn--outline btn--lg" onClick={onTalkSpecialist}>
              Falar com especialista
            </button>
          </div>
          <span className="lp-final__note">Sem cartão de crédito.</span>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-shell lp-footer__inner">
          <p>© 2026 Agendamentos Online · Todos os direitos reservados.</p>
          <p>
            <a href="mailto:contato@agenda0.com.br">contato@agenda0.com.br</a>
          </p>
          <p>
            <Link to="/termos">Termos de Uso</Link> · <Link to="/politica-privacidade">Política de Privacidade</Link>
          </p>
        </div>
      </footer>
    </>
  );
}
