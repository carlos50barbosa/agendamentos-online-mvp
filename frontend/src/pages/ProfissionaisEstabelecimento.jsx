import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Api, resolveAssetUrl } from '../utils/api';

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('file_read_error'));
    reader.readAsDataURL(file);
  });
}

export default function ProfissionaisEstabelecimento() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ nome: '', descricao: '', ativo: true });
  const [saving, setSaving] = useState(false);
  const [newAvatar, setNewAvatar] = useState({ preview: null, dataUrl: null });
  const newAvatarInputRef = useRef(null);

  const [query, setQuery] = useState('');
  const [toast, setToast] = useState(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ nome: '', descricao: '', ativo: true });
  const [editAvatar, setEditAvatar] = useState({ preview: null, dataUrl: null, remove: false });
  const editAvatarInputRef = useRef(null);
  const [editSaving, setEditSaving] = useState(false);

  function showToast(type, msg, ms = 2500) {
    setToast({ type, msg });
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), ms);
  }

  useEffect(() => {
    (async () => {
      try {
        const rows = await Api.profissionaisList();
        setList(rows || []);
      } catch {
        showToast('error', 'Falha ao carregar profissionais.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    let arr = Array.isArray(list) ? list : [];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      arr = arr.filter((p) => String(p?.nome || '').toLowerCase().includes(q));
    }
    return arr;
  }, [list, query]);

  const formInvalid = !form.nome.trim();

  async function handleAvatarSelection(file, onSuccess) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'Envie uma imagem PNG, JPG ou WEBP.');
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      showToast('error', 'A imagem deve ter no máximo 2MB.');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      onSuccess(dataUrl);
    } catch {
      showToast('error', 'Não foi possível ler a imagem.');
    }
  }

  async function handleNewAvatarChange(event) {
    const file = event.target.files?.[0];
    await handleAvatarSelection(file, (dataUrl) => {
      setNewAvatar({ preview: dataUrl, dataUrl });
    });
  }

  function clearNewAvatar() {
    setNewAvatar({ preview: null, dataUrl: null });
    if (newAvatarInputRef.current) newAvatarInputRef.current.value = '';
  }

  async function add(e) {
    e.preventDefault();
    if (formInvalid) {
      showToast('error', 'Informe o nome.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        nome: form.nome.trim(),
        descricao: form.descricao?.trim() || null,
        ativo: !!form.ativo,
      };
      if (newAvatar.dataUrl) payload.avatar = newAvatar.dataUrl;

      const novo = await Api.profissionaisCreate(payload);
      setList((curr) => [novo, ...curr]);
      setForm({ nome: '', descricao: '', ativo: true });
      clearNewAvatar();
      showToast('success', 'Profissional cadastrado!');
    } catch (err) {
      if (err?.status === 403 && err?.data?.error === 'plan_limit') {
        showToast('error', err?.data?.message || 'Limite do plano atingido.');
      } else if (err?.status === 402 && err?.data?.error === 'plan_delinquent') {
        showToast('error', 'Plano em atraso. Regularize para cadastrar.');
      } else if (err?.data?.error === 'avatar_invalido') {
        showToast('error', 'Envie uma imagem PNG, JPG ou WEBP.');
      } else if (err?.data?.error === 'avatar_grande') {
        showToast('error', 'A imagem deve ter no máximo 2MB.');
      } else {
        showToast('error', 'Erro ao cadastrar profissional.');
      }
    } finally {
      setSaving(false);
    }
  }

  function openEdit(profissional) {
    setEditTarget(profissional);
    setEditForm({
      nome: profissional?.nome || '',
      descricao: profissional?.descricao || '',
      ativo: !!profissional?.ativo,
    });
    setEditAvatar({ preview: resolveAssetUrl(profissional?.avatar_url || ''), dataUrl: null, remove: false });
    if (editAvatarInputRef.current) editAvatarInputRef.current.value = '';
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditTarget(null);
    setEditForm({ nome: '', descricao: '', ativo: true });
    setEditAvatar({ preview: null, dataUrl: null, remove: false });
    if (editAvatarInputRef.current) editAvatarInputRef.current.value = '';
  }

  async function handleEditAvatarChange(event) {
    const file = event.target.files?.[0];
    await handleAvatarSelection(file, (dataUrl) => {
      setEditAvatar({ preview: dataUrl, dataUrl, remove: false });
    });
  }

  function clearEditAvatar() {
    setEditAvatar({ preview: null, dataUrl: null, remove: true });
    if (editAvatarInputRef.current) editAvatarInputRef.current.value = '';
  }

  async function saveEdit(event) {
    event?.preventDefault();
    if (!editTarget) return;
    if (!editForm.nome.trim()) {
      showToast('error', 'Informe o nome.');
      return;
    }

    setEditSaving(true);
    try {
      const payload = {
        nome: editForm.nome.trim(),
        descricao: editForm.descricao?.trim() || null,
        ativo: !!editForm.ativo,
      };
      if (editAvatar.dataUrl) payload.avatar = editAvatar.dataUrl;
      if (editAvatar.remove && !editAvatar.dataUrl) payload.avatarRemove = true;

      const updated = await Api.profissionaisUpdate(editTarget.id, payload);
      setList((curr) => curr.map((item) => (item.id === updated.id ? updated : item)));
      showToast('success', 'Profissional atualizado.');
      closeEdit();
    } catch (err) {
      if (err?.data?.error === 'avatar_invalido') {
        showToast('error', 'Envie uma imagem PNG, JPG ou WEBP.');
      } else if (err?.data?.error === 'avatar_grande') {
        showToast('error', 'A imagem deve ter no máximo 2MB.');
      } else {
        showToast('error', 'Falha ao atualizar profissional.');
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(profissional) {
    try {
      const updated = await Api.profissionaisUpdate(profissional.id, { ativo: !profissional.ativo });
      setList((curr) => curr.map((x) => (x.id === profissional.id ? updated : x)));
    } catch {
      showToast('error', 'Falha ao atualizar status.');
    }
  }

  async function del(profissional) {
    if (!window.confirm(`Excluir ${profissional.nome}?`)) return;
    try {
      await Api.profissionaisDelete(profissional.id);
      setList((curr) => curr.filter((x) => x.id !== profissional.id));
      showToast('success', 'Profissional removido.');
    } catch {
      showToast('error', 'Falha ao excluir.');
    }
  }

  return (
    <div className="grid" style={{ gap: 16 }}>
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}

      <div className="card">
        <h2 style={{ marginBottom: 12 }}>Novo Profissional</h2>
        <form onSubmit={add} className="grid" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              placeholder="Nome"
              value={form.nome}
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
              maxLength={120}
              required
            />
            <input
              className="input"
              placeholder="Descrição (opcional)"
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
            />
            <label className="switch">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))} />
              <span>Ativo</span>
            </label>
          </div>

          <div className="grid" style={{ gap: 6 }}>
            <span className="muted" style={{ fontSize: 13 }}>Foto (opcional)</span>
            <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              {newAvatar.preview ? (
                <img
                  src={newAvatar.preview}
                  alt="Pré-visualização"
                  style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: '50%', border: '1px solid var(--border)' }}
                />
              ) : (
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px dashed var(--border)',
                    color: 'var(--muted)',
                    fontSize: 12,
                  }}
                >
                  Sem foto
                </div>
              )}
              <label className="btn btn--outline btn--sm" style={{ cursor: 'pointer' }}>
                Selecionar imagem
                <input
                  ref={newAvatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleNewAvatarChange}
                />
              </label>
              {newAvatar.preview && (
                <button type="button" className="btn btn--sm" onClick={clearNewAvatar}>
                  Remover
                </button>
              )}
            </div>
            <small className="muted" style={{ fontSize: 11 }}>Formatos aceitos: PNG, JPG ou WEBP (até 2MB).</small>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn btn--primary" disabled={saving || formInvalid}>
              {saving ? <span className="spinner" /> : 'Salvar'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="header-row" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2>Meus Profissionais</h2>
          <input className="input" placeholder="Buscar por nome..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {loading ? (
          <div className="empty">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="empty">Nenhum profissional encontrado.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Foto</th>
                <th>Nome</th>
                <th>Descrição</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td style={{ width: 70 }}>
                    {p.avatar_url ? (
                      <img
                        src={resolveAssetUrl(p.avatar_url)}
                        alt={`Foto de ${p.nome}`}
                        style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border)' }}
                      />
                    ) : (
                      <span className="muted" style={{ fontSize: 12 }}>Sem foto</span>
                    )}
                  </td>
                  <td>{p.nome}</td>
                  <td>{p.descricao || '-'}</td>
                  <td>
                    <button className={`badge service-status ${p.ativo ? 'ok' : 'out'}`} onClick={() => toggleActive(p)}>
                      {p.ativo ? 'Ativo' : 'Inativo'}
                    </button>
                  </td>
                  <td className="service-actions">
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button className="btn btn--outline" onClick={() => openEdit(p)}>
                        Editar
                      </button>
                      <button className="btn btn--danger" onClick={() => del(p)}>
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editOpen && (
        <Modal onClose={editSaving ? null : closeEdit}>
          <h3>Editar profissional</h3>
          <form onSubmit={saveEdit} className="grid" style={{ gap: 8, marginTop: 12 }}>
            <input
              className="input"
              placeholder="Nome"
              value={editForm.nome}
              onChange={(e) => setEditForm((f) => ({ ...f, nome: e.target.value }))}
              maxLength={120}
              required
            />
            <input
              className="input"
              placeholder="Descrição"
              value={editForm.descricao}
              onChange={(e) => setEditForm((f) => ({ ...f, descricao: e.target.value }))}
            />
            <label className="switch">
              <input type="checkbox" checked={editForm.ativo} onChange={(e) => setEditForm((f) => ({ ...f, ativo: e.target.checked }))} />
              <span>Ativo</span>
            </label>

            <div className="grid" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 13 }}>Foto</span>
              <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {editAvatar.preview ? (
                  <img
                    src={editAvatar.preview}
                    alt="Pré-visualização"
                    style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: '50%', border: '1px solid var(--border)' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px dashed var(--border)',
                      color: 'var(--muted)',
                      fontSize: 12,
                    }}
                  >
                    Sem foto
                  </div>
                )}
                <label className="btn btn--outline btn--sm" style={{ cursor: 'pointer' }}>
                  Selecionar imagem
                  <input
                    ref={editAvatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: 'none' }}
                    onChange={handleEditAvatarChange}
                  />
                </label>
                {(editAvatar.preview || editTarget?.avatar_url) && (
                  <button type="button" className="btn btn--sm" onClick={clearEditAvatar}>
                    Remover
                  </button>
                )}
              </div>
              <small className="muted" style={{ fontSize: 11 }}>Formatos aceitos: PNG, JPG ou WEBP (até 2MB).</small>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn btn--outline" onClick={closeEdit} disabled={editSaving}>
                Cancelar
              </button>
              <button type="submit" className="btn btn--primary" disabled={editSaving}>
                {editSaving ? <span className="spinner" /> : 'Salvar alterações'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose }) {
  const handleBackdrop = (event) => {
    if (event.target === event.currentTarget && typeof onClose === 'function') {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdrop}>
      <div className="modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}
