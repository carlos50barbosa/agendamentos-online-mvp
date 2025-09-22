import React, { useState } from 'react';
import { Api } from '../utils/api';

export default function AdminTools(){
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [err, setErr] = useState('');

  async function runCleanup(){
    setErr(''); setResult(''); setLoading(true);
    try{
      const r = await Api.adminCleanup(token);
      setResult(JSON.stringify(r));
    }catch(e){
      setErr(e?.message || 'Falha ao executar limpeza');
    }finally{
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 560, margin: '20px auto' }}>
        <h2 style={{ marginTop: 0 }}>Ferramentas Admin</h2>
        <div className="label">
          <span>Admin Token</span>
          <input className="input" type="password" placeholder="Cole seu ADMIN_TOKEN" value={token} onChange={e=>setToken(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <button className="btn btn--primary" onClick={runCleanup} disabled={!token || loading}>
            {loading ? <span className="spinner"/> : 'Executar limpeza /admin/cleanup'}
          </button>
        </div>
        {result && (
          <div className="box" style={{ marginTop: 10 }}>
            <strong>Resultado:</strong>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{result}</pre>
          </div>
        )}
        {err && (
          <div className="box" role="alert" style={{ marginTop: 10, borderColor: 'var(--danger-border)', color: 'var(--danger-text)', background: 'var(--danger-bg)' }}>
            Erro: {err}
          </div>
        )}
        <p className="muted" style={{ marginTop: 10 }}>
          Dica: o token não é armazenado, apenas usado neste pedido.
        </p>
      </div>
    </div>
  );
}

