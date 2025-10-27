// src/pages/Ajuda.jsx
import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getUser } from '../utils/auth';

const SUPPORT_CHANNELS = [
  {
    key: 'whatsapp',
    title: 'WhatsApp',
    description: 'Atendimento em dias úteis das 9h às 18h. Informe CNPJ ou e-mail de login para agilizar a conversa.',
    href: 'https://wa.me/5511959929380?text=Olá%20Time%20Agendamentos%20Online%20Preciso%20de%20ajuda%20com%20o%20painel',
    action: 'Abrir conversa',
    external: true,
  },
  {
    key: 'email',
    title: 'E-mail',
    description: 'Respostas em até um dia útil. Ideal para dúvidas sobre acesso e cobranças.',
    href: 'mailto:servicos.negocios.digital@gmail.com?subject=Suporte%20Agendamentos%20Online',
    action: 'Enviar e-mail',
    external: false,
  },
  {
    key: 'demo',
    title: 'Agendar conversa guiada',
    description: 'Reserve um horário com especialista para revisar configurações e melhores práticas.',
    href: 'https://cal.com/agendamentos-online/demo',
    action: 'Reservar horário',
    external: true,
  },
];

function QuickActionCard({ action, onSelect }) {
  const handleClick = () => onSelect(action);

  return (
    <button type="button" className="help-quick__card" onClick={handleClick}>
      <strong>{action.title}</strong>
      <p>{action.description}</p>
      <span className="help-quick__cta">{action.cta || 'Abrir'}</span>
    </button>
  );
}

function ResourceLink({ item, onSelect }) {
  const handleClick = () => onSelect(item);

  return (
    <button type="button" className="help-resource" onClick={handleClick}>
      <span className="help-resource__label">{item.label}</span>
      <span className="help-resource__description">{item.description}</span>
      <span className="help-resource__cta">{item.cta || 'Abrir'}</span>
    </button>
  );
}

function SupportChannel({ channel }) {
  return (
    <article className="help-support__card">
      <strong>{channel.title}</strong>
      <p>{channel.description}</p>
      <a
        className="btn btn--sm btn--outline"
        href={channel.href}
        target={channel.external ? '_blank' : undefined}
        rel={channel.external ? 'noreferrer' : undefined}
      >
        {channel.action}
      </a>
    </article>
  );
}

export default function Ajuda() {
  const user = getUser();
  const navigate = useNavigate();
  const isEstab = (user?.tipo || '').toLowerCase() === 'estabelecimento';

  const quickActions = useMemo(() => {
    const items = [
      {
        key: 'profile',
        title: isEstab ? 'Atualizar cadastro da empresa' : 'Atualizar dados pessoais',
        description: isEstab
          ? 'Edite razão social, telefone principal e senha em Perfil e Segurança.'
          : 'Revise nome, e-mail e senha para continuar recebendo notificações.',
        section: 'profile',
        cta: 'Abrir perfil',
      },
    ];
    if (isEstab) {
      items.push(
        {
          key: 'public-profile',
          title: 'Configurar vitrine e horários',
          description: 'Defina texto de apresentação, contatos e disponibilidade para clientes.',
          section: 'public-profile',
          cta: 'Editar vitrine',
        },
        {
          key: 'plan',
          title: 'Gerenciar plano e cobranças',
          description: 'Acompanhe faturas, gere PIX e ajuste recorrência quando necessário.',
          section: 'plan',
          cta: 'Abrir painel financeiro',
        },
      );
    }
    items.push({
      key: 'support',
      title: 'Preciso de ajuda humana',
      description: 'Abra um chamado direto com o time via e-mail ou WhatsApp.',
      to: '/contato',
      cta: 'Abrir contato',
    });
    return items;
  }, [isEstab]);

  const getStartedSteps = useMemo(() => {
    if (isEstab) {
      return [
        'Revise dados fiscais, telefone e senha em Configurações > Perfil e Segurança.',
        'Preencha a vitrine pública com descrição, contatos e link para redes sociais.',
        'Habilite dias e horários na grade de funcionamento para liberar a agenda.',
        'Compartilhe o link público com clientes e acompanhe agendamentos no painel.',
      ];
    }
    return [
      'Confirme nome, e-mail e telefone em Configurações > Perfil e Segurança.',
      'Use o painel do cliente para acompanhar próximos atendimentos e notificações.',
      'Acesse Novo agendamento para buscar estabelecimentos e reservar um horário.',
    ];
  }, [isEstab]);

  const resourceLinks = useMemo(() => {
    if (isEstab) {
      return [
        {
          key: 'services',
          label: 'Cadastrar serviços e duração',
          description: 'Defina valores, tempo e categoria de cada atendimento.',
          to: '/servicos',
          cta: 'Abrir serviços',
        },
        {
          key: 'professionals',
          label: 'Adicionar profissionais ao time',
          description: 'Vincule quem atende cada serviço para controlar agendas.',
          to: '/profissionais',
          cta: 'Gerenciar equipe',
        },
        {
          key: 'reports',
          label: 'Acompanhar resultados no relatório',
          description: 'Veja confirmações, cancelamentos e faturamento por período.',
          to: '/relatorios',
          cta: 'Ver relatório',
        },
      ];
    }
    return [
      {
        key: 'dashboard',
        label: 'Painel do cliente',
        description: 'Confira status dos seus agendamentos e confirme presença.',
        to: '/cliente',
        cta: 'Abrir painel',
      },
      {
        key: 'new',
        label: 'Fazer um novo agendamento',
        description: 'Busque estabelecimentos e finalize o agendamento em poucos passos.',
        to: '/novo',
        cta: 'Iniciar agendamento',
      },
      {
        key: 'plans',
        label: 'Indicar a plataforma',
        description: 'Mostre os planos disponíveis para um parceiro ou gestor interessado.',
        to: '/planos',
        cta: 'Ver planos',
      },
    ];
  }, [isEstab]);

  const faqItems = useMemo(() => {
    if (isEstab) {
      return [
        {
          question: 'Como gerar o link público do meu estabelecimento?',
          answer:
            'Em Configurações > Perfil público, salve as informações e copie o link exibido no topo da página. Compartilhe com clientes por WhatsApp, site ou redes sociais.',
        },
        {
          question: 'Posso bloquear dias específicos ou feriados?',
          answer:
            'Sim. Desative o dia desejado na grade de funcionamento ou ajuste o horário para deixar sem vagas. Para bloqueios pontuais, use a agenda do estabelecimento para criar eventos internos.',
        },
        {
          question: 'Quais formas de pagamento posso usar para o plano?',
          answer:
            'No card Plano do Estabelecimento há opções de checkout via cartão e PIX. Também é possível ativar recorrência automática pelo cartão diretamente no mesmo local.',
        },
        {
          question: 'Como defino quem recebe notificações de agendamento?',
          answer:
            'Ainda em Perfil e Segurança, habilite ou desabilite os campos de alerta por e-mail e WhatsApp. Use um telefone válido com DDD para garantir o envio.',
        },
        {
          question: 'O que acontece se eu mudar de plano antes do fim do ciclo?',
          answer:
            'Upgrades liberam recursos imediatamente e o novo valor é cobrado no próximo ciclo. Downgrades entram em vigor ao final do período atual, desde que você respeite os limites do plano escolhido.',
        },
      ];
    }
    return [
      {
        question: 'Como reagendar ou cancelar um atendimento?',
        answer:
          'Acesse o painel do cliente e abra o agendamento desejado. Use as opções de reagendar ou cancelar seguindo as políticas do estabelecimento escolhido.',
      },
      {
        question: 'Não recebi e-mail de confirmação. É normal?',
        answer:
          'Verifique a caixa de spam e confirme se o e-mail cadastrado em Configurações > Perfil e Segurança está correto. Você também pode checar o status direto no painel.',
      },
      {
        question: 'Posso compartilhar o link do meu agendamento?',
        answer:
          'Sim. No painel do cliente, abra o agendamento confirmado e use o botão de compartilhar para enviar pelo WhatsApp ou copiar o link.',
      },
      {
        question: 'Esqueci minha senha. Como recuperar?',
        answer:
          'Clique em Esqueci minha senha na tela de login e informe o e-mail cadastrado. Você receberá um link temporário para criar uma nova senha.',
      },
    ];
  }, [isEstab]);

  const handleSelect = (item) => {
    if (!item) return;
    if (item.section) {
      navigate('/configuracoes', { state: { focusSection: item.section } });
      return;
    }
    if (item.to) {
      navigate(item.to);
      return;
    }
    if (item.href && typeof window !== 'undefined') {
      const target = item.target || (item.external ? '_blank' : '_self');
      const features = item.external ? 'noopener' : undefined;
      window.open(item.href, target, features);
    }
  };

  return (
    <div className="help-page">
      <section className="card help-hero">
        <header>
          <span className="tag tag--accent">Central de apoio</span>
          <h2>Ajuda e recursos para tirar proveito das configurações</h2>
        </header>
        <p className="muted">
          Explore atalhos, artigos e canais de suporte para resolver dúvidas sobre o painel de agendamentos online.
        </p>
        <div className="help-hero__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/contato')}>
            Falar com atendimento
          </button>
          <Link className="btn btn--outline btn--sm" to="/ajuda#faq">
            Ir para FAQ
          </Link>
          <a
            className="btn btn--ghost btn--sm"
            href="https://wa.me/5511959929380?text=Olá%20Time%20Agendamentos%20Online%20Preciso%20de%20ajuda%20com%20o%20painel"
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp suporte
          </a>
        </div>
      </section>

      <section className="card help-quick">
        <header className="help-section__header">
          <h3>Ações rápidas</h3>
          <p className="muted">Abra direto as configurações mais usadas.</p>
        </header>
        <div className="help-quick__grid">
          {quickActions.map((action) => (
            <QuickActionCard key={action.key} action={action} onSelect={handleSelect} />
          ))}
        </div>
      </section>

      <section className="card help-guides">
        <header className="help-section__header">
          <h3>Checklist de ativação</h3>
          <p className="muted">Siga os passos para colocar sua conta em produção rapidamente.</p>
        </header>
        <ol className="help-steps__list">
          {getStartedSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <div className="help-guides__links">
          {resourceLinks.map((item) => (
            <ResourceLink key={item.key} item={item} onSelect={handleSelect} />
          ))}
        </div>
      </section>

      <section id="faq" className="card help-faq">
        <header className="help-section__header">
          <h3>Perguntas frequentes</h3>
          <p className="muted">Respostas curtas para temas recorrentes da página de configurações.</p>
        </header>
        <div className="faq-grid">
          {faqItems.map((item) => (
            <details key={item.question} className="faq-item">
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="card help-support">
        <header className="help-section__header">
          <h3>Canais de suporte</h3>
          <p className="muted">Quando precisar falar com uma pessoa, escolha um dos canais abaixo.</p>
        </header>
        <div className="help-support__grid">
          {SUPPORT_CHANNELS.map((channel) => (
            <SupportChannel key={channel.key} channel={channel} />
          ))}
        </div>
      </section>
    </div>
  );
}