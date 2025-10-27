import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import LogoAO from '../components/LogoAO.jsx'
import { Api } from '../utils/api'
import { saveToken, saveUser } from '../utils/auth'
import { useNavigate, useLocation } from 'react-router-dom'

export default function LoginEstabelecimento(){
  const nav = useNavigate()
  const loc = useLocation()
  const nextParam = useMemo(() => new URLSearchParams(loc.search).get('next') || '', [loc.search])
  const storedNext = useMemo(() => {
    if (typeof window === 'undefined') return ''
    try {
      return sessionStorage.getItem('next_after_login') || ''
    } catch {
      return ''
    }
  }, [loc.key])
  const nextTarget = nextParam || storedNext || '/estab'
  const [email,setEmail]=useState('')
  const [senha,setSenha]=useState('')
  const [showPass,setShowPass]=useState(false)
  const [err,setErr]=useState('')
  const [loading,setLoading]=useState(false)

  async function submit(e){
    e.preventDefault(); setErr(''); setLoading(true)
    try{
      const { token, user } = await Api.login(email.trim(), senha)
      if(user?.tipo!=='estabelecimento') throw new Error('tipo_incorreto')
      saveToken(token); saveUser(user);
      try { sessionStorage.removeItem('next_after_login') } catch {}
      nav(`/loading?type=login&next=${encodeURIComponent(nextTarget)}`)
    }catch(e){
      setErr(
        e?.message==='tipo_incorreto'
          ? 'Este acesso é para estabelecimentos. Use a tela de cliente.'
          : (e?.message || 'Falha no login. Verifique suas credenciais.')
      )
    }finally{
      setLoading(false)
    }
  }

  const disabled = !email || !senha || loading

  return (
    <div className="auth">
      <div className="auth-wrap">
        <div className="card auth-card">
          <div className="auth-illus" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <div className="auth-hero">
            <LogoAO size={48} />
            <div>
              <h2 style={{ margin: 0 }}>Login do Estabelecimento</h2>
              <small>Gerencie horários, serviços e clientes</small>
            </div>
          </div>

      <form onSubmit={submit} className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
        <input
          className="input"
          type="email"
          placeholder="Email"
          value={email}
          onChange={e=>setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        <div className="row" style={{ gap: 6 }}>
          <input
            className="input"
            type={showPass ? 'text' : 'password'}
            placeholder="Senha"
            value={senha}
            onChange={e=>setSenha(e.target.value)}
            autoComplete="current-password"
            required
            style={{ minWidth: 220 }}
          />
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={()=>setShowPass(v=>!v)}
            aria-pressed={showPass}
            title={showPass ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {showPass ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>

        <div className="row spread" style={{ width: '100%' }}>
          <Link to="/recuperar-senha" className="btn btn--link">Esqueci minha senha</Link>
          <span></span>
        </div>

        <button className="btn btn--primary btn--lg btn--block" disabled={disabled}>
          {loading ? <span className="spinner" /> : 'Entrar'}
        </button>
      </form>

      {err && (
        <div
          className="box"
          role="alert"
          aria-live="polite"
          style={{ marginTop: 10, borderColor: 'var(--danger-border)', color: 'var(--danger-text)', background: 'var(--danger-bg)' }}
        >
          Erro: {err}
        </div>
      )}

      <div className="divider"><span>ou</span></div>
      <div className="auth-alt">
        Novo por aqui? <Link to="/cadastro">Crie uma conta</Link>
      </div>
        </div>
      </div>
    </div>
  )
}
