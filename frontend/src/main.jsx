import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles.css'
import './styles-premium.css'
import { initAnalytics } from './utils/analytics.js'
import { applyTheme } from './config/theme.js'
import { initInstallPrompt } from './utils/pwaInstall.js'
import { registerSW } from 'virtual:pwa-register'

// Aplica os tokens de marca (índigo) no :root antes do primeiro render.
applyTheme()
initAnalytics()
// Precisa rodar ANTES do primeiro render: o `beforeinstallprompt` do Chrome
// chega uma única vez e cedo. Registrar o listener dentro do banner perderia o
// evento, e o Android cairia no caminho de "sem API de instalação".
initInstallPrompt()

// Registra o service worker E RECARREGA quando uma versão nova assume.
//
// O register() sozinho não bastava: com skipWaiting, o SW novo tomava o
// controle enquanto a página continuava com o JS antigo em memória. O dono via
// conteúdo desatualizado até recarregar na mão — e, se navegasse para uma rota
// lazy, o bundle velho pedia um chunk que o build novo já tinha apagado, o que
// dá tela branca em vez de "versão antiga".
//
// `immediate: true` registra sem esperar o evento load; o registerSW do
// vite-plugin-pwa já protege contra laço de recarga.
registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
