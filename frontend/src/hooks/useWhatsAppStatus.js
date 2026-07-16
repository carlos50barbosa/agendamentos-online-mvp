// src/hooks/useWhatsAppStatus.js
// "O WhatsApp está no ar?" e "eu já autorizei?" — as duas perguntas que a tela precisa responder
// para não mentir para o usuário.
//
// Por que existe: a conta da plataforma foi suspensa pela Meta e o produto continuou prometendo
// WhatsApp. A caixa de opt-in dizia "quero receber a confirmação e os lembretes" e não chegava
// nada. Quem contava com o lembrete não era lembrado — e virava falta no salão.
import { useEffect, useState } from 'react';
import { Api } from '../utils/api';

// Uma requisição por carregamento de página, compartilhada por todo mundo que perguntar. A flag
// muda uma vez a cada seis meses; não faz sentido cada componente ir buscar a sua.
let configPromise = null;

/**
 * O canal está no ar?
 *
 * Otimista por padrão (`true`): se o endpoint falhar, a tela NÃO grita "WhatsApp fora do ar". Um
 * alarme falso — anunciar um apagão que não existe para todos os visitantes de um salão — é pior
 * do que deixar de anunciar um que existe, porque neste caso o e-mail cobre.
 */
export function useWhatsAppAvailable() {
  return useWhatsAppConfig().available;
}

/**
 * O status do canal + o número da plataforma para montar o link do AUTORIZO.
 *
 * `available` é otimista por padrão (`true`): se o endpoint falhar, a tela NÃO grita "WhatsApp fora
 * do ar". Um alarme falso — anunciar um apagão que não existe para todos os visitantes de um salão —
 * é pior do que deixar de anunciar um que existe, porque neste caso o e-mail cobre.
 *
 * `number` é o telefone da plataforma (só dígitos), ou null se não configurado — e aí a UI
 * simplesmente não oferece a ativação por WhatsApp, em vez de mostrar um link quebrado.
 */
export function useWhatsAppConfig() {
  const [state, setState] = useState({ available: true, number: null });

  useEffect(() => {
    if (!configPromise) {
      configPromise = Api.publicConfig().catch(() => null);
    }
    let alive = true;
    configPromise.then((cfg) => {
      if (!alive || !cfg) return;
      setState({
        available: cfg?.whatsapp?.available !== false,
        number: cfg?.whatsapp?.number || null,
      });
    });
    return () => { alive = false; };
  }, []);

  return state;
}

/**
 * O consentimento do usuário LOGADO. `precisaReaceitar` marca o dono de salão que tem a notificação
 * ligada de antes do opt-in existir e nunca deu aceite — para ele o envio está bloqueado, e ele
 * precisa saber disso em vez de achar que recebe.
 */
export function useWhatsAppConsent() {
  const [state, setState] = useState({ loading: true, optin: false, precisaReaceitar: false, semTelefone: false });

  const refresh = async () => {
    try {
      const r = await Api.whatsappOptinStatus();
      setState({
        loading: false,
        optin: Boolean(r?.optin),
        precisaReaceitar: Boolean(r?.precisa_reaceitar),
        // Sem telefone não há para onde enviar — a UI não deve oferecer ativação, e sim pedir o
        // cadastro do número primeiro.
        semTelefone: Boolean(r?.sem_telefone),
      });
    } catch {
      // Falhou a consulta: não inventa pendência. Um banner cobrando aceite de quem já aceitou é
      // ruído — e ruído que o dono aprende a ignorar, justamente no banner que um dia vai importar.
      setState({ loading: false, optin: false, precisaReaceitar: false, semTelefone: false });
    }
  };

  useEffect(() => { refresh(); }, []);

  return { ...state, refresh };
}
