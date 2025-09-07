import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Api } from "../utils/api";

export default function ServicosEstabelecimento() {
  // Lista
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);

  // Formulário
  const [form, setForm] = useState({
    nome: "",
    duracao_min: 30,
    preco_centavos: 0,
    ativo: true,
  });
  const [precoStr, setPrecoStr] = useState("R$ 0,00");
  const [saving, setSaving] = useState(false);

  // UI extras
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos"); // todos|ativos|inativos

  // Excluir
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  // Toast
  const [toast, setToast] = useState(null); // {type:'success'|'error'|'info', msg:string}
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
      } catch (e) {
        showToast("error", "Não foi possível carregar os serviços.");
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

  // Helpers de preço (BRL)
  const formatBRL = (centavos) =>
    (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function handlePrecoChange(e) {
    const digits = e.target.value.replace(/\D/g, ""); // apenas números
    const centavos = parseInt(digits || "0", 10);
    setForm((f) => ({ ...f, preco_centavos: centavos }));
    setPrecoStr(formatBRL(centavos));
  }

  // Validação simples
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
      const novo = await Api.servicosCreate(form);
      setList((curr) => [novo, ...curr]);
      setForm({ nome: "", duracao_min: 30, preco_centavos: 0, ativo: true });
      setPrecoStr("R$ 0,00");
      showToast("success", "Serviço cadastrado!");
    } catch (err) {
      showToast("error", "Erro ao salvar o serviço.");
    } finally {
      setSaving(false);
    }
  }

  // Confirmação de exclusão
  function askDelete(svc) {
    setToDelete(svc);
    setConfirmOpen(true);
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
      showToast("success", "Serviço excluído.");
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
      showToast("success", `Serviço ${novoAtivo ? "ativado" : "inativado"}.`);
    } catch (e) {
      setList(prev);
      showToast("error", "Não foi possível atualizar o status.");
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
                <strong>Teste grátis ativo</strong>
                <div className="small muted">{trialDaysLeft} {trialDaysLeft === 1 ? 'dia restante' : 'dias restantes'}</div>
              </div>
            </div>
            <Link className="btn btn--primary btn--sm" to="/planos">Experimentar Pro</Link>
          </div>
        ) : (
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderColor: '#fde68a', background: '#fffbeb' }}>
            <div>
              <strong>Seu período de teste terminou</strong>
              <div className="small muted">Desbloqueie WhatsApp, relatórios avançados e mais com o Pro.</div>
            </div>
            <Link className="btn btn--outline btn--sm" to="/planos">Conhecer planos</Link>
          </div>
        )
      )}
      {/* Toast */}
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}

      {/* Novo Serviço */}
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
            title="Duração (min)"
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
            placeholder="Preço"
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

          <button className="btn btn--primary" disabled={saving || formInvalid}>
            {saving ? <span className="spinner" /> : "Salvar"}
          </button>
        </form>

        {/* Dica de validação */}
        {formInvalid && (
          <small className="muted">
            Preencha nome, selecione duração e informe um preço maior que zero.
          </small>
        )}
      </div>

      {/* Meus Serviços */}
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
              placeholder="Buscar por nome…"
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
              {filtered.length === 1 ? "serviço" : "serviços"}.
            </div>
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Duração</th>
                  <th>Preço</th>
                  <th>Status</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className={s._updating ? "updating" : ""}>
                    <td>{s.nome}</td>
                    <td>{s.duracao_min} min</td>
                    <td>{formatBRL(s.preco_centavos ?? 0)}</td>
                    <td>
                      <button
                        className={`badge ${s.ativo ? "ok" : "out"}`} // 'off' -> 'out'
                        title="Clique para alternar"
                        onClick={() => toggleAtivo(s)}
                        disabled={!!s._updating}
                      >
                        {s.ativo ? "Ativo" : "Inativo"}
                      </button>
                    </td>
                    <td className="table-actions" style={{ textAlign: "right" }}>
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

      {/* Modal de confirmação */}
      {confirmOpen && (
        <Modal onClose={() => setConfirmOpen(false)}>
          <h3>Excluir serviço?</h3>
          <p>
            Tem certeza que deseja excluir <b>{toDelete?.nome}</b>? Esta ação não
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
          <th>Duração</th>
          <th>Preço</th>
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
