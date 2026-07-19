import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles.css'
import './styles-premium.css'
import { initAnalytics } from './utils/analytics.js'
import { applyTheme } from './config/theme.js'
import { initInstallPrompt } from './utils/pwaInstall.js'

// Aplica os tokens de marca (índigo) no :root antes do primeiro render.
applyTheme()
initAnalytics()
// Precisa rodar ANTES do primeiro render: o `beforeinstallprompt` do Chrome
// chega uma única vez e cedo. Registrar o listener dentro do banner perderia o
// evento, e o Android cairia no caminho de "sem API de instalação".
initInstallPrompt()

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
