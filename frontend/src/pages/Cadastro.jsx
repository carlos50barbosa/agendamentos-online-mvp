import React, { useState, useMemo } from 'react'
import { Api } from '../utils/api'
import { saveToken, saveUser } from '../utils/auth'
import { useNavigate } from 'react-router-dom'

export default function Cadastro(){
  const nav = useNavigate()
  const [form,setForm]=useState({nome:'',email:'',senha:'',tipo:'cliente'})
  const [confirm,setConfirm]=useState('')
  const [showPass,setShowPass]=useState(false)
  const [showConfirm,setShowConfirm]=useState(false)
  const [err,setErr]=useState('')
  const [loading,setLoading]=useState(false)

  // validações simples
  const emailOk = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()), [form.email])
  const senhaScore = useMemo(()=>{
    const s = form.senha
    let pts = 0
    if (s.length >= 8) pts++
    if (/[A-Z]/.test(s) && /[a-z]/.test(s)) pts++
    if (/\d/.test(s) || /[^A-Za-z0-9]/.test(s)) pts++
    return pts // 0-3
  }, [form.senha])
  const senhaLabel = ['Fraca','Razoável','Boa','Forte'][senhaScore]
  const senhaOk = form.senha.length >= 8
  const matchOk = form.senha && confirm && form.senha === confirm
  const nomeOk = form.nome.trim().length >= 2

  const disabled = loading || !nomeOk || !emailOk || !senhaOk || !matchOk

  async function submit(e){
    e.preventDefault(); setErr('')
    if (disabled) return
    setLoading(true)
    try {
      const payload = {
        nome: form.nome.trim(),
        email: form.email.trim(),
        senha: form.senha,
        tipo: form.tipo
      }
      const { token, user } = await Api.register(payload)
      saveToken(token); saveUser(user)
      nav(user?.tipo === 'cliente' ? '/cliente' : '/estab')
    } catch (e) {
      const msg =
        e?.message === 'email_exists' ? 'Este e-mail já está cadastrado.'
      : e?.message === 'validation_error' ? 'Dados inválidos. Verifique os campos.'
      : (e?.message || 'Falha ao criar conta. Tente novamente.')
      setErr(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginBottom: 12 }}>Criar conta</h2>

      <form onSubmit={submit} className="grid" style={{ gap: 10 }}>
        <input
          className="input"
          placeholder="Nome"
          value={form.nome}
          onChange={e=>setForm({...form, nome:e.target.value})}
          required
        />

        <input
          className="input"
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={e=>setForm({...form, email:e.target.value})}
          autoComplete="email"
          required
        />
        {!emailOk && form.email && <small className="muted">Informe um e-mail válido.</small>}

        {/* Senha + força + mostrar/ocultar */}
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            type={showPass ? 'text' : 'password'}
            placeholder="Senha (mín. 8 caracteres)"
            value={form.senha}
            onChange={e=>setForm({...form, senha:e.target.value})}
            autoComplete="new-password"
            required
            style={{ minWidth: 260 }}
          />
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={()=>setShowPass(v=>!v)}
            aria-pressed={showPass}
          >
            {showPass ? 'Ocultar' : 'Mostrar'}
          </button>
          {form.senha && (
            <small className="muted">Força: {senhaLabel}</small>
          )}
        </div>

        {/* Confirmar senha */}
        <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            type={showConfirm ? 'text' : 'password'}
            placeholder="Confirmar senha"
            value={confirm}
            onChange={e=>setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            style={{ minWidth: 260 }}
          />
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={()=>setShowConfirm(v=>!v)}
            aria-pressed={showConfirm}
          >
            {showConfirm ? 'Ocultar' : 'Mostrar'}
          </button>
          {!!confirm && !matchOk && <small className="muted">As senhas não coincidem.</small>}
        </div>

        {/* Tipo de conta */}
        <label className="label" style={{ maxWidth: 320 }}>
          <span>Tipo de conta</span>
          <select
            className="input"
            value={form.tipo}
            onChange={e=>setForm({...form, tipo:e.target.value})}
          >
            <option value="cliente">Cliente</option>
            <option value="estabelecimento">Estabelecimento</option>
          </select>
        </label>

        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button type="submit" className="btn btn--primary" disabled={disabled}>
            {loading ? <span className="spinner" /> : 'Criar conta'}
          </button>
        </div>

        {err && (
          <div
            className="box"
            role="alert"
            aria-live="polite"
            style={{ borderColor: '#7f1d1d', color: '#fecaca' }}
          >
            Erro: {err}
          </div>
        )}
      </form>
    </div>
  )
}
