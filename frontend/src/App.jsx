import React from 'react'
import { NavLink, Routes, Route, useNavigate } from 'react-router-dom' // <-- removi Link
import { getUser, logout } from './utils/auth'
import LoginCliente from './pages/LoginCliente.jsx'
import LoginEstabelecimento from './pages/LoginEstabelecimento.jsx'
import Cadastro from './pages/Cadastro.jsx'
import DashboardCliente from './pages/DashboardCliente.jsx'
import DashboardEstabelecimento from './pages/DashboardEstabelecimento.jsx'
import ServicosEstabelecimento from './pages/ServicosEstabelecimento.jsx'
import NovoAgendamento from './pages/NovoAgendamento.jsx'

function Header(){
  const nav = useNavigate()
  const user = getUser()
  return (
    <header className="header"> {/* <- aplica estilo do header */}
      <h1>Agendamentos Online</h1>
      <nav className="nav">     {/* <- aplica estilo do nav */}
        {!user && <>
          <NavLink to="/login-cliente" className={({isActive}) => isActive ? 'active' : undefined}>Cliente</NavLink>
          <NavLink to="/login-estabelecimento" className={({isActive}) => isActive ? 'active' : undefined}>Estabelecimento</NavLink>
          <NavLink to="/cadastro" className={({isActive}) => isActive ? 'active' : undefined}>Cadastro</NavLink>
        </>}
        {user && user.tipo==='cliente' && <>
          <NavLink to="/cliente" className={({isActive}) => isActive ? 'active' : undefined}>Dashboard</NavLink>
          <NavLink to="/novo" className={({isActive}) => isActive ? 'active' : undefined}>Novo Agendamento</NavLink>
        </>}
        {user && user.tipo==='estabelecimento' && <>
          <NavLink to="/estab" className={({isActive}) => isActive ? 'active' : undefined}>Dashboard</NavLink>
          <NavLink to="/servicos" className={({isActive}) => isActive ? 'active' : undefined}>Serviços</NavLink>
        </>}
        {user && (
          <button
            className="btn btn--sm btn--outline"  // <- botão no padrão do tema
            onClick={() => { logout(); nav('/'); }}
          >
            Sair
          </button>
        )}
      </nav>
    </header>
  )
}

export default function App(){
  return (
    <>
      <Header/>
      <div className="container">
        <Routes>
          <Route path="/" element={<div className="card"><h2>MVP pronto</h2><p>Faça login para continuar.</p></div>} />
          <Route path="/login-cliente" element={<LoginCliente/>}/>
          <Route path="/login-estabelecimento" element={<LoginEstabelecimento/>}/>
          <Route path="/cadastro" element={<Cadastro/>}/>
          <Route path="/cliente" element={<DashboardCliente/>}/>
          <Route path="/estab" element={<DashboardEstabelecimento/>}/>
          <Route path="/servicos" element={<ServicosEstabelecimento/>}/>
          <Route path="/novo" element={<NovoAgendamento/>}/>
        </Routes>
      </div>
    </>
  )
}
