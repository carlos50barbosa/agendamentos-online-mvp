import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Api } from '../utils/api';

export default function DefinirSenha(){
  const location = useLocation();
  const nav = useNavigate();
  const token = useMemo(() => new URLSearchParams(location.search).get('token') || '', [location.search]);
  const [senha, setSenha] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const valid = !!token && senha.length >= 6 && senha === confirm && !loading;

  async function submit(e){
    e.preventDefault();
    if (!valid) return;
    setErr('');
    setLoading(true);
    try{
      await Api.resetPassword(token, senha);
      try { localStorage.setItem('session_message', 'Senha redefinida com sucesso. Faça login.'); } catch {}
      nav('/login', { replace: true });
    }catch(e){
      setErr(e?.message || 'Não foi possível redefinir sua senha.');
    }finally{
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-wrap">
        <div className="card auth-card">
          <div className="auth-illus" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17a5 5 0 100-10 5 5 0 000 10z" />
              <path d="M12 22v-3" />
            </svg>
          </div>
          <div className="auth-hero">
            <div className="brand__logo" aria-hidden>AO</div>
            <div>
              <h2 style={{ margin: 0 }}>Definir nova senha</h2>
              <small>Mínimo de 6 caracteres</small>
            </div>
          </div>

          {!token && (
            <div className="box" role="alert" style={{ marginTop: 10 }}>
              Link inválido. Solicite novamente em <Link to="/recuperar-senha">Recuperar senha</Link>.
            </div>
          )}

          {token && (
            <form onSubmit={submit} className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input"
                  type={show ? 'text' : 'password'}
                  placeholder="Nova senha"
                  value={senha}
                  onChange={e=>setSenha(e.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  required
                  style={{ minWidth: 220 }}
                />
                <button type="button" className="btn btn--outline btn--sm" onClick={()=>setShow(v=>!v)} aria-pressed={show}>
                  {show ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
              <input
                className="input"
                type="password"
                placeholder="Confirmar senha"
                value={confirm}
                onChange={e=>setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />

              <button className="btn btn--primary" disabled={!valid}>
                {loading ? <span className="spinner" /> : 'Salvar senha'}
              </button>
            </form>
          )}

          {err && (
            <div className="box" role="alert" aria-live="polite" style={{ marginTop: 10, borderColor: '#7f1d1d', color: '#991b1b', background: '#fef2f2' }}>
              Erro: {err}
            </div>
          )}

          <div className="divider"><span>ou</span></div>
          <div className="auth-alt">
            Lembrou? <Link to="/login">Voltar ao login</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

