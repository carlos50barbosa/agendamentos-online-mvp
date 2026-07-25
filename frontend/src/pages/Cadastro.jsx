

import React, { useState, useMemo, useEffect, useCallback } from 'react';

import { Link, useLocation, useNavigate } from 'react-router-dom';

import {
  IconBuilding,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconPhone,
  IconUser,
} from '../components/AuthIcons.jsx';
import LogoAO from '../components/LogoAO.jsx';

import { Api } from '../utils/api';

import { saveToken, saveUser } from '../utils/auth';

import { LEGAL_METADATA } from '../utils/legal.js';

import { WA_SENDER_NAME } from '../utils/whatsappConsent.js';
import { useWhatsAppAvailable } from '../hooks/useWhatsAppStatus.js';
// masks.js nasceu justamente extraindo estes helpers daqui ("Mesma lógica já usada em
// Cadastro.jsx, centralizada para reuso") — mas o Cadastro seguiu com as cópias locais. Agora usa a
// versão compartilhada, que é a mesma do booking e espelha lib/phone_br.js do backend.
import { formatBRPhone, normalizePhoneBR, isValidMobileBR, onlyLocalDigits } from '../utils/masks.js';

const normalizeUiText = (value = '') =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();



const formatCep = (value = '') => {

  const digits = value.replace(/\D/g, '').slice(0, 8);

  if (digits.length <= 5) return digits;

  return `${digits.slice(0, 5)}-${digits.slice(5)}`;

};



const formatCpfCnpj = (value = '') => {

  const digits = value.replace(/\D/g, '').slice(0, 14);

  if (digits.length <= 11) {

    if (digits.length <= 3) return digits;

    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;

    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;

    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;

  }

  if (digits.length <= 2) return digits;

  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;

  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;

  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;

  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;

};



export default function Cadastro() {

  const nav = useNavigate();

  const loc = useLocation();

  // Canal do WhatsApp no ar? Com ele fora (`WHATSAPP_UNAVAILABLE`), a caixa de aceite não aparece:
  // ela prometeria confirmação e lembretes por um canal que não envia, e quem marca fica esperando
  // uma mensagem que nunca chega. O aceite volta a ser pedido sozinho quando a env sair do .env.
  const waAvailable = useWhatsAppAvailable();

  const [form, setForm] = useState({

    nome: '',

    email: '',

    senha: '',

    tipo: 'estabelecimento',

    telefone: '',

    // Desmarcado por padrão — caixa pré-marcada não vale como consentimento.
    whatsappOptin: false,

    data_nascimento: '',

    cpf_cnpj: '',

    cep: '',

    endereco: '',

    numero: '',

    complemento: '',

    bairro: '',

    cidade: '',

    estado: '',

  });

  const [confirm, setConfirm] = useState('');

  const [showPass, setShowPass] = useState(false);

  const [showConfirm, setShowConfirm] = useState(false);

  const [err, setErr] = useState('');

  const [loading, setLoading] = useState(false);

  const [cepStatus, setCepStatus] = useState({ loading: false, error: '' });

  const [acceptPolicies, setAcceptPolicies] = useState(false);

  const [confirmEmail, setConfirmEmail] = useState('');

  const [successMsg, setSuccessMsg] = useState('');

  const [showOptionalFields, setShowOptionalFields] = useState(false);

  const [hasChosen, setHasChosen] = useState(true);

  const legalMeta = useMemo(() => LEGAL_METADATA, []);

  const tipoParam = useMemo(() => new URLSearchParams(loc.search).get('tipo') || '', [loc.search]);

  const trialPlanChoice = useMemo(() => {

    const rawPlan = new URLSearchParams(loc.search).get('trial_plan') || '';

    const normalized = String(rawPlan || '').trim().toLowerCase();

    return ['starter', 'pro'].includes(normalized) ? normalized : '';

  }, [loc.search]);

  const nextParam = useMemo(() => {
    const params = new URLSearchParams(loc.search);
    return params.get('next') || params.get('redirect') || '';
  }, [loc.search]);



  useEffect(() => {

    if (!trialPlanChoice) return;

    try {

      localStorage.removeItem('intent_kind');

      localStorage.removeItem('intent_plano');

      localStorage.removeItem('intent_plano_ciclo');

    } catch {}

  }, [trialPlanChoice]);



  const phoneDigits = (form.telefone || '').replace(/\D/g, '');

  const cepDigits = form.cep.replace(/\D/g, '');

  const isEstab = form.tipo === 'estabelecimento';

  const isCliente = form.tipo === 'cliente';

  const showForm = Boolean(form.tipo) && hasChosen;
  const emailFormatValid = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()), [form.email]);
  const confirmEmailMismatch = Boolean(
    confirmEmail && form.email && form.email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()
  );



  const senhaScore = useMemo(() => {

    const s = form.senha || '';

    let pts = 0;

    if (s.length >= 8) pts++;

    if (/[A-Z]/.test(s) && /[a-z]/.test(s)) pts++;

    if (/\d/.test(s) || /[^A-Za-z0-9]/.test(s)) pts++;

    return pts;

  }, [form.senha]);

  const senhaLabel = ['Fraca', 'Razoável', 'Boa', 'Forte'][senhaScore];



  const senhaOk = form.senha.length >= 8 && /[^A-Za-z0-9]/.test(form.senha);

  const matchOk = form.senha && confirm && form.senha === confirm;

  const nomeOk = form.nome.trim().length >= 2;



  // Só contar dígitos não serve aqui. O campo é o WhatsApp: aceitar um fixo ou um DDD que não
  // existe cria a conta e deixa a pessoa sem notificação PARA SEMPRE, em silêncio — o envio é
  // bloqueado lá na frente e ninguém avisa ninguém. `isValidMobileBR` é a mesma régua do backend
  // (masks.js espelha lib/phone_br.js) e barra só o impossível: fixo, DDD inexistente e 13 dígitos
  // cujo nono não é 9. Celular de 12 dígitos, sem o nono, continua passando — existe em produção.
  const phoneOk = useMemo(() => isValidMobileBR(form.telefone), [form.telefone]);

  // "Tem dígitos suficientes, mas não é um celular" merece uma dica diferente de "faltou digitar".
  const phoneCompleto = phoneDigits.length >= 10;



  const cpfCnpjDigits = useMemo(

    () => (form.cpf_cnpj || '').replace(/\D/g, '').slice(0, 14),

    [form.cpf_cnpj]

  );

  const cpfCnpjOk = !cpfCnpjDigits || cpfCnpjDigits.length === 11 || cpfCnpjDigits.length === 14;



  // Tudo que impede o envio, NA ORDEM EM QUE OS CAMPOS APARECEM NA TELA.
  //
  // Antes isto era um booleano só (`disabled`) que desligava o botão. Quem esquecia um campo via um
  // botão cinza e nenhuma explicação — e o `required` dos inputs nunca ajudava, porque a validação
  // nativa do navegador só roda quando o form é submetido, e ele nunca era. Um formulário de 14
  // campos que se recusa a dizer qual falta é um formulário abandonado.
  //
  // A lista alimenta três coisas de uma vez: o resumo do que falta, o destaque de cada campo e o
  // foco no primeiro pendente. A ordem importa — é ela que decide para onde a tela rola.
  const problemas = useMemo(() => {
    const lista = [];
    const add = (id, texto) => lista.push({ id, texto });

    if (!nomeOk) add('cadastro-nome', 'Nome: informe pelo menos 2 caracteres.');

    if (!form.email.trim()) add('cadastro-email', 'E-mail: campo obrigatório.');
    else if (!emailFormatValid) add('cadastro-email', 'E-mail: verifique o formato (exemplo@dominio.com).');
    else if (!confirmEmail.trim()) add('cadastro-email-confirm', 'Confirmar e-mail: repita o e-mail digitado.');
    else if (confirmEmailMismatch) add('cadastro-email-confirm', 'Confirmar e-mail: os dois e-mails não coincidem.');

    if (!phoneOk) {
      add(
        'cadastro-telefone',
        phoneDigits.length >= 10
          ? 'Telefone: precisa ser um celular com DDD válido (fixo não recebe WhatsApp).'
          : 'Telefone: informe o DDD e o número completo.'
      );
    }
    if (!senhaOk) add('cadastro-senha', 'Senha: use no mínimo 8 caracteres e 1 caractere especial.');
    if (!matchOk) add('cadastro-confirmar-senha', 'Confirmar senha: as senhas não coincidem.');
    if (!cpfCnpjOk) add('cadastro-cpf-cnpj', 'CPF/CNPJ: informe 11 dígitos (CPF) ou 14 (CNPJ).');

    if (isEstab) {
      if (cepDigits.length !== 8) add('cadastro-cep', 'CEP: informe os 8 dígitos.');
      if (!form.endereco.trim()) add('cadastro-endereco', 'Endereço: campo obrigatório.');
      if (!form.numero.trim()) add('cadastro-numero', 'Número: campo obrigatório.');
      if (!form.bairro.trim()) add('cadastro-bairro', 'Bairro: campo obrigatório.');
      if (!form.cidade.trim()) add('cadastro-cidade', 'Cidade: campo obrigatório.');
      if (!/^[A-Za-z]{2}$/.test(form.estado.trim())) add('cadastro-estado', 'Estado: informe a UF com 2 letras (ex.: SP).');
    }

    if (!form.tipo) add('cadastro-form', 'Escolha se a conta é de estabelecimento ou de cliente.');
    if (!acceptPolicies) add('cadastro-termos', 'É preciso aceitar os Termos de Uso e a Política de Privacidade.');

    return lista;
  }, [
    nomeOk, form.email, emailFormatValid, confirmEmail, confirmEmailMismatch, phoneOk,
    phoneDigits.length, senhaOk, matchOk, cpfCnpjOk, isEstab, cepDigits.length, form.endereco,
    form.numero, form.bairro, form.cidade, form.estado, form.tipo, acceptPolicies,
  ]);

  const podeEnviar = problemas.length === 0;

  // Só depois da PRIMEIRA tentativa os campos vazios ficam vermelhos. Gritar erro em campo que a
  // pessoa ainda nem visitou é hostil — ela abre a tela e já está tudo errado.
  const [tentouEnviar, setTentouEnviar] = useState(false);

  const idsComProblema = useMemo(() => new Set(problemas.map((p) => p.id)), [problemas]);

  const erroNoCampo = useCallback(
    (id) => tentouEnviar && idsComProblema.has(id),
    [tentouEnviar, idsComProblema]
  );



  useEffect(() => {

    if (form.tipo) return;

    const normalized = String(tipoParam || '').toLowerCase();

    if (!normalized) return;

    if (normalized === 'cliente') {

      setForm((prev) => ({ ...prev, tipo: 'cliente' }));
      setHasChosen(true);

      return;

    }

    if (['estab', 'estabelecimento', 'empresa', 'business'].includes(normalized)) {

      setForm((prev) => ({ ...prev, tipo: 'estabelecimento' }));
      setHasChosen(true);

    }

  }, [tipoParam, form.tipo]);



  useEffect(() => {

    if (!form.tipo) setHasChosen(false);

  }, [form.tipo]);



  useEffect(() => {

    if (!isCliente) {

      setShowOptionalFields(false);

    }

  }, [isCliente]);



  useEffect(() => {

    const digits = cepDigits;

    if (digits.length !== 8) {

      setCepStatus({ loading: false, error: '' });

      return;

    }



    let active = true;

    setCepStatus({ loading: true, error: '' });



    fetch(`https://viacep.com.br/ws/${digits}/json/`)

      .then((res) => res.json())

      .then((data) => {

        if (!active) return;

        if (!data || data.erro) {

        setCepStatus({ loading: false, error: 'Não foi possível buscar o CEP.' });

          return;

        }

        setForm((prev) => ({

          ...prev,

          cep: formatCep(digits),

          endereco: data.logradouro || prev.endereco,

          bairro: data.bairro || prev.bairro,

          cidade: data.localidade || prev.cidade,

          estado: (data.uf || prev.estado || '').toUpperCase(),

        }));

        setCepStatus({ loading: false, error: '' });

      })

      .catch(() => {

        if (!active) return;

        setCepStatus({ loading: false, error: 'Não foi possível buscar o CEP.' });

      });



    return () => {

      active = false;

    };

  }, [cepDigits]);



  const updateField = useCallback((key, value) => {

    setForm((prev) => ({ ...prev, [key]: value }));

  }, []);



  const handleTipoSelect = useCallback((value) => {

    if (!value) return;

    updateField('tipo', value);

    setHasChosen(true);

    setErr('');

    setSuccessMsg('');

    if (typeof window === 'undefined') return;

    setTimeout(() => {

      try {

        const target = document.getElementById('cadastro-nome') || document.getElementById('cadastro-form');

        if (!target) return;

        const rect = target.getBoundingClientRect();

        const y = rect.top + window.scrollY - 80;

        window.scrollTo({ top: y, behavior: 'smooth' });

        setTimeout(() => target.focus?.(), 300);

      } catch {}

    }, 120);

  }, [updateField]);



  // Leva a tela até o primeiro pendente. Sem isto, o resumo de erros no topo obrigaria a pessoa a
  // caçar o campo sozinha num formulário que não cabe em uma tela de celular.
  const focarPrimeiroProblema = useCallback((lista) => {

    if (typeof window === 'undefined') return;

    const alvo = document.getElementById(lista?.[0]?.id || '');

    if (!alvo) return;

    try {

      const y = alvo.getBoundingClientRect().top + window.scrollY - 100;

      window.scrollTo({ top: y, behavior: 'smooth' });

      // O foco vem DEPOIS da rolagem e com `preventScroll`: focar antes faz o navegador dar o pulo
      // seco que a rolagem suave estava justamente evitando.
      setTimeout(() => {

        try { alvo.focus({ preventScroll: true }); } catch { alvo.focus?.(); }

      }, 320);

    } catch {}

  }, []);



  const submit = async (event) => {

    event.preventDefault();

    setErr('');

    setSuccessMsg('');

    if (loading) return;

    // Faltou coisa: em vez de não fazer nada, diz o que falta, pinta os campos e leva a pessoa até
    // o primeiro deles. O botão continua clicável de propósito — clicar e ser respondido é o que
    // transforma "não funciona" em "ah, é o CEP".
    if (problemas.length) {
      setTentouEnviar(true);
      focarPrimeiroProblema(problemas);
      return;
    }

    setLoading(true);

    try {

      const telefoneNorm = normalizePhoneBR(form.telefone.trim());

      const cpfCnpjValue = cpfCnpjDigits || undefined;

      const acceptanceTimestamp = new Date().toISOString();

      const payload = {

        nome: form.nome.trim(),

        email: form.email.trim(),

        senha: form.senha,

        tipo: form.tipo,

        telefone: telefoneNorm,

        // Sem isto o backend não envia WhatsApp nenhum a este número. O `waAvailable` fecha a
        // brecha da corrida: `/public/config` responde depois do primeiro render (o padrão é
        // otimista), então dá para marcar a caixa no instante em que ela ainda está visível.
        whatsapp_optin: form.whatsappOptin === true && waAvailable,

        data_nascimento: form.data_nascimento || undefined,

        cpf_cnpj: cpfCnpjValue,

        cep: cepDigits || undefined,

        endereco: form.endereco.trim() || undefined,

        numero: form.numero.trim() || undefined,

        complemento: form.complemento.trim() || undefined,

        bairro: form.bairro.trim() || undefined,

        cidade: form.cidade.trim() || undefined,

        estado: form.estado.trim().toUpperCase() || undefined,

        termsVersion: legalMeta.terms?.version,

        privacyVersion: legalMeta.privacy?.version,

        termsAcceptedAt: acceptanceTimestamp,

        privacyAcceptedAt: acceptanceTimestamp,

        dataProcessingConsent: true,

      };

      if (isEstab && trialPlanChoice) {

        payload.trial_plan = trialPlanChoice;

      }

      const { token, user } = await Api.register(payload);

      saveToken(token);

      saveUser(user);

      setSuccessMsg('Cadastro realizado com sucesso! Redirecionando...');

      try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}

      const onboardingPending = user?.tipo === 'estabelecimento' && !user?.onboarding_concluido;
      const fallback = user?.tipo === 'cliente' ? '/cliente' : '/estab';

      const destination = onboardingPending ? '/configuracao-inicial' : (nextParam || fallback);

      setTimeout(() => nav(destination), 1200);

    } catch (e) {

      const message = e?.message || '';

      const normalizedMessage = normalizeUiText(message);
      const friendly =

        message === 'email_exists'

           ? 'Este e-mail já está cadastrado.'

          : message === 'telefone_obrigatorio'

           ? 'Informe um telefone válido com DDD.'

          : normalizedMessage.includes('endereco')

           ? 'Verifique os campos de endereço.'

          : 'Falha ao criar conta. Tente novamente.';

      setErr(friendly);

    } finally {

      setLoading(false);

    }

  };

  const ProfileGlyph = ({ isCliente = false }) => (
    isCliente ? <IconUser /> : <IconBuilding />
  );



  return (

    <div className="login-preview auth-portal auth-portal--signup">

      <div className="login-preview__bg" aria-hidden="true" />

      <div className="login-preview__pattern" aria-hidden="true" />

      <main className="login-preview__main">

        <section className="login-preview__card">

          <div className="ao-login">
            <div className="ao-login__hero">
              <span className="ao-login__glow" aria-hidden="true" />
              <span className="ao-login__logo"><LogoAO size={44} /></span>
              <p className="ao-login__brand">Agendamentos Online</p>
              <h1 className="ao-login__hi">Criar sua <span>conta</span></h1>
              <p className="ao-login__tag">Agende, receba e organize — em minutos.</p>
            </div>

            <div className="ao-login__sheet">
              <span className="ao-login__handle" aria-hidden="true" />



              {successMsg ? (

                <div className="login-preview__alert login-preview__alert--success" role="status">

                  <span className="login-preview__alert-dot" aria-hidden="true" />

                  <div>

                    <div className="login-preview__alert-title">Conta criada</div>

                    <div className="login-preview__alert-text">{successMsg}</div>

                  </div>

                </div>

              ) : null}



              {err ? (

                <div className="login-preview__alert login-preview__alert--error" role="alert">

                  <span className="login-preview__alert-dot" aria-hidden="true" />

                  <div>

                    <div className="login-preview__alert-title">Erro no cadastro</div>

                    <div className="login-preview__alert-text">{err}</div>

                  </div>

                </div>

              ) : null}

              {/* O que falta preencher. Renderiza direto de `problemas` em vez de guardar um texto
                  no estado: assim a lista encolhe sozinha conforme a pessoa corrige, e o aviso some
                  no instante em que o último item é resolvido — sem depender de clicar de novo. */}
              {tentouEnviar && problemas.length ? (

                <div id="cadastro-pendencias" className="login-preview__alert login-preview__alert--error" role="alert" aria-live="polite">

                  <span className="login-preview__alert-dot" aria-hidden="true" />

                  <div>

                    <div className="login-preview__alert-title">

                      {problemas.length === 1 ? 'Falta 1 campo' : `Faltam ${problemas.length} campos`}

                    </div>

                    <ul className="login-preview__alert-text" style={{ margin: '4px 0 0', paddingLeft: 16 }}>

                      {problemas.map((p) => (

                        <li key={p.id + p.texto}>

                          <button
                            type="button"
                            className="cadastro-problema"
                            onClick={() => focarPrimeiroProblema([p])}
                          >
                            {p.texto}
                          </button>

                        </li>

                      ))}

                    </ul>

                  </div>

                </div>

              ) : null}



              <div className="ao-login__seg" role="tablist" aria-label="Tipo de conta">
                <button
                  type="button"
                  role="tab"
                  aria-selected={form.tipo === 'estabelecimento'}
                  className={`ao-login__seg-opt${form.tipo === 'estabelecimento' ? ' is-active' : ''}`}
                  onClick={() => handleTipoSelect('estabelecimento')}
                >
                  <ProfileGlyph />
                  Estabelecimento
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={form.tipo === 'cliente'}
                  className={`ao-login__seg-opt${form.tipo === 'cliente' ? ' is-active' : ''}`}
                  onClick={() => handleTipoSelect('cliente')}
                >
                  <ProfileGlyph isCliente />
                  Cliente
                </button>
              </div>

              {showForm ? (

                <form id="cadastro-form" onSubmit={submit} className="login-preview__form">

  

                  <div className="login-preview__field">

                    <label className="login-preview__label" htmlFor="cadastro-nome">Nome</label>

                    <div className={`auth-portal__field-shell${(form.nome && !nomeOk) || erroNoCampo('cadastro-nome') ? ' is-error' : ''}`}>
                      {isEstab ? <IconBuilding className="auth-portal__field-icon" /> : <IconUser className="auth-portal__field-icon" />}
                      <input
                        className="login-preview__input auth-portal__input-control"
                        id="cadastro-nome"
                        placeholder="Seu nome ou Estabelecimento"
                        value={form.nome}
                        onChange={(e) => updateField('nome', e.target.value)}
                        required
                      />
                    </div>

                    {form.nome && !nomeOk ? (

                      <div className="login-preview__hint is-error">Informe um nome válido.</div>

                    ) : null}

                  </div>

  

                  <div className="login-preview__field">

                    <label className="login-preview__label" htmlFor="cadastro-email">E-mail</label>

                    <div className={`auth-portal__field-shell${(form.email && !emailFormatValid) || erroNoCampo('cadastro-email') ? ' is-error' : ''}`}>
                      <IconMail className="auth-portal__field-icon" />
                      <input
                        className="login-preview__input auth-portal__input-control"
                        id="cadastro-email"
                        type="email"
                        placeholder="voce@exemplo.com"
                        value={form.email}
                        onChange={(e) => updateField('email', e.target.value)}
                        autoComplete="email"
                        onPaste={(e) => e.preventDefault()}
                        required
                      />
                    </div>

                    <div className={`login-preview__hint${form.email && !emailFormatValid ? ' is-error' : ''}`}>

                      {form.email && !emailFormatValid

                         ? 'Informe um e-mail válido.'

                        : 'Use um e-mail válido para acesso.'}

                    </div>

                  </div>

  

                  <div className="login-preview__field">

                    <label className="login-preview__label" htmlFor="cadastro-email-confirm">Confirmar e-mail</label>

                    <div className={`auth-portal__field-shell${confirmEmailMismatch || erroNoCampo('cadastro-email-confirm') ? ' is-error' : ''}`}>
                      <IconMail className="auth-portal__field-icon" />
                      <input
                        className="login-preview__input auth-portal__input-control"
                        id="cadastro-email-confirm"
                        type="email"
                        placeholder="Repita seu e-mail"
                        value={confirmEmail}
                        onChange={(e) => setConfirmEmail(e.target.value)}
                        autoComplete="off"
                        onPaste={(e) => e.preventDefault()}
                        required
                      />
                    </div>

                    {confirmEmailMismatch ? (

                      <div className="login-preview__hint is-error">O e-mail precisa ser igual ao campo anterior.</div>

                    ) : (

                      <div className="login-preview__hint">Repita o mesmo e-mail.</div>

                    )}

                  </div>

  

                  <div className="login-preview__field">

                    <label className="login-preview__label" htmlFor="cadastro-telefone">Telefone WhatsApp</label>

                    <div className={`auth-portal__field-shell${(!phoneOk && phoneDigits) || erroNoCampo('cadastro-telefone') ? ' is-error' : ''}`}>
                      <IconPhone className="auth-portal__field-icon" />
                      <input
                        className="login-preview__input auth-portal__input-control"
                        id="cadastro-telefone"
                        type="tel"
                        inputMode="tel"
                        placeholder="WhatsApp com DDD (11) 99999-9999"
                        value={formatBRPhone(form.telefone)}
                        onChange={(e) => {
                          // Guarda sempre em DDD+número (o 55 do país entra só no envio). Guardar
                          // 13 dígitos crus, como antes, deixava o campo mostrar um número e
                          // validar outro quando alguém colava com o código do país.
                          updateField('telefone', onlyLocalDigits(e.target.value));
                        }}
                        autoComplete="tel"
                        required
                      />
                    </div>

                    <div className={`login-preview__hint${!phoneOk && phoneDigits ? ' is-error' : ''}`}>

                      {!phoneOk && phoneCompleto

                        ? 'Precisa ser um celular com DDD válido — fixo não recebe WhatsApp.'

                        : !phoneOk && phoneDigits

                         ? 'Digite todos os dígitos (DDD + número). Ex.: (11) 99999-9999'

                        : 'Usado para confirmar o agendamento.'}

                    </div>

                    {/* Opt-in do WhatsApp. Antes, a única menção ao canal era a dica acima — e uma
                        dica não é consentimento: a pessoa dava o telefone e passava a receber
                        mensagem de um remetente que nunca autorizou. Foi assim que a conta caiu.
                        A caixa nasce desmarcada e não trava o cadastro: quem não marcar recebe por
                        e-mail. */}
                    {waAvailable && (
                    <label className="cadastro-optin">
                      <input
                        type="checkbox"
                        checked={form.whatsappOptin === true}
                        onChange={(e) => updateField('whatsappOptin', e.target.checked)}
                      />
                      <span>
                        {/* O dono do salão recebe "novo agendamento"; o cliente, "seu agendamento
                            foi confirmado". Um texto só descreveria errado a metade das pessoas —
                            e o aceite passaria a cobrir algo diferente do que de fato chega. */}
                        {form.tipo === 'estabelecimento' ? (
                          <>
                            Quero receber no WhatsApp os avisos da minha agenda (novos agendamentos,
                            cancelamentos e lembretes), enviados por {WA_SENDER_NAME}. Sem promoções.
                            Para sair, respondo <b>PARAR</b>.
                          </>
                        ) : (
                          <>
                            Quero receber a confirmação e os lembretes dos meus agendamentos no WhatsApp,
                            enviados por {WA_SENDER_NAME}. Sem promoções. Para sair, respondo <b>PARAR</b>.
                          </>
                        )}
                      </span>
                    </label>
                    )}

                  </div>



                  <div className="login-preview__field">

                    <label className="login-preview__label" htmlFor="cadastro-senha">Senha</label>

                    <div className={`auth-portal__field-shell${(form.senha && !senhaOk) || erroNoCampo('cadastro-senha') ? ' is-error' : ''}`}>
                      <IconLock className="auth-portal__field-icon" />
                      <input
                        className="login-preview__input auth-portal__input-control"
                        id="cadastro-senha"
                        type={showPass ? 'text' : 'password'}
                        placeholder="********"
                        value={form.senha}
                        onChange={(e) => updateField('senha', e.target.value)}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="login-preview__toggle"
                        onClick={() => setShowPass((v) => !v)}
                        aria-pressed={showPass}
                        aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                        title={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                      >
                        {showPass ? <IconEyeOff /> : <IconEye />}
                      </button>
                    </div>

                    {form.senha ? (

                      <div className={`login-preview__hint strength strength--${senhaLabel?.toLowerCase() || 'fraca'}`}>

                        Força: {senhaLabel}

                      </div>

                    ) : (

                      <div className="login-preview__hint">Use no mínimo 8 caracteres e 1 especial.</div>

                    )}

                    {form.senha && !senhaOk ? (

                      <div className="login-preview__hint is-error">Use pelo menos 8 caracteres e 1 especial.</div>

                    ) : null}

                  </div>

  

                  <div className="login-preview__field">

                    <label className="login-preview__label" htmlFor="cadastro-confirmar-senha">Confirmar senha</label>

                    <div className={`auth-portal__field-shell${(confirm && !matchOk) || erroNoCampo('cadastro-confirmar-senha') ? ' is-error' : ''}`}>
                      <IconLock className="auth-portal__field-icon" />
                      <input
                        className="login-preview__input auth-portal__input-control"
                        id="cadastro-confirmar-senha"
                        type={showConfirm ? 'text' : 'password'}
                        placeholder="Repita a senha"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="login-preview__toggle"
                        onClick={() => setShowConfirm((v) => !v)}
                        aria-pressed={showConfirm}
                        aria-label={showConfirm ? 'Ocultar confirmação' : 'Mostrar confirmação'}
                        title={showConfirm ? 'Ocultar confirmação' : 'Mostrar confirmação'}
                      >
                        {showConfirm ? <IconEyeOff /> : <IconEye />}
                      </button>
                    </div>

                    {!!confirm && !matchOk ? (

                      <div className="login-preview__hint is-error">As senhas não coincidem.</div>

                    ) : null}

                  </div>

  

                  {isCliente && (

                    <div style={{ marginTop: 6 }}>

                      <button

                        type="button"

                        className="login-preview__ghost"

                        onClick={() => setShowOptionalFields((v) => !v)}

                        aria-expanded={showOptionalFields}

                        aria-controls="cadastro-campos-opcionais"

                      >

                        {showOptionalFields ? 'Ocultar campos opcionais' : 'Ver campos opcionais'}

                      </button>

                    </div>

                  )}

  

                  {(isEstab || (isCliente && showOptionalFields)) && (

                    <div className="login-preview__field-group" id="cadastro-campos-opcionais">

                      {isCliente && (

                        <div className="login-preview__field">

                          <label className="login-preview__label" htmlFor="cadastro-data-nascimento">Data de nascimento (opcional)</label>

                          <input

                            className="login-preview__input"

                            id="cadastro-data-nascimento"

                            type="date"

                            value={form.data_nascimento}

                            onChange={(e) => updateField("data_nascimento", e.target.value)}

                          />

                        </div>

                      )}

                      <div className="login-preview__field">

                        <label className="login-preview__label" htmlFor="cadastro-cpf-cnpj">CPF/CNPJ (opcional)</label>

                        <input

                          className={`login-preview__input${erroNoCampo('cadastro-cpf-cnpj') ? ' is-error' : ''}`}

                          id="cadastro-cpf-cnpj"

                          placeholder="000.000.000-00 ou 00.000.000/0000-00"

                          value={formatCpfCnpj(form.cpf_cnpj)}

                          onChange={(e) => updateField("cpf_cnpj", e.target.value.replace(/\D/g, '').slice(0, 14))}

                          inputMode="numeric"

                        />

                        <div className={`login-preview__hint${!cpfCnpjOk && cpfCnpjDigits ? ' is-error' : ''}`}>

                          {!cpfCnpjOk && cpfCnpjDigits

                             ? 'Informe 11 ou 14 digitos.'

                            : 'Opcional para identificacao fiscal.'}

                        </div>

                      </div>

                      <div className="login-preview__field">

                        <label className="login-preview__label" htmlFor="cadastro-cep">{isEstab ? "CEP" : "CEP (opcional)"}</label>

                        <input

                          className={`login-preview__input${erroNoCampo('cadastro-cep') ? ' is-error' : ''}`}

                          id="cadastro-cep"

                          placeholder="00000-000"

                          value={form.cep}

                          onChange={(e) => updateField("cep", formatCep(e.target.value))}

                          required={isEstab}

                          inputMode="numeric"

                        />

                        {cepStatus.error ? (

                          <div className="login-preview__hint is-error">{cepStatus.error}</div>

                        ) : null}

                      </div>

                      <div className="login-preview__field">

                        <label className="login-preview__label" htmlFor="cadastro-endereco">Endereço</label>

                        <input

                          className={`login-preview__input${erroNoCampo('cadastro-endereco') ? ' is-error' : ''}`}

                          id="cadastro-endereco"

                          value={form.endereco}

                          onChange={(e) => updateField("endereco", e.target.value)}

                          required={isEstab}

                        />

                      </div>

                      <div className="login-preview__field-row">

                        <div className="login-preview__field">

                          <label className="login-preview__label" htmlFor="cadastro-numero">Número</label>

                          <input

                            className={`login-preview__input${erroNoCampo('cadastro-numero') ? ' is-error' : ''}`}

                            id="cadastro-numero"

                            value={form.numero}

                            onChange={(e) => updateField("numero", e.target.value)}

                            required={isEstab}

                          />

                        </div>

                        <div className="login-preview__field">

                          <label className="login-preview__label" htmlFor="cadastro-complemento">Complemento</label>

                          <input

                            className="login-preview__input"

                            id="cadastro-complemento"

                            value={form.complemento}

                            onChange={(e) => updateField("complemento", e.target.value)}

                          />

                        </div>

                      </div>

                      <div className="login-preview__field">

                        <label className="login-preview__label" htmlFor="cadastro-bairro">Bairro</label>

                        <input

                          className={`login-preview__input${erroNoCampo('cadastro-bairro') ? ' is-error' : ''}`}

                          id="cadastro-bairro"

                          value={form.bairro}

                          onChange={(e) => updateField("bairro", e.target.value)}

                          required={isEstab}

                        />

                      </div>

                      <div className="login-preview__field-row">

                        <div className="login-preview__field">

                          <label className="login-preview__label" htmlFor="cadastro-cidade">Cidade</label>

                          <input

                            className={`login-preview__input${erroNoCampo('cadastro-cidade') ? ' is-error' : ''}`}

                            id="cadastro-cidade"

                            value={form.cidade}

                            onChange={(e) => updateField("cidade", e.target.value)}

                            required={isEstab}

                          />

                        </div>

                        <div className="login-preview__field login-preview__field--compact">

                          <label className="login-preview__label" htmlFor="cadastro-estado">Estado</label>

                          <input

                            className={`login-preview__input${erroNoCampo('cadastro-estado') ? ' is-error' : ''}`}

                            id="cadastro-estado"

                            value={form.estado}

                            onChange={(e) => updateField("estado", e.target.value.toUpperCase().slice(0, 2))}

                            required={isEstab}

                          />

                        </div>

                      </div>

                    </div>

                  )}

                  <label className={`terms-check${erroNoCampo('cadastro-termos') ? ' is-error' : ''}`}>

                    <input

                      id="cadastro-termos"

                      type="checkbox"

                      checked={acceptPolicies}

                      onChange={(e) => setAcceptPolicies(e.target.checked)}

                      required

                    />

                    <span>

                      Li e concordo com os <Link to="/termos" target="_blank" rel="noreferrer">Termos de Uso</Link> e com a{' '}

                      <Link to="/politica-privacidade" target="_blank" rel="noreferrer">Política de Privacidade</Link>.

                    </span>

                  </label>

                  <div className="auth-legal__version">

                    Versões vigentes: Termos {legalMeta.terms?.version} - Política {legalMeta.privacy?.version}

                  </div>

  

                  {/* Só o envio em curso desabilita — faltar campo NÃO desabilita mais. O botão
                      morto era a origem do problema: sem clique não há resposta, e sem resposta a
                      pessoa não tem como descobrir o que falta. */}
                  <button
                    type="submit"
                    className={`login-preview__submit${podeEnviar && !loading ? ' is-ready' : ''}`}
                    disabled={loading}
                    aria-describedby={tentouEnviar && problemas.length ? 'cadastro-pendencias' : undefined}
                  >

                    {loading ? (

                      <span className="login-preview__submit-content">

                        <span className="login-preview__spinner" aria-hidden="true" />

                        Criando...

                      </span>

                    ) : (

                      'Criar conta'

                    )}

                  </button>

  

                  <div className="login-preview__actions">

                    <Link to="/login" className="login-preview__ghost">

                      Já tenho conta

                    </Link>

                    <Link to="/" className="login-preview__ghost">

                      Voltar ao site

                    </Link>

                  </div>

  

                  <div className="login-preview__note">

                    Ao criar a conta, você concorda com os termos e políticas da plataforma.

                  </div>

                </form>

              ) : null}

            </div>

          </div>

        </section>

      </main>

    </div>

  );

}

