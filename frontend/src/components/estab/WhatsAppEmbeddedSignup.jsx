// src/components/estab/WhatsAppEmbeddedSignup.jsx
// Conexão em um clique com o WhatsApp Business (Embedded Signup da Meta).
//
// O fluxo tem DUAS metades que chegam por caminhos diferentes, e é por isso que ele parece
// complicado:
//
//   1. `FB.login` devolve, no callback, um `code` — que o backend troca pelo token do tenant.
//   2. O `session_info` (waba_id, phone_number_id) NÃO vem nesse callback. Ele chega por
//      `window.postMessage`, num evento `WA_EMBEDDED_SIGNUP` publicado pelo popup da Meta.
//
// As duas metades podem chegar fora de ordem. Por isso o session_info é guardado numa ref assim que
// aparece, e o exchange só dispara quando o `code` chega — usando o que estiver guardado. Esperar
// pelo postMessage antes de trocar o code seria travar o fluxo se ele não vier.
//
// O listener é registrado ANTES de abrir o popup: registrar depois é uma corrida perdida.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Api } from '../../utils/api';
import { LEGAL_METADATA } from '../../utils/legal.js';

const FB_ORIGINS = ['https://www.facebook.com', 'https://web.facebook.com'];
const SDK_SCRIPT_ID = 'facebook-jssdk';

/** Carrega o SDK uma vez por página. Resolve na hora se já estiver carregado. */
function loadFacebookSdk({ appId, apiVersion }) {
  if (typeof window === 'undefined') return Promise.reject(new Error('sem_window'));
  if (window.FB) return Promise.resolve(window.FB);

  return new Promise((resolve, reject) => {
    const finish = () => {
      try {
        window.FB.init({ appId, cookie: true, xfbml: false, version: apiVersion });
        resolve(window.FB);
      } catch (err) {
        reject(err);
      }
    };

    const existente = document.getElementById(SDK_SCRIPT_ID);
    if (existente) {
      // Script já está no DOM mas o SDK ainda não inicializou: espera o onload dele.
      existente.addEventListener('load', finish, { once: true });
      existente.addEventListener('error', () => reject(new Error('sdk_load_failed')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = SDK_SCRIPT_ID;
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onload = finish;
    script.onerror = () => reject(new Error('sdk_load_failed'));
    document.body.appendChild(script);
  });
}

export default function WhatsAppEmbeddedSignup({ onConnected, disabled = false }) {
  const [config, setConfig] = useState(null);
  const [carregandoConfig, setCarregandoConfig] = useState(true);
  const [conectando, setConectando] = useState(false);
  const [erro, setErro] = useState('');
  // Nasce DESMARCADA, pela mesma razão do opt-in de WhatsApp: caixa pré-marcada não é aceite.
  const [aceitou, setAceitou] = useState(false);
  const sessionInfoRef = useRef(null);
  const montadoRef = useRef(true);
  // Só recebe valor DEPOIS do nosso FB.init: `window.FB` pode existir com o SDK ainda não
  // inicializado, e nesse estado o FB.login falha.
  const sdkRef = useRef(null);

  useEffect(() => () => { montadoRef.current = false; }, []);

  // Sem config_id no servidor, a rota devolve 503 com available:false. Isso NÃO é erro: é o estado
  // enquanto a configuração de Facebook Login for Business não existe. Nesse caso não renderizamos
  // nada — oferecer um botão que quebra no clique é pior que não oferecer botão.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const resp = await Api.waEmbeddedSignupConfig();
        if (cancelado) return;
        setConfig(resp?.available && resp?.config ? resp.config : null);
      } catch {
        if (!cancelado) setConfig(null);
      } finally {
        if (!cancelado) setCarregandoConfig(false);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  // Ouve o session_info do popup. Fica montado o tempo todo (e não só durante o clique) porque o
  // evento pode chegar antes de o callback do FB.login rodar.
  useEffect(() => {
    function aoReceberMensagem(event) {
      if (!FB_ORIGINS.includes(event.origin)) return;
      let dados = event.data;
      if (typeof dados === 'string') {
        try { dados = JSON.parse(dados); } catch { return; }
      }
      if (dados?.type !== 'WA_EMBEDDED_SIGNUP') return;

      if (dados.event === 'FINISH' || dados.event === 'FINISH_ONLY_WABA') {
        sessionInfoRef.current = { event: dados.event, ...(dados.data || {}) };
        return;
      }
      // CANCEL e ERROR: a pessoa desistiu ou a Meta recusou. Guardamos para o exchange não sair com
      // dados pela metade, e mostramos o motivo.
      if (dados.event === 'CANCEL' || dados.event === 'ERROR') {
        sessionInfoRef.current = null;
        if (montadoRef.current) {
          setConectando(false);
          setErro(dados.event === 'CANCEL'
            ? 'Conexão cancelada antes de concluir.'
            : (dados.data?.error_message || 'A Meta recusou a conexão. Tente novamente.'));
        }
      }
    }
    window.addEventListener('message', aoReceberMensagem);
    return () => window.removeEventListener('message', aoReceberMensagem);
  }, []);

  // Pré-carrega o SDK assim que a config chega.
  //
  // Não é otimização: `FB.login` PRECISA sair no mesmo gesto do clique. Qualquer espera de rede no
  // meio faz o navegador deixar de tratar a chamada como iniciada pelo usuário, e o popup é
  // engolido — sem erro, sem console, sem nada. Carregando antes, o clique só usa o que já está
  // pronto.
  useEffect(() => {
    if (!config) return undefined;
    let vivo = true;
    loadFacebookSdk({ appId: config.app_id, apiVersion: config.api_version })
      .then((FB) => { if (vivo) sdkRef.current = FB; })
      .catch(() => null);
    return () => { vivo = false; };
  }, [config]);

  const trocarCodigo = useCallback(async (code) => {
    setConectando(true);
    setErro('');
    try {
      const resp = await Api.waEmbeddedSignupExchange({
        code,
        session_info: sessionInfoRef.current || null,
        terms_version: LEGAL_METADATA.terms?.version,
      });
      sessionInfoRef.current = null;
      if (typeof onConnected === 'function') await onConnected(resp);
    } catch (err) {
      setErro(err?.message || 'Não foi possível concluir a conexão. Tente novamente.');
    } finally {
      if (montadoRef.current) setConectando(false);
    }
  }, [onConnected]);

  const abrirLogin = useCallback((FB) => {
    FB.login((response) => {
      const code = response?.authResponse?.code;
      if (!code) {
        // Sem code não há o que trocar. Pode ser cancelamento (o CANCEL do postMessage já terá
        // explicado) ou recusa de permissão.
        setConectando(false);
        setErro((atual) => atual || 'Conexão não concluída. Você precisa autorizar o acesso para continuar.');
        return;
      }
      trocarCodigo(code);
    }, {
      config_id: config.config_id,
      response_type: config.response_type || 'code',
      override_default_response_type: config.override_default_response_type !== false,
      extras: config.extras || {},
    });
  }, [config, trocarCodigo]);

  const conectar = useCallback(async () => {
    if (!config || conectando || disabled || !aceitou) return;
    setErro('');
    setConectando(true);
    sessionInfoRef.current = null;

    // Caminho normal: o SDK já veio no pré-carregamento, então o popup abre dentro do gesto do
    // clique e não é barrado.
    if (sdkRef.current) {
      abrirLogin(sdkRef.current);
      return;
    }

    // Só chega aqui se o pré-carregamento falhou. O popup pode ser engolido pelo navegador, mas
    // tentar e falhar com mensagem é melhor que não fazer nada.
    let FB;
    try {
      FB = await loadFacebookSdk({ appId: config.app_id, apiVersion: config.api_version });
    } catch {
      setConectando(false);
      setErro('Não foi possível carregar o login do Facebook. Verifique bloqueadores de anúncio e tente de novo.');
      return;
    }
    sdkRef.current = FB;
    abrirLogin(FB);
    // `aceitou` PRECISA estar aqui: sem ele o callback fica preso ao valor da primeira renderização
    // (false), o botão habilita mas o clique cai na guarda acima e nada acontece — sem erro nenhum.
  }, [config, conectando, disabled, aceitou, abrirLogin]);

  if (carregandoConfig) return null;
  if (!config) return null;

  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <div>
        <h3 style={{ margin: 0 }}>Conectar em um clique</h3>
        <p style={{ margin: '6px 0 0', color: 'var(--muted, #5B6178)' }}>
          Você entra com a sua conta do Facebook e escolhe (ou cria) o número do WhatsApp Business.
          Não precisa gerar token nem copiar código nenhum.
        </p>
      </div>

      {/* O aceite fica ANTES do botão e o desabilita: a Meta exige que as proibições estejam no
          contrato com o estabelecimento, e subir a versão dos Termos não coleta aceite de quem já
          tem conta. Aqui é o momento em que a obrigação nasce, então é aqui que se coleta. */}
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
        <input
          type="checkbox"
          checked={aceitou}
          onChange={(e) => setAceitou(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          Li e aceito as regras de uso do WhatsApp descritas nos{' '}
          <Link
            to="/termos#whatsapp"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#2563eb', fontWeight: 600, textDecoration: 'underline' }}
          >
            Termos de Uso
          </Link>
          {LEGAL_METADATA.terms?.version ? ` (versão ${LEGAL_METADATA.terms.version})` : ''}.
        </span>
      </label>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn--primary"
          onClick={conectar}
          disabled={conectando || disabled || !aceitou}
          style={{ justifySelf: 'start' }}
        >
          {conectando ? <span className="spinner" /> : 'Conectar com Facebook'}
        </button>

        {/* Saída de emergência. Fechar o popup no X NÃO dispara o CANCEL do postMessage, e o
            callback do FB.login nunca volta — sem isto a tela fica girando para sempre com o botão
            desabilitado, e só recarregando a página dá para tentar de novo. */}
        {conectando ? (
          <button
            type="button"
            onClick={() => { sessionInfoRef.current = null; setConectando(false); setErro(''); }}
            style={{
              background: 'none', border: 0, padding: 0, cursor: 'pointer',
              color: '#2563eb', fontSize: 13, textDecoration: 'underline',
            }}
          >
            Cancelar e tentar de novo
          </button>
        ) : null}
      </div>

      {erro ? <div className="notice notice--error">{erro}</div> : null}

      <p style={{ margin: 0, fontSize: 12, color: 'var(--muted, #5B6178)' }}>
        Prefere usar um número que já está numa conta sua na Meta? Use a conexão manual abaixo.
      </p>
    </div>
  );
}
