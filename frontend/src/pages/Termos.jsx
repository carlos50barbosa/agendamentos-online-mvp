// src/pages/Termos.jsx
import React, { useMemo } from 'react';
import { LEGAL_METADATA } from '../utils/legal.js';

const sections = [
  {
    id: 'escopo',
    title: '1. Sobre a plataforma',
    paragraphs: [
      'O Agendamentos Online é uma solução digital que conecta estabelecimentos de serviços e seus clientes para criação, gestão e acompanhamento de agendamentos.',
      'Estes Termos de Uso estabelecem as regras para utilização do site, aplicativos e demais recursos operados pela plataforma.',
      'Ao criar uma conta ou utilizar qualquer funcionalidade, você concorda integralmente com estes Termos.',
    ],
  },
  {
    id: 'definicoes',
    title: '2. Definições',
    paragraphs: [
      '"Plataforma" refere-se ao site e demais serviços digitais do Agendamentos Online.',
      '"Usuário" é qualquer pessoa que cria conta, acessa ou interage com a Plataforma, incluindo estabelecimentos e clientes.',
      '"Estabelecimento" é o usuário pessoa jurídica ou empreendedor responsável por ofertar serviços agendáveis.',
      '"Cliente" é o usuário que contrata ou agenda serviços oferecidos pelos Estabelecimentos.',
      '"Conta" é o perfil criado na Plataforma para acesso autenticado.',
    ],
  },
  {
    id: 'elegibilidade',
    title: '3. Elegibilidade e cadastro',
    paragraphs: [
      'Para criar uma conta, você deve ter capacidade civil plena ou estar devidamente representado por responsável legal.',
      'Estabelecimentos devem manter dados cadastrais corretos e, quando aplicável, informar CNPJ ou outra forma de identificação profissional, responsabilizando-se pela veracidade das informações fornecidas.',
      'Ao concluir o cadastro, você declara que os dados informados são verdadeiros, completos e atualizados.',
    ],
  },
  {
    id: 'conta',
    title: '4. Segurança da conta',
    paragraphs: [
      'O login é pessoal e intransferível. Você deve manter a confidencialidade das credenciais e notificar a plataforma em caso de uso não autorizado.',
      'Atividades realizadas com as credenciais do usuário serão consideradas como executadas pelo próprio usuário.',
      'A plataforma pode adotar mecanismos adicionais de verificação, como autenticação por e-mail ou WhatsApp.',
    ],
  },
  {
    id: 'planos',
    title: '5. Planos, cobranças e cancelamentos',
    paragraphs: [
      'A plataforma disponibiliza testes temporários e planos pagos com recursos adicionais.',
      'Valores, prazos e formas de cobrança são apresentados no fluxo de contratação. Qualquer alteração será comunicada com antecedência razoável.',
      'O não pagamento pode implicar suspensão do acesso, restrição de funcionalidades ou cancelamento da assinatura.',
      'Cancelamentos podem ser realizados a qualquer tempo. Planos pagos seguem as regras informadas no momento da adesão.',
    ],
  },
  {
    id: 'uso',
    title: '6. Uso aceitável',
    paragraphs: [
      'É proibido utilizar a plataforma para publicar conteúdo ilegal, ofensivo, discriminatório ou que infrinja direitos de terceiros.',
      'O usuário compromete-se a utilizar o sistema respeitando a legislação brasileira, inclusive normas de proteção de dados e direitos do consumidor.',
      'É vedado tentar violar mecanismos de segurança, copiar funcionalidades de forma indevida ou explorar vulnerabilidades.',
    ],
  },
  {
    id: 'estabelecimentos',
    title: '7. Obrigações dos estabelecimentos',
    paragraphs: [
      'Definir e manter atualizadas as informações sobre serviços, preços, duração, políticas de cancelamento e canais de contato.',
      'Responder aos clientes em prazo razoável e prestar o serviço contratado seguindo as condições divulgadas.',
      'Garantir que possui licenças, autorizações e qualificações necessárias para prestar os serviços anunciados.',
      'Assumir responsabilidade pelas interações e transações realizadas com clientes fora da plataforma de pagamentos da ferramenta.',
    ],
  },
  {
    id: 'clientes',
    title: '8. Obrigações dos clientes',
    paragraphs: [
      'Fornecer dados pessoais verdadeiros e manter canais de contato atualizados para receber notificações sobre os agendamentos.',
      'Respeitar políticas de cancelamento, reagendamento e comparecer aos horários confirmados.',
      'Utilizar a plataforma de forma diligente, não compartilhando informações sensíveis de terceiros sem consentimento.',
    ],
  },
  {
    id: 'agendamentos',
    title: '9. Gestão de agendamentos e comunicações',
    paragraphs: [
      'A plataforma disponibiliza ferramentas de notificação por e-mail e/ou WhatsApp. O envio depende da infraestrutura do provedor e dos dados fornecidos pelo usuário.',
      'Mensagens automáticas podem incluir lembretes, confirmações e atualizações de status.',
      'O estabelecimento pode ajustar as preferências de notificação nas configurações da conta, respeitando limites técnicos e obrigações legais.',
    ],
  },
  {
    id: 'propriedade',
    title: '10. Propriedade intelectual',
    paragraphs: [
      'Todos os direitos sobre marca, layout, código, textos, fluxos e demais elementos da plataforma pertencem ao Agendamentos Online.',
      'É vedado copiar, modificar, distribuir ou comercializar qualquer parte da plataforma sem autorização formal.',
      'Conteúdos enviados pelos usuários permanecem de sua titularidade, mas o usuário concede licença para uso necessário à execução das funcionalidades.',
    ],
  },
  {
    id: 'dados',
    title: '11. Privacidade e proteção de dados',
    paragraphs: [
      'O tratamento de dados pessoais segue a Política de Privacidade e a legislação aplicável, em especial a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018).',
      'Ao aceitar estes Termos, você também concorda com as práticas de tratamento descritas na Política de Privacidade.',
    ],
  },
  {
    id: 'suporte',
    title: '12. Suporte e canais de contato',
    paragraphs: [
      'O suporte é prestado por canais oficiais indicados na página de Ajuda e pode variar conforme o plano contratado.',
      'Demandas técnicas ou comerciais serão respondidas em prazo razoável, observando os horários de atendimento publicados.',
    ],
  },
  {
    id: 'suspensao',
    title: '13. Suspensão e encerramento',
    paragraphs: [
      'A plataforma pode suspender ou encerrar contas em caso de violação dos Termos, uso irregular, risco a terceiros ou ordem de autoridade competente.',
      'O usuário pode solicitar o encerramento da conta a qualquer momento. Alguns dados poderão ser mantidos para cumprimento de obrigações legais.',
    ],
  },
  {
    id: 'responsabilidade',
    title: '14. Limitação de responsabilidade',
    paragraphs: [
      'A plataforma atua como facilitadora de agendamentos entre estabelecimentos e clientes, não sendo responsável pela execução dos serviços ofertados.',
      'Exceto quando houver dolo ou culpa comprovada, a plataforma não responde por lucros cessantes, danos indiretos ou prejuízos decorrentes de indisponibilidade temporária do sistema.',
      'Caso alguma funcionalidade seja prestada por terceiros, aplicam-se também os termos e políticas do respectivo parceiro.',
    ],
  },
  {
    id: 'atualizacoes',
    title: '15. Atualizações destes Termos',
    paragraphs: [
      'Os Termos podem ser atualizados para refletir a evolução da plataforma, exigências legais ou melhorias de processos.',
      'Mudanças relevantes serão comunicadas por e-mail, notificações no aplicativo ou banner informativo. O uso contínuo após a publicação implica concordância.',
      'Caso o usuário não concorde com as novas condições, deve interromper o uso e solicitar o encerramento da conta.',
    ],
  },
  {
    id: 'lei',
    title: '16. Lei aplicável e foro',
    paragraphs: [
      'Estes Termos são regidos pela legislação brasileira.',
      'Quaisquer controvérsias serão submetidas ao foro da comarca de São Paulo, Estado de São Paulo, salvo disposição legal cogente em sentido diverso.',
    ],
  },
];

export default function Termos() {
  const meta = useMemo(() => LEGAL_METADATA.terms, []);
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
          Leia com atenção as condições abaixo. Caso não concorde com algum ponto, interrompa o uso da plataforma e entre
          em contato pelos canais oficiais.
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
        <h2>17. Contato</h2>
        <p>
          Em caso de dúvidas sobre estes Termos, escreva para{' '}
          <a href="mailto:servicos.negocios.digital@gmail.com">servicos.negocios.digital@gmail.com</a>.
        </p>
      </section>
    </div>
  );
}
