import React, { useState } from 'react'
import { Api } from '../utils/api'
import { saveToken, saveUser } from '../utils/auth'
import { useNavigate } from 'react-router-dom'

export default function LoginEstabelecimento(){
  const nav = useNavigate()
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
      saveToken(token); saveUser(user); nav('/estab')
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
    <div className="card">
      <h2 style={{ marginBottom: 12 }}>Login do Estabelecimento</h2>

      <form onSubmit={submit} className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
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

        <button className="btn btn--primary" disabled={disabled}>
          {loading ? <span className="spinner" /> : 'Entrar'}
        </button>
      </form>

      {err && (
        <div
          className="box"
          role="alert"
          aria-live="polite"
          style={{ marginTop: 10, borderColor: '#7f1d1d', color: '#fecaca' }}
        >
          Erro: {err}
        </div>
      )}
    </div>
  )
}
