const SDK_SCRIPT_ID = 'meta-facebook-jssdk';
const TRUSTED_ORIGINS = new Set([
  'https://www.facebook.com',
  'https://web.facebook.com',
]);

let sdkPromise = null;

function createLaunchError(code, message, details) {
  const error = new Error(message || code || 'wa_embedded_signup_error');
  error.code = code || 'wa_embedded_signup_error';
  if (details !== undefined) error.details = details;
  return error;
}

function initSdk({ appId, apiVersion }) {
  if (typeof window === 'undefined' || !window.FB?.init) {
    throw createLaunchError(
      'wa_embedded_signup_sdk_unavailable',
      'O SDK da Meta nao esta disponivel neste navegador.'
    );
  }

  const currentConfig = window.__AO_META_SDK_INIT__ || {};
  if (currentConfig.appId === appId && currentConfig.apiVersion === apiVersion) {
    return window.FB;
  }

  window.FB.init({
    appId,
    autoLogAppEvents: false,
    cookie: false,
    version: apiVersion,
    xfbml: false,
  });
  window.__AO_META_SDK_INIT__ = { appId, apiVersion };
  return window.FB;
}

export async function loadMetaSdk({ appId, apiVersion, sdkLocale = 'en_US' }) {
  if (typeof window === 'undefined') {
    throw createLaunchError(
      'wa_embedded_signup_window_missing',
      'O Embedded Signup da Meta precisa ser iniciado em um navegador.'
    );
  }

  if (window.FB?.init) {
    return initSdk({ appId, apiVersion });
  }

  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const scriptSrc = `https://connect.facebook.net/${encodeURIComponent(sdkLocale)}/sdk.js`;
      const existing = document.getElementById(SDK_SCRIPT_ID);

      window.fbAsyncInit = () => {
        try {
          resolve(initSdk({ appId, apiVersion }));
        } catch (error) {
          reject(error);
        }
      };

      if (existing) {
        existing.addEventListener('error', () => {
          reject(createLaunchError(
            'wa_embedded_signup_sdk_load_failed',
            'Nao foi possivel carregar o SDK da Meta.'
          ));
        }, { once: true });
        return;
      }

      const script = document.createElement('script');
      script.id = SDK_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.src = scriptSrc;
      script.onerror = () => {
        reject(createLaunchError(
          'wa_embedded_signup_sdk_load_failed',
          'Nao foi possivel carregar o SDK da Meta.'
        ));
      };
      document.body.appendChild(script);
    });
  }

  try {
    return await sdkPromise;
  } catch (error) {
    sdkPromise = null;
    throw error;
  }
}

function parseMessagePayload(event) {
  if (!event?.origin || !TRUSTED_ORIGINS.has(event.origin)) return null;

  let payload = event.data;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }

  if (!payload || typeof payload !== 'object') return null;
  if (String(payload.type || '').toUpperCase() !== 'WA_EMBEDDED_SIGNUP') return null;

  const rawData = payload.data && typeof payload.data === 'object' ? payload.data : {};
  return {
    type: 'WA_EMBEDDED_SIGNUP',
    event: payload.event ? String(payload.event).toUpperCase() : null,
    version: payload.version != null ? String(payload.version) : null,
    origin: event.origin,
    data: { ...rawData },
  };
}

function isFinishEvent(sessionInfo) {
  const eventName = String(sessionInfo?.event || '').toUpperCase();
  return eventName === 'FINISH' || eventName === 'FINISH_ONLY_WABA';
}

export function isEmbeddedSignupCancellationError(error) {
  return String(error?.code || '') === 'wa_embedded_signup_cancelled';
}

export async function launchWhatsAppEmbeddedSignup(config) {
  const embeddedSignup = config?.embedded_signup || config || {};
  const appId = String(embeddedSignup.app_id || '').trim();
  const configId = String(embeddedSignup.config_id || '').trim();
  const apiVersion = String(embeddedSignup.api_version || 'v24.0').trim() || 'v24.0';
  const sdkLocale = String(embeddedSignup.sdk_locale || 'en_US').trim() || 'en_US';

  if (!appId || !configId) {
    throw createLaunchError(
      'wa_embedded_signup_config_missing',
      'A configuracao publica da Meta esta incompleta para iniciar o WhatsApp Business.'
    );
  }

  const FB = await loadMetaSdk({ appId, apiVersion, sdkLocale });

  return new Promise((resolve, reject) => {
    let settled = false;
    let codeValue = null;
    let latestSession = null;
    let responseSnapshot = null;
    let finishTimer = null;

    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      if (finishTimer) {
        window.clearTimeout(finishTimer);
        finishTimer = null;
      }
    };

    const resolveAfterGrace = (delayMs = 0) => {
      if (!codeValue || settled) return;
      if (finishTimer) {
        window.clearTimeout(finishTimer);
      }
      finishTimer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({
          code: codeValue,
          sessionInfo: latestSession,
          authResponse: responseSnapshot?.authResponse || null,
        });
      }, delayMs);
    };

    const rejectLaunch = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleMessage = (event) => {
      const payload = parseMessagePayload(event);
      if (!payload) return;
      latestSession = payload;

      if (payload.event === 'ERROR' && !codeValue) {
        rejectLaunch(createLaunchError(
          'wa_embedded_signup_meta_error',
          payload.data?.error_message || 'A Meta retornou um erro ao iniciar o WhatsApp Business.',
          { sessionInfo: payload }
        ));
        return;
      }

      if (codeValue && isFinishEvent(payload)) {
        resolveAfterGrace(0);
      }
    };

    window.addEventListener('message', handleMessage);

    try {
      FB.login((response) => {
        responseSnapshot = response || null;
        const code = response?.authResponse?.code;
        if (!code) {
          const cancelled = String(latestSession?.event || '') === 'CANCEL';
          rejectLaunch(createLaunchError(
            cancelled ? 'wa_embedded_signup_cancelled' : 'wa_embedded_signup_no_code',
            cancelled
              ? 'Conexao cancelada antes da conclusao.'
              : 'A Meta nao retornou o codigo de autorizacao do WhatsApp.',
            {
              sessionInfo: latestSession,
              response,
            }
          ));
          return;
        }

        codeValue = String(code);

        if (latestSession?.event === 'ERROR') {
          rejectLaunch(createLaunchError(
            'wa_embedded_signup_meta_error',
            latestSession.data?.error_message || 'A Meta retornou um erro ao concluir o WhatsApp Business.',
            {
              sessionInfo: latestSession,
              response,
            }
          ));
          return;
        }

        if (isFinishEvent(latestSession)) {
          resolveAfterGrace(0);
          return;
        }

        resolveAfterGrace(1200);
      }, {
        config_id: configId,
        response_type: embeddedSignup.response_type || 'code',
        override_default_response_type: embeddedSignup.override_default_response_type !== false,
        extras: {
          ...(embeddedSignup.extras && typeof embeddedSignup.extras === 'object'
            ? embeddedSignup.extras
            : {}),
        },
      });
    } catch (error) {
      rejectLaunch(createLaunchError(
        error?.code || 'wa_embedded_signup_launch_failed',
        error?.message || 'Nao foi possivel abrir o Embedded Signup da Meta.',
        { cause: error }
      ));
    }
  });
}
