import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './styles.css'
import './styles-premium.css'
import { initAnalytics } from './utils/analytics.js'
import { applyTheme } from './config/theme.js'

// Aplica os tokens de marca (índigo) no :root antes do primeiro render.
applyTheme()
initAnalytics()

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)
