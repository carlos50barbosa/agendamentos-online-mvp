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
import { Api } from '../../utils/api';

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
  const sessionInfoRef = useRef(null);
  const montadoRef = useRef(true);

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

  const trocarCodigo = useCallback(async (code) => {
    setConectando(true);
    setErro('');
    try {
      const resp = await Api.waEmbeddedSignupExchange({
        code,
        session_info: sessionInfoRef.current || null,
      });
      sessionInfoRef.current = null;
      if (typeof onConnected === 'function') await onConnected(resp);
    } catch (err) {
      setErro(err?.message || 'Não foi possível concluir a conexão. Tente novamente.');
    } finally {
      if (montadoRef.current) setConectando(false);
    }
  }, [onConnected]);

  const conectar = useCallback(async () => {
    if (!config || conectando || disabled) return;
    setErro('');
    setConectando(true);
    sessionInfoRef.current = null;

    let FB;
    try {
      FB = await loadFacebookSdk({ appId: config.app_id, apiVersion: config.api_version });
    } catch {
      setConectando(false);
      setErro('Não foi possível carregar o login do Facebook. Verifique bloqueadores de anúncio e tente de novo.');
      return;
    }

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
  }, [config, conectando, disabled, trocarCodigo]);

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

      <button
        type="button"
        className="btn btn--primary"
        onClick={conectar}
        disabled={conectando || disabled}
        style={{ justifySelf: 'start' }}
      >
        {conectando ? <span className="spinner" /> : 'Conectar com Facebook'}
      </button>

      {erro ? <div className="notice notice--error">{erro}</div> : null}

      <p style={{ margin: 0, fontSize: 12, color: 'var(--muted, #5B6178)' }}>
        Prefere usar um número que já está numa conta sua na Meta? Use a conexão manual abaixo.
      </p>
    </div>
  );
}
