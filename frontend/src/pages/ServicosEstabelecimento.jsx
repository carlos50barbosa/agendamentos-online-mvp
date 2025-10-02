import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Api } from "../utils/api";

export default function ServicosEstabelecimento() {
  // Lista
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [pros, setPros] = useState([]);

  // Formulario
  const [form, setForm] = useState({
    nome: "",
    duracao_min: 30,
    preco_centavos: 0,
    ativo: true,
  });
  const [precoStr, setPrecoStr] = useState("R$ 0,00");
  const [saving, setSaving] = useState(false);
  const [selectedProsNew, setSelectedProsNew] = useState([]);

  // UI extras
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos"); // todos|ativos|inativos

  // Excluir
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Editar
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState({ nome: '', duracao_min: 30, preco_centavos: 0 });
  const [editPrecoStr, setEditPrecoStr] = useState('R$ 0,00');
  const [editSaving, setEditSaving] = useState(false);
  const [selectedProsEdit, setSelectedProsEdit] = useState([]);

  // Toast
  const [toast, setToast] = useState(null); // {type:'success'|'error'|'info', msg:string}
  const [planLimitOpen, setPlanLimitOpen] = useState(false);
  const [planLimitMessage, setPlanLimitMessage] = useState('');
  function showToast(type, msg, ms = 2500) {
    setToast({ type, msg });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), ms);
  }

  useEffect(() => {
    (async () => {
      try {
        const rows = await Api.servicosList();
        setList(rows || []);
        try { setPros(await Api.profissionaisList()); } catch {}
      } catch (e) {
        showToast("error", "Nao foi possivel carregar os servicos.");
      } finally {
        setLoadingList(false);
      }
    })();
  }, []);

  // Banner de teste/plano: placeholder apenas no front usando localStorage
  const [trialInfo, setTrialInfo] = useState(null);
  useEffect(() => {
    try {
      const plan = localStorage.getItem("plan_current") || "starter";
      let end = localStorage.getItem("trial_end");
      if (!end) {
        const d = new Date(); d.setDate(d.getDate() + 14); end = d.toISOString();
        localStorage.setItem("trial_end", end);
      }
      setTrialInfo({ plan, end });
    } catch {}
  }, []);
  const trialDaysLeft = useMemo(() => {
    if (!trialInfo?.end) return 0;
    const diff = new Date(trialInfo.end).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  }, [trialInfo]);

  // Helpers de preco (BRL)
  const formatBRL = (centavos) =>
    (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function handlePrecoChange(e) {
    const digits = e.target.value.replace(/\D/g, ""); // apenas numeros
    const centavos = parseInt(digits || "0", 10);
    setForm((f) => ({ ...f, preco_centavos: centavos }));
    setPrecoStr(formatBRL(centavos));
  }

  function handleEditPrecoChange(e) {
    const digits = e.target.value.replace(/\D/g, "");
    const centavos = parseInt(digits || "0", 10);
    setEditForm((f) => ({ ...f, preco_centavos: centavos }));
    setEditPrecoStr(formatBRL(centavos));
  }

  // Validacao simples
  const formInvalid =
    !form.nome.trim() || form.duracao_min <= 0 || form.preco_centavos <= 0;

  async function add(e) {
    e.preventDefault();
    if (formInvalid) {
      showToast("error", "Preencha os campos corretamente.");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      if (Array.isArray(selectedProsNew) && selectedProsNew.length) {
        payload.professionalIds = selectedProsNew;
      }
      const novo = await Api.servicosCreate(payload);
      setList((curr) => [novo, ...curr]);
      setForm({ nome: "", duracao_min: 30, preco_centavos: 0, ativo: true });
      setPrecoStr("R$ 0,00");
      setSelectedProsNew([]);
      showToast("success", "Servico cadastrado!");
    } catch (err) {
      if (err?.data?.error === 'plan_limit') {
        setPlanLimitMessage(err?.message || 'Seu plano atual nao permite adicionar mais servicos. Atualize o plano para continuar.');
        setPlanLimitOpen(true);
      } else {
        showToast("error", "Erro ao salvar o servico.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Confirmacao de exclusao
  function askDelete(svc) {
    setToDelete(svc);
    setConfirmOpen(true);
  }

  // Abrir edicao
  function openEdit(svc){
    setEditItem(svc);
    setEditForm({ nome: svc.nome || '', duracao_min: svc.duracao_min || 30, preco_centavos: svc.preco_centavos || 0 });
    setEditPrecoStr(formatBRL(svc.preco_centavos || 0));
    const profIds = Array.isArray(svc.professionals) ? svc.professionals.map(p => p.id) : [];
    setSelectedProsEdit(profIds);
    setEditOpen(true);
  }

  async function saveEdit(){
    if (!editItem) return;
    if (!editForm.nome.trim() || !editForm.duracao_min || !editForm.preco_centavos){
      showToast('error', 'Preencha os campos corretamente.');
      return;
    }
    setEditSaving(true);
    try{
      const payload = { nome: editForm.nome.trim(), duracao_min: editForm.duracao_min, preco_centavos: editForm.preco_centavos };
      if (Array.isArray(selectedProsEdit)) payload.professionalIds = selectedProsEdit;
      const updated = await Api.servicosUpdate(editItem.id, payload);
      setList(curr => curr.map(x => x.id === editItem.id ? { ...x, ...updated } : x));
      setEditOpen(false);
      setEditItem(null);
      showToast('success', 'Servico atualizado.');
    }catch(e){
      showToast('error', 'Falha ao atualizar o servico.');
    }finally{
      setEditSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    const id = toDelete.id;
    setDeletingId(id);
    setConfirmOpen(false);

    // otimista
    const prev = list;
    setList((curr) => curr.filter((x) => x.id !== id));

    try {
      await Api.servicosDelete(id);
      showToast("success", "Servico excluido.");
    } catch (e) {
      // reverte se falhar
      setList(prev);
      showToast("error", "Falha ao excluir. Tente novamente.");
    } finally {
      setDeletingId(null);
    }
  }

  // Toggle ativo (update otimista)
  async function toggleAtivo(svc) {
    const novoAtivo = !svc.ativo;
    const prev = list;
    setList((curr) =>
      curr.map((x) =>
        x.id === svc.id ? { ...x, ativo: novoAtivo, _updating: true } : x
      )
    );

    try {
      await Api.servicosUpdate(svc.id, { ativo: novoAtivo });
      setList((curr) =>
        curr.map((x) => (x.id === svc.id ? { ...x, _updating: false } : x))
      );
      showToast("success", `Servico ${novoAtivo ? "ativado" : "inativado"}.`);
    } catch (e) {
      setList(prev);
      showToast("error", "Nao foi possivel atualizar o status.");
    }
  }

  // Filtro/busca
  const filtered = useMemo(() => {
    let arr = list;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      arr = arr.filter((s) => s.nome?.toLowerCase().includes(q));
    }
    if (statusFilter !== "todos") {
      const target = statusFilter === "ativos";
      arr = arr.filter((s) => !!s.ativo === target);
    }
    return arr;
  }, [list, query, statusFilter]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      {trialInfo && trialInfo.plan === 'starter' && (
        trialDaysLeft > 0 ? (
          <div className="card box--highlight" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div className="row" style={{ gap: 8, alignItems: 'center' }}>
              <div className="brand__logo" aria-hidden>AO</div>
              <div>
                <strong>Teste gratis ativo</strong>
                <div className="small muted">{trialDaysLeft} {trialDaysLeft === 1 ? 'dia restante' : 'dias restantes'}</div>
              </div>
            </div>
            <Link className="btn btn--primary btn--sm" to="/planos">Experimentar Pro</Link>
          </div>
        ) : (
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderColor: 'var(--warning-border)', background: 'var(--warning-bg)' }}>
            <div>
              <strong>Seu periodo de teste terminou</strong>
              <div className="small muted">Desbloqueie WhatsApp, relatorios avancados e mais com o Pro.</div>
            </div>
            <Link className="btn btn--outline btn--sm" to="/planos">Conhecer planos</Link>
          </div>
        )
      )}
      {/* Toast */}
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}

      {/* Novo Servico */}
      <div className="card">
        <h2 style={{ marginBottom: 12 }}>Novo Serviço</h2>
        <form onSubmit={add} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input
            className="input"
            placeholder="Nome do serviço"
            value={form.nome}
            onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            maxLength={80}
          />

          <select
            className="input"
            value={form.duracao_min}
            onChange={(e) =>
              setForm((f) => ({ ...f, duracao_min: parseInt(e.target.value, 10) }))
            }
            title="Duracao (min)"
          >
            {[15, 30, 45, 60, 75, 90, 120].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>

          <input
            className="input"
            type="text"
            inputMode="numeric"
            placeholder="Preco"
            value={precoStr}
            onChange={handlePrecoChange}
          />

          <label className="switch">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
            />
            <span>Ativo</span>
          </label>

          {pros.length > 0 && (
            <div className="grid" style={{ gap: 4, width: '100%', marginTop: 4 }}>
              <div className="muted" style={{ fontSize: 12 }}>Vincular profissionais (opcional)</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {pros.map((p) => (
                  <label key={p.id} className={`chip ${selectedProsNew.includes(p.id) ? 'chip--active' : ''}`} style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      style={{ display: 'none' }}
                      checked={selectedProsNew.includes(p.id)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedProsNew((curr) => checked ? Array.from(new Set([...curr, p.id])) : curr.filter((id) => id !== p.id));
                      }}
                    />
                    {p.nome}
                  </label>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn--primary" disabled={saving || formInvalid}>
            {saving ? <span className="spinner" /> : "Salvar"}
          </button>
        </form>

        {/* Dica de validacao */}
        {formInvalid && (
          <small className="muted">
            Preencha nome, selecione duracao e informe um preço maior que zero.
          </small>
        )}
      </div>

      {/* Meus Servicos */}
      <div className="card">
        <div
          className="header-row"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <h2>Meus Serviços</h2>
          <div className="filters" style={{ display: "flex", gap: 8 }}>
            <input
              className="input"
              placeholder="Buscar por nome..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="todos">Todos</option>
              <option value="ativos">Ativos</option>
              <option value="inativos">Inativos</option>
            </select>
          </div>
        </div>

        {loadingList ? (
          <SkeletonTable />
        ) : filtered.length === 0 ? (
          <div className="empty">
            <p>Nenhum serviço encontrado.</p>
            <small>Dica: ajuste a busca ou cadastre um novo serviço acima.</small>
          </div>
        ) : (
          <>
            <div className="count" style={{ marginBottom: 8 }}>
              Exibindo <b>{filtered.length}</b>{" "}
              {filtered.length === 1 ? "servico" : "servicos"}.
            </div>
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Duração</th>
                  <th>Preço</th>
                  <th className="service-status__header">Status</th>
                  <th className="service-actions__header">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className={s._updating ? "updating" : ""}>
                    <td>{s.nome}</td>
                    <td>{s.duracao_min} min</td>
                    <td>{formatBRL(s.preco_centavos ?? 0)}</td>
                    <td className="service-status-cell">
                      <button
                        className={`badge service-status ${s.ativo ? "ok" : "out"}`}
                        title="Clique para alternar"
                        onClick={() => toggleAtivo(s)}
                        disabled={!!s._updating}
                      >
                        {s.ativo ? "Ativo" : "Inativo"}
                      </button>
                    </td>
                    <td className="service-actions">
                      <button
                        className="btn btn--outline"
                        onClick={() => openEdit(s)}
                        disabled={!!s._updating}
                      >
                        Editar
                      </button>
                      <button
                        className="btn btn--danger"
                        onClick={() => askDelete(s)}
                        disabled={deletingId === s.id}
                      >
                        {deletingId === s.id ? <span className="spinner" /> : "Excluir"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Modal de confirmacao */}
      {confirmOpen && (
        <Modal onClose={() => setConfirmOpen(false)}>
          <h3>Excluir servico?</h3>
          <p>
            Tem certeza que deseja excluir <b>{toDelete?.nome}</b>? Esta acao nao
            pode ser desfeita.
          </p>
          <div
            style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}
          >
            <button className="btn btn--outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </button>
            <button className="btn btn--danger" onClick={confirmDelete}>
              Excluir
            </button>
          </div>
        </Modal>
      )}

      {/* Modal de edicao */}
      {planLimitOpen && (
        <Modal onClose={() => setPlanLimitOpen(false)}>
          <h3>Atualize seu plano</h3>
          <p>
            {planLimitMessage || 'Seu plano atual (Starter) permite cadastrar ate 10 servicos. Para adicionar novos servicos, migre para o plano Pro ou Premium.'}
          </p>
          <p className="muted">
            Acesse <strong>Configuracoes &gt; Planos</strong> ou utilize os botoes abaixo para mudar de plano.
          </p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Link className="btn btn--outline" to="/configuracoes" onClick={() => setPlanLimitOpen(false)}>Ir para Configuracoes</Link>
            <Link className="btn btn--primary" to="/planos" onClick={() => setPlanLimitOpen(false)}>Ver planos</Link>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn--sm" onClick={() => setPlanLimitOpen(false)}>Fechar</button>
          </div>
        </Modal>
      )}

      {editOpen && (
        <Modal onClose={() => setEditOpen(false)}>
          <h3>Editar servico</h3>
          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
            <input
              className="input"
              placeholder="Nome do servico"
              value={editForm.nome}
              onChange={(e) => setEditForm((f) => ({ ...f, nome: e.target.value }))}
              maxLength={80}
            />
            <select
              className="input"
              value={editForm.duracao_min}
              onChange={(e)=> setEditForm(f => ({ ...f, duracao_min: parseInt(e.target.value,10) }))}
              title="Duracao (min)"
            >
              {[15, 30, 45, 60, 75, 90, 120].map(m => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              placeholder="Preco"
              value={editPrecoStr}
              onChange={handleEditPrecoChange}
            />
            {pros.length > 0 && (
              <div className="grid" style={{ gap: 4 }}>
                <div className="muted" style={{ fontSize: 12 }}>Vincular profissionais</div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {pros.map((p) => (
                    <label key={p.id} className={`chip ${selectedProsEdit.includes(p.id) ? 'chip--active' : ''}`} style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        style={{ display: 'none' }}
                        checked={selectedProsEdit.includes(p.id)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSelectedProsEdit((curr) => checked ? Array.from(new Set([...curr, p.id])) : curr.filter((id) => id !== p.id));
                        }}
                      />
                      {p.nome}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn--outline" onClick={()=>setEditOpen(false)}>Cancelar</button>
            <button className="btn btn--primary" onClick={saveEdit} disabled={editSaving}>
              {editSaving ? <span className="spinner"/> : 'Salvar alteracoes'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ---------- Componentes auxiliares ---------- */

function SkeletonTable() {
  return (
    <table className="skeleton">
      <thead>
        <tr>
          <th>Nome</th>
          <th>Duracao</th>
          <th>Preco</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {[...Array(4)].map((_, i) => (
          <tr key={i}>
            <td>
              <div className="shimmer" style={{ width: "60%" }} />
            </td>
            <td>
              <div className="shimmer" style={{ width: "40%" }} />
            </td>
            <td>
              <div className="shimmer" style={{ width: "50%" }} />
            </td>
            <td>
              <div className="shimmer" style={{ width: "50%" }} />
            </td>
            <td>
              <div className="shimmer" style={{ width: "30%" }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Modal({ children, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
