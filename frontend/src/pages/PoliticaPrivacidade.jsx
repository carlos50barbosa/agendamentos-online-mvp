// src/pages/PoliticaPrivacidade.jsx
import React, { useMemo } from 'react';
import { LEGAL_METADATA } from '../utils/legal.js';

const sections = [
  {
    id: 'introducao',
    title: '1. Introdução',
    paragraphs: [
      'A presente Política de Privacidade descreve como o Agendamentos Online trata dados pessoais coletados por meio do site, aplicativos, integrações e demais recursos da plataforma.',
      'Nós nos comprometemos a utilizar as informações de maneira transparente e em conformidade com a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018) e demais normas aplicáveis.',
    ],
  },
  {
    id: 'controlador',
    title: '2. Controlador dos dados',
    paragraphs: [
      'O controlador das informações é a AGENDAMENTOS ONLINE TECNOLOGIA LTDA., inscrita no CNPJ 12.345.678/0001-99, com sede na cidade de São Paulo/SP.',
      'Dúvidas, solicitações ou exercício de direitos podem ser encaminhados para servicos.negocios.digital@gmail.com.',
    ],
  },
  {
    id: 'dados-coletados',
    title: '3. Dados coletados',
    paragraphs: [
      'Informações de cadastro: nome, e-mail, telefone, senha, tipo de conta, dados de endereço do estabelecimento e outras informações fornecidas pelo usuário.',
      'Dados de agendamentos: serviços selecionados, datas, horários, profissionais envolvidos, status das solicitações e mensagens trocadas.',
      'Dados de suporte: interações por e-mail, WhatsApp ou formulários que contenham dúvidas, feedbacks ou anexos.',
      'Dados técnicos: logs de acesso, identificadores de dispositivo, navegador, sistema operacional, endereço IP, cookies e métricas de uso.',
    ],
  },
  {
    id: 'bases-legais',
    title: '4. Bases legais e finalidades',
    paragraphs: [
      'Execução de contrato: criar e manter a conta do usuário, permitir agendamentos, enviar notificações e processar pagamentos.',
      'Cumprimento de obrigações legais: emitir notas, atender requisições de autoridades e registrar consentimentos.',
      'Interesse legítimo: melhorar funcionalidades, prevenir fraudes, garantir segurança da plataforma e promover novos recursos relevantes.',
      'Consentimento: envio de comunicações de marketing e uso de cookies não essenciais, quando aplicável.',
    ],
  },
  {
    id: 'uso-dos-dados',
    title: '5. Uso das informações',
    paragraphs: [
      'Gerenciar agendamentos entre estabelecimentos e clientes, incluindo confirmações, remarcações e cancelamentos.',
      'Personalizar a experiência de uso, sugerindo conteúdos ou configurações coerentes com o perfil do usuário.',
      'Monitorar a performance dos serviços e gerar relatórios consolidados para estabelecimentos.',
      'Enviar alertas, mensagens transacionais e comunicações sobre atualizações relevantes da plataforma.',
    ],
  },
  {
    id: 'compartilhamento',
    title: '6. Compartilhamento de dados',
    paragraphs: [
      'Estabelecimentos e clientes trocam informações entre si apenas quando necessário para a prestação do serviço.',
      'Prestadores de serviços terceirizados podem tratar dados em nome da plataforma (ex.: hospedagem, ferramentas de e-mail, gateways de pagamento), sempre sujeitos a obrigações contratuais de confidencialidade e segurança.',
      'Autoridades públicas podem ter acesso aos dados mediante ordem legal ou requisição administrativa válida.',
      'Não comercializamos dados pessoais.',
    ],
  },
  {
    id: 'armazenamento',
    title: '7. Armazenamento e segurança',
    paragraphs: [
      'Adotamos medidas técnicas e administrativas razoáveis para proteger os dados contra acessos não autorizados, perda, alteração ou destruição.',
      'O acesso interno é restrito a profissionais que necessitam das informações para executar suas atividades, seguindo políticas de sigilo.',
      'Apesar dos esforços, nenhum sistema é totalmente imune a incidentes. Em caso de violação relevante, notificaremos os usuários e autoridades, quando exigido.',
    ],
  },
  {
    id: 'direitos',
    title: '8. Direitos dos titulares',
    paragraphs: [
      'Confirmar se realizamos o tratamento de seus dados.',
      'Acessar, corrigir, atualizar ou solicitar a portabilidade das informações.',
      'Solicitar o anonimato, bloqueio ou eliminação quando os dados forem desnecessários, excessivos ou tratados em desconformidade.',
      'Revogar consentimento e se opor ao tratamento realizado com base em interesse legítimo, observado o impacto na prestação dos serviços.',
      'Apresentar reclamação junto à Autoridade Nacional de Proteção de Dados (ANPD).',
    ],
  },
  {
    id: 'cookies',
    title: '9. Cookies e tecnologias semelhantes',
    paragraphs: [
      'Utilizamos cookies essenciais para garantir funcionalidades básicas do site e cookies de desempenho para entender como os usuários interagem com a plataforma.',
      'Cookies não essenciais são armazenados somente mediante consentimento, quando aplicável. O usuário pode ajustar preferências no navegador, sabendo que isso pode limitar recursos.',
    ],
  },
  {
    id: 'comunicacao',
    title: '10. Comunicações',
    paragraphs: [
      'Podemos enviar e-mails, notificações push ou mensagens via WhatsApp para confirmar agendamentos, informar atualizações ou responder solicitações de suporte.',
      'Mensagens promocionais são enviadas apenas mediante consentimento. O usuário pode cancelar o recebimento a qualquer momento pelos canais indicados na comunicação.',
    ],
  },
  {
    id: 'retencao',
    title: '11. Retenção e descarte',
    paragraphs: [
      'Os dados são mantidos enquanto a conta estiver ativa e pelo período necessário para cumprir obrigações legais, resolver disputas e garantir direitos.',
      'Após o prazo legal, os dados são eliminados ou anonimizados de forma segura.',
    ],
  },
  {
    id: 'transferencias',
    title: '12. Transferências internacionais',
    paragraphs: [
      'Serviços de terceiros podem armazenar ou processar dados fora do Brasil. Nesses casos, garantimos que haja contrato adequado ou que o país proporcione grau de proteção equivalente ao exigido pela legislação brasileira.',
    ],
  },
  {
    id: 'criancas',
    title: '13. Dados de menores',
    paragraphs: [
      'A plataforma não é direcionada a menores de 18 anos. Eventuais cadastros de menores devem ser realizados por responsável legal.',
      'Ao detectar informações sem autorização adequada, removeremos os dados conforme as normas aplicáveis.',
    ],
  },
  {
    id: 'atualizacoes',
    title: '14. Atualizações desta Política',
    paragraphs: [
      'Podemos atualizar este documento para refletir mudanças regulatórias, ajustes na oferta de serviços ou inclusão de novas funcionalidades.',
      'Manteremos a data da última revisão visível e comunicaremos alterações materiais pelos canais apropriados.',
      'O uso contínuo da plataforma após a publicação de nova versão implica concordância com os termos atualizados.',
    ],
  },
];

export default function PoliticaPrivacidade() {
  const meta = useMemo(() => LEGAL_METADATA.privacy, []);
  const dataExtenso = useMemo(() => {
    const hoje = new Date();
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(hoje);
  }, []);

  return (
    <div className="legal-page">
      <section className="card legal-hero">
        <h1>{meta.title}</h1>
        <p>Última atualização em {dataExtenso} (versão {meta.version}).</p>
        <p>
          Ao utilizar nossos serviços, você aceita as condições descritas nesta Política. Recomendamos a leitura atenta de
          cada seção.
        </p>
      </section>

      {sections.map((section) => (
        <section key={section.id} className="card legal-section" id={section.id}>
          <h2>{section.title}</h2>
          {section.paragraphs.map((text, index) => (
            <p key={index}>{text}</p>
          ))}
        </section>
      ))}

      <section className="card legal-section">
        <h2>15. Canal de contato</h2>
        <p>
          Para exercer direitos ou esclarecer dúvidas, envie e-mail para{' '}
          <a href="mailto:servicos.negocios.digital@gmail.com">servicos.negocios.digital@gmail.com</a>.
        </p>
      </section>
    </div>
  );
}
