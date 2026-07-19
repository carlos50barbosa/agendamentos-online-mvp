// src/components/estab/InstallAppBanner.jsx
// Convite para o dono instalar o app na tela de início do celular.
//
// Mora ANCORADO NO RODAPÉ, acima da barra de navegação — e não no topo do
// /estab. Aquele espaço foi desentupido de propósito (ver o cabeçalho de
// WhatsAppOptInBanner.module.css) e o banner do WhatsApp é o único que paga a
// passagem lá: ele é uma pendência bloqueante que some quando resolvida. Isto
// aqui é uma oferta, não uma pendência — empurrar o conteúdo para baixo toda
// vez que o dono abre o painel seria caro demais para o que entrega.
//
// No iPhone o convite vira instrução, porque não existe API de instalação — ver
// o cabeçalho de utils/pwaInstall.js.
import React, { useEffect, useState } from 'react';
import { X, Share, PlusSquare, Download } from 'lucide-react';
import {
  getInstallState,
  promptInstall,
  dismissInstall,
  noteVisit,
  subscribeInstall,
} from '../../utils/pwaInstall.js';
import styles from './InstallAppBanner.module.css';

export default function InstallAppBanner() {
  const [state, setState] = useState({ show: false, mode: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    noteVisit();
    const refresh = () => setState(getInstallState());
    refresh();
    // O beforeinstallprompt pode chegar depois deste mount; sem reavaliar, o
    // Android cairia no caminho "sem API" e nunca mostraria o botão nativo.
    return subscribeInstall(refresh);
  }, []);

  if (!state.show) return null;

  const instalar = async () => {
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    // Recusou no diálogo nativo: guarda a dispensa em vez de reoferecer na
    // próxima visita. Já ouvimos "não" uma vez.
    if (outcome !== 'accepted') dismissInstall();
    setState(getInstallState());
  };

  const fechar = () => {
    dismissInstall();
    setState(getInstallState());
  };

  return (
    <div className={styles.wrap} role="region" aria-label="Instalar o aplicativo">
      <button type="button" className={styles.close} onClick={fechar} aria-label="Dispensar">
        <X size={16} strokeWidth={2.4} aria-hidden="true" />
      </button>

      <div className={styles.body}>
        {/* "Aplicativo" logo no título: sem essa palavra o dono lê "atalho" e
            descarta, sem entender que ganha ícone, tela cheia e notificação. */}
        <p className={styles.title}>Instale o aplicativo no seu celular</p>

        {state.mode === 'native' ? (
          <>
            {/* NÃO prometer que instalar "libera as notificações" aqui: no Android
                o push funciona numa aba normal do Chrome — quem entrega é o
                service worker, que roda no site com ou sem ícone na tela. O
                atalho é só um lançador. Essa promessa vale no iPhone (ramo
                abaixo), onde o Safari realmente exige a instalação. */}
            <p className={styles.lead}>
              Fica igual a um <b>app</b>: abre pelo ícone em tela cheia, sem precisar
              procurar o site no navegador.
            </p>
            <button type="button" className={styles.cta} onClick={instalar} disabled={busy}>
              <Download size={16} strokeWidth={2.2} aria-hidden="true" />
              {busy ? 'Instalando…' : 'Instalar aplicativo'}
            </button>
          </>
        ) : (
          <>
            {/* iPhone: sem API, o passo a passo é o produto. Os ícones abaixo são
                os mesmos que a pessoa vê na barra do Safari, para ela reconhecer
                o alvo em vez de caçar por nome. */}
            {/* A promessa é escopada à notificação NA TELA, e não ao aviso em
                geral: o dono recebe por e-mail de qualquer jeito. Dizer "único
                jeito de receber o aviso" o fazia entender que ficaria sem saber
                dos agendamentos, o que assusta sem motivo — e é falso.
                Só o push depende da instalação, e só no iPhone. */}
            <p className={styles.lead}>
              Vira um <b>app</b> no seu iPhone em dois toques. É o que faz o aviso de
              novo agendamento <b>aparecer na tela do celular</b> — o Safari só libera
              isso depois da instalação. Os avisos por <b>e-mail</b> continuam
              chegando normalmente.
            </p>
            <ol className={styles.steps}>
              <li>
                <Share size={15} strokeWidth={2.2} aria-hidden="true" />
                <span>Toque em <b>Compartilhar</b>, na barra de baixo</span>
              </li>
              <li>
                <PlusSquare size={15} strokeWidth={2.2} aria-hidden="true" />
                <span>Escolha <b>Adicionar à Tela de Início</b></span>
              </li>
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
