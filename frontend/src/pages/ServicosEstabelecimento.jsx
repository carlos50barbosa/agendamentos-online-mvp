import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Api, resolveAssetUrl } from "../utils/api";

const MAX_SERVICE_IMAGE_SIZE = 2 * 1024 * 1024; // 2MB

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("file_read_error"));
    reader.readAsDataURL(file);
  });
}

export default function ServicosEstabelecimento() {
  // Lista
  const [list, setList] = useState([]);
  const [loadingList, setLoadingList] = useState(true);
  const [pros, setPros] = useState([]);

  // Formulario
  const [form, setForm] = useState({
    nome: "",
    descricao: "",
    duracao_min: 30,
    preco_centavos: 0,
    ativo: true,
  });
  const [precoStr, setPrecoStr] = useState("R$ 0,00");
  const [saving, setSaving] = useState(false);
  const [selectedProsNew, setSelectedProsNew] = useState([]);
  const [newImage, setNewImage] = useState({ preview: null, dataUrl: null });
  const [newImageError, setNewImageError] = useState('');
  const newImageInputRef = useRef(null);

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
  const [editForm, setEditForm] = useState({ nome: '', descricao: '', duracao_min: 30, preco_centavos: 0 });
  const [editPrecoStr, setEditPrecoStr] = useState('R$ 0,00');
  const [editSaving, setEditSaving] = useState(false);
  const [selectedProsEdit, setSelectedProsEdit] = useState([]);
  const [editImage, setEditImage] = useState({ preview: null, dataUrl: null, remove: false });
  const [editImageError, setEditImageError] = useState('');
  const editImageInputRef = useRef(null);

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
        showToast("error", "Não foi possível carregar os serviços.");
      } finally {
        setLoadingList(false);
      }
    })();
  }, []);

  // Banner de teste/plano: placeholder apenas no front usando localStorage
  const [trialInfo, setTrialInfo] = useState(null);
  useEffect(() => {
    const MAX_TRIAL_DAYS = 7;
    let active = true;
    (async () => {
      try {
        const response = await Api.billingSubscription();
        if (!active) return;
        const planData = response?.plan;
        const plan = planData?.plan || localStorage.getItem('plan_current') || 'starter';
        const end = planData?.trial?.ends_at || localStorage.getItem('trial_end') || null;
        const rawDaysLeft =
          typeof planData?.trial?.days_left === 'number'
            ? planData.trial.days_left
            : end
            ? Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000))
            : null;
        const daysLeft = rawDaysLeft == null ? null : Math.min(rawDaysLeft, MAX_TRIAL_DAYS);
        if (planData?.trial?.ends_at) {
          try {
            localStorage.setItem('trial_end', planData.trial.ends_at);
          } catch {}
        }
        setTrialInfo({ plan, end, daysLeft });
      } catch {
        try {
          const plan = localStorage.getItem('plan_current') || 'starter';
          const end = localStorage.getItem('trial_end');
          const fallbackDays = end ? Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000)) : null;
          if (active) setTrialInfo({ plan, end, daysLeft: fallbackDays == null ? null : Math.min(fallbackDays, MAX_TRIAL_DAYS) });
        } catch {}
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  const trialDaysLeft = useMemo(() => {
    if (typeof trialInfo?.daysLeft === 'number') return trialInfo.daysLeft;
    if (!trialInfo?.end) return 0;
    const diff = new Date(trialInfo.end).getTime() - Date.now();
    return Math.max(0, Math.min(7, Math.ceil(diff / 86400000)));
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

  async function handleImageSelection(file, onSuccess, setError) {
    if (!file) return false;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'Envie uma imagem PNG, JPG ou WEBP.');
      if (setError) setError('');
      return false;
    }
    if (file.size > MAX_SERVICE_IMAGE_SIZE) {
      if (setError) setError('Imagem maior que 2MB.');
      return false;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onSuccess(dataUrl);
      if (setError) setError('');
      return true;
    } catch {
      showToast('error', 'Nao foi possivel ler a imagem.');
      if (setError) setError('');
      return false;
    }
  }

  async function handleNewImageChange(event) {
    const file = event.target.files?.[0];
    const ok = await handleImageSelection(file, (dataUrl) => {
      setNewImage({ preview: dataUrl, dataUrl });
    }, setNewImageError);
    if (!ok && newImageInputRef.current) newImageInputRef.current.value = '';
  }

  function clearNewImage() {
    setNewImage({ preview: null, dataUrl: null });
    setNewImageError('');
    if (newImageInputRef.current) newImageInputRef.current.value = '';
  }

  async function handleEditImageChange(event) {
    const file = event.target.files?.[0];
    const ok = await handleImageSelection(file, (dataUrl) => {
      setEditImage({ preview: dataUrl, dataUrl, remove: false });
    }, setEditImageError);
    if (!ok && editImageInputRef.current) editImageInputRef.current.value = '';
  }

  function clearEditImage() {
    setEditImage({ preview: null, dataUrl: null, remove: true });
    setEditImageError('');
    if (editImageInputRef.current) editImageInputRef.current.value = '';
  }

  // Validacao simples
  const formMissingFields =
    !form.nome.trim() ||
    form.duracao_min <= 0 ||
    form.preco_centavos <= 0 ||
    !Array.isArray(selectedProsNew) ||
    !selectedProsNew.length;
  const formInvalid = formMissingFields || !!newImageError;

  async function add(e) {
    e.preventDefault();
    if (formInvalid) {
      if (newImageError) {
        showToast('error', newImageError);
      } else {
        showToast("error", "Preencha nome, duração, preço e selecione pelo menos um profissional.");
      }
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nome: form.nome.trim(),
        descricao: form.descricao?.trim() || null,
        duracao_min: form.duracao_min,
        preco_centavos: form.preco_centavos,
        ativo: form.ativo,
      };
      if (newImage.dataUrl) payload.imagem = newImage.dataUrl;
      payload.professionalIds = selectedProsNew;
      const novo = await Api.servicosCreate(payload);
      setList((curr) => [novo, ...curr]);
      setForm({ nome: "", descricao: "", duracao_min: 30, preco_centavos: 0, ativo: true });
      setPrecoStr("R$ 0,00");
      setSelectedProsNew([]);
      clearNewImage();
      showToast("success", "Serviço cadastrado!");
    } catch (err) {
      if (err?.data?.error === 'plan_limit') {
        setPlanLimitMessage(err?.message || 'Seu plano atual não permite adicionar mais serviços. Atualize o plano para continuar.');
        setPlanLimitOpen(true);
      } else if (err?.data?.error === 'missing_professionals') {
        showToast('error', err?.data?.message || 'Selecione pelo menos um profissional.');
      } else if (err?.data?.error === 'imagem_invalida') {
        showToast('error', 'Envie uma imagem PNG, JPG ou WEBP.');
      } else if (err?.data?.error === 'imagem_grande' || err?.status === 413) {
        setNewImageError('Imagem maior que 2MB.');
      } else if (err?.data?.message) {
        showToast('error', err.data.message);
      } else {
        showToast("error", "Erro ao salvar o serviço.");
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
    setEditForm({
      nome: svc.nome || '',
      descricao: svc.descricao || '',
      duracao_min: svc.duracao_min || 30,
      preco_centavos: svc.preco_centavos || 0,
    });
    setEditPrecoStr(formatBRL(svc.preco_centavos || 0));
    const profIds = Array.isArray(svc.professionals) ? svc.professionals.map(p => p.id) : [];
    setSelectedProsEdit(profIds);
    setEditImage({ preview: resolveAssetUrl(svc.imagem_url || ''), dataUrl: null, remove: false });
    setEditImageError('');
    if (editImageInputRef.current) editImageInputRef.current.value = '';
    setEditOpen(true);
  }

  const editInvalid =
    !editForm.nome.trim() ||
    !editForm.duracao_min ||
    !editForm.preco_centavos ||
    !Array.isArray(selectedProsEdit) ||
    !selectedProsEdit.length ||
    !!editImageError;

  async function saveEdit(){
    if (!editItem) return;
    if (editImageError) {
      showToast('error', editImageError);
      return;
    }
    if (
      !editForm.nome.trim() ||
      !editForm.duracao_min ||
      !editForm.preco_centavos ||
      !Array.isArray(selectedProsEdit) ||
      !selectedProsEdit.length
    ){
      showToast('error', 'Preencha nome, duração, preço e selecione pelo menos um profissional.');
      return;
    }
    setEditSaving(true);
    try{
      const payload = {
        nome: editForm.nome.trim(),
        descricao: editForm.descricao?.trim() || null,
        duracao_min: editForm.duracao_min,
        preco_centavos: editForm.preco_centavos,
      };
      if (editImage.dataUrl) payload.imagem = editImage.dataUrl;
      if (editImage.remove && !editImage.dataUrl) payload.imagemRemove = true;
      if (Array.isArray(selectedProsEdit)) payload.professionalIds = selectedProsEdit;
      const updated = await Api.servicosUpdate(editItem.id, payload);
      setList(curr => curr.map(x => x.id === editItem.id ? { ...x, ...updated } : x));
      setEditOpen(false);
      setEditItem(null);
      showToast('success', 'Serviço atualizado.');
    }catch(e){
      if (e?.data?.error === 'imagem_invalida') {
        showToast('error', 'Envie uma imagem PNG, JPG ou WEBP.');
      } else if (e?.data?.error === 'imagem_grande' || e?.status === 413) {
        setEditImageError('Imagem maior que 2MB.');
      } else {
        showToast('error', 'Falha ao atualizar o serviço.');
      }
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
      arr = arr.filter((s) => {
        const nomeMatch = s.nome?.toLowerCase().includes(q);
        const descMatch = s.descricao?.toLowerCase().includes(q);
        return nomeMatch || descMatch;
      });
    }
    if (statusFilter !== "todos") {
      const target = statusFilter === "ativos";
      arr = arr.filter((s) => !!s.ativo === target);
    }
    return arr;
  }, [list, query, statusFilter]);

  return (
    <div className="grid" style={{ gap: 16 }}>
      {trialInfo && trialInfo.plan === 'starter' && trialDaysLeft > 0 && (
        <div className="card box--highlight" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong>Teste grátis ativo</strong>
              <div className="small muted">{trialDaysLeft} {trialDaysLeft === 1 ? 'dia restante' : 'dias restantes'}</div>
            </div>
          </div>
          <Link className="btn btn--primary btn--sm" to="/planos" style={{ minWidth: 120, textAlign: 'center' }}>Experimentar Pro</Link>
        </div>
      )}
      {/* Toast */}
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}

      {/* Novo Serviço */}
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Novo Serviço</h2>
          <form onSubmit={add} className="service-form">
            <input
              className="input"
              placeholder="Nome do serviço"
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              maxLength={80}
            />
            <textarea
              className="input"
              placeholder="Descrição (opcional)"
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
              rows={3}
              maxLength={200}
            />

            <div className="service-form__image">
              <span className="service-form__label">Imagem (opcional)</span>
              <div className="service-form__image-row">
                {newImage.preview ? (
                  <img
                    src={newImage.preview}
                    alt="Pre-visualizacao"
                    className="service-form__image-preview"
                  />
                ) : (
                  <div className="service-form__image-fallback">Sem imagem</div>
                )}
                <label className="btn btn--outline btn--sm" style={{ cursor: 'pointer' }}>
                  Selecionar imagem
                  <input
                    ref={newImageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={handleNewImageChange}
                  />
                </label>
                {newImage.preview && (
                  <button type="button" className="btn btn--sm" onClick={clearNewImage}>
                    Remover
                  </button>
                )}
              </div>
              <small className="muted" style={{ fontSize: 11 }}>Formatos aceitos: PNG, JPG ou WEBP (ate 2MB).</small>
              {newImageError && <div className="service-form__error">{newImageError}</div>}
            </div>

            <div className="service-form__meta">
              <div className="service-form__field">
                <label className="service-form__label">Preço</label>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  placeholder="R$ 0,00"
                  value={precoStr}
                  onChange={handlePrecoChange}
                />
              </div>
              <div className="service-form__field">
                <label className="service-form__label">Duração</label>
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
              </div>
              <label className="service-form__toggle">
                <span>Ativo</span>
                <label className="switch" style={{ margin: 0 }}>
                  <input
                    type="checkbox"
                    checked={form.ativo}
                    onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
                  />
                  <span />
                </label>
              </label>
            </div>

            {pros.length > 0 && (
              <div className="grid" style={{ gap: 6, width: '100%', marginTop: 2 }}>
                <div className="service-form__label" style={{ color: 'var(--muted)' }}>Vincular profissionais</div>
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
          {formMissingFields && (
            <small
              className="muted"
              style={{
                color: "#b42318",
                fontWeight: 700,
                background: "#fee4e2",
                padding: "8px 10px",
                borderRadius: 6,
                display: "inline-block",
                marginTop: 6,
              }}
            >
              Preencha todos os campos e escolha pelo menos um profissional para
              cadastrar o serviço.
            </small>
          )}
        </div>

      {/* Meus Serviços */}
      <div className="card">
        <div className="header-row" style={{ display: "flex", gap: 8, alignItems: "flex-start", flexDirection: "column", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>Meus Serviços</h2>
          <div className="filters" style={{ display: "flex", gap: 8, flexWrap: 'wrap' }}>
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
            <div className="services-list">
              {filtered.map((s) => {
                const imageUrl = resolveAssetUrl(s.imagem_url || '');
                const description = String(s.descricao || '').trim();
                return (
                  <div key={s.id} className={`mini-card service-card ${s._updating ? "is-updating" : ""}`}>
                    <div className="mini-card__content">
                      {imageUrl ? (
                        <div className="mini-card__media">
                          <img src={imageUrl} alt={`Imagem do servico ${s.nome}`} />
                        </div>
                      ) : (
                        <div className="mini-card__media service-card__media--empty">
                          <span>Sem imagem</span>
                        </div>
                      )}
                      <div className="mini-card__main">
                        <div className="mini-card__title">{s.nome}</div>
                        {description && (
                          <div className="mini-card__description">{description}</div>
                        )}
                        <div className="service-card__meta">
                          <div className="service-card__price">{formatBRL(s.preco_centavos ?? 0)}</div>
                          <div className="service-card__duration">{s.duracao_min} min</div>
                        </div>
                      </div>
                    </div>
                    <div className="service-card__footer">
                      <button
                        className={`badge service-status ${s.ativo ? "ok" : "out"}`}
                        title="Clique para alternar"
                        onClick={() => toggleAtivo(s)}
                        disabled={!!s._updating}
                      >
                        {s.ativo ? "Ativo" : "Inativo"}
                      </button>
                      <div className="service-card__actions">
                        <button
                          className="btn btn--outline btn--sm"
                          onClick={() => openEdit(s)}
                          disabled={!!s._updating}
                        >
                          Editar
                        </button>
                        <button
                          className="btn btn--danger btn--sm"
                          onClick={() => askDelete(s)}
                          disabled={!!s._updating}
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

          </>
        )}
      </div>

      {/* Modal de confirmacao */}
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

      {/* Modal de edicao */}
      {planLimitOpen && (
        <Modal onClose={() => setPlanLimitOpen(false)}>
          <h3>Atualize seu plano</h3>
          <p>
            {planLimitMessage || 'Seu plano atual (Starter) permite cadastrar ate 10 serviços. Para adicionar novos serviços, migre para o plano Pro ou Premium.'}
          </p>
          <p className="muted">
            Acesse <strong>Configurações &gt; Planos</strong> ou utilize os botões abaixo para mudar de plano.
          </p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Link className="btn btn--outline" to="/configuracoes" onClick={() => setPlanLimitOpen(false)}>Ir para Configurações</Link>
            <Link className="btn btn--primary" to="/planos" onClick={() => setPlanLimitOpen(false)}>Ver planos</Link>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn--sm" onClick={() => setPlanLimitOpen(false)}>Fechar</button>
          </div>
        </Modal>
      )}

      {editOpen && (
        <Modal onClose={() => setEditOpen(false)}>
          <h3>Editar serviço</h3>
          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
            <input
              className="input"
              placeholder="Nome do serviço"
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
            <textarea
              className="input"
              placeholder="Descrição (opcional)"
              value={editForm.descricao}
              onChange={(e) => setEditForm((f) => ({ ...f, descricao: e.target.value }))}
              rows={2}
              maxLength={200}
              style={{ minHeight: 64 }}
            />
            <div className="service-form__image service-form__image--modal">
              <span className="service-form__label">Imagem (opcional)</span>
              <div className="service-form__image-row">
                {editImage.preview ? (
                  <img
                    src={editImage.preview}
                    alt="Pre-visualizacao"
                    className="service-form__image-preview"
                  />
                ) : (
                  <div className="service-form__image-fallback">Sem imagem</div>
                )}
                <label className="btn btn--outline btn--sm" style={{ cursor: 'pointer' }}>
                  Selecionar imagem
                  <input
                    ref={editImageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={handleEditImageChange}
                  />
                </label>
                {(editImage.preview || editItem?.imagem_url) && (
                  <button type="button" className="btn btn--sm" onClick={clearEditImage}>
                    Remover
                  </button>
                )}
              </div>
              <small className="muted" style={{ fontSize: 11 }}>Formatos aceitos: PNG, JPG ou WEBP (ate 2MB).</small>
              {editImageError && <div className="service-form__error">{editImageError}</div>}
            </div>
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
            <button className="btn btn--primary" onClick={saveEdit} disabled={editSaving || editInvalid}>
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
    <div className="services-list">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="mini-card service-card">
          <div className="mini-card__content">
            <div className="mini-card__media">
              <div className="shimmer" style={{ width: "100%", height: "100%" }} />
            </div>
            <div className="mini-card__main">
              <div className="shimmer" style={{ width: "50%", height: 14 }} />
              <div className="shimmer" style={{ width: "80%", height: 12 }} />
              <div className="shimmer" style={{ width: "40%", height: 12 }} />
            </div>
          </div>
          <div className="service-card__footer">
            <div className="shimmer pill" style={{ width: 80 }} />
            <div className="service-card__actions">
              <div className="shimmer" style={{ width: 70, height: 28, borderRadius: 10 }} />
              <div className="shimmer" style={{ width: 70, height: 28, borderRadius: 10 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
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
