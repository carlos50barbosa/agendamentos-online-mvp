import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../components/Modal.jsx';
import {
  IconChart,
  IconPlus,
  IconSearch,
  IconStar,
  IconUsers,
} from '../components/Icons.jsx';
import { Api, resolveAssetUrl } from '../utils/api';

const MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const DESCRIPTION_MAX_LENGTH = 200;
const STATUS_FILTERS = [
  { value: 'todos', label: 'Todos' },
  { value: 'ativos', label: 'Ativos' },
  { value: 'inativos', label: 'Inativos' },
];

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('file_read_error'));
    reader.readAsDataURL(file);
  });
}

function getInitials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return 'PR';
  return parts.map((part) => part[0]).join('').toUpperCase();
}

function getDescriptionLabel(value) {
  const description = String(value || '').trim();
  if (description) return description;
  return 'Adicione uma descricao curta para apresentar a especialidade e o estilo de atendimento.';
}

function ProfessionalFormFields({
  form,
  setForm,
  avatar,
  avatarInputRef,
  onAvatarChange,
  onAvatarClear,
}) {
  const descriptionLength = String(form.descricao || '').length;

  return (
    <div className="professionals-page__form">
      <div className="professionals-page__form-grid">
        <div className="professionals-page__form-column">
          <label className="professionals-page__field">
            <span className="professionals-page__label">Nome do profissional</span>
            <input
              className="input"
              placeholder="Ex.: Mariana Costa"
              value={form.nome}
              onChange={(event) => setForm((current) => ({ ...current, nome: event.target.value }))}
              maxLength={120}
              required
            />
          </label>

          <label className="professionals-page__field">
            <span className="professionals-page__label">Descricao profissional</span>
            <textarea
              className="input professionals-page__textarea"
              placeholder="Conte rapidamente quais servicos essa pessoa executa e como ela atende."
              value={form.descricao}
              onChange={(event) => setForm((current) => ({ ...current, descricao: event.target.value }))}
              rows={5}
              maxLength={DESCRIPTION_MAX_LENGTH}
            />
            <span className="professionals-page__counter">
              {descriptionLength}/{DESCRIPTION_MAX_LENGTH}
            </span>
          </label>
        </div>

        <div className="professionals-page__avatar-panel">
          <div className="professionals-page__avatar-panel-top">
            <div className={`professionals-page__avatar-preview${avatar.preview ? ' has-image' : ''}`}>
              {avatar.preview ? (
                <img src={avatar.preview} alt="Pre-visualizacao do avatar" />
              ) : (
                <span>{getInitials(form.nome)}</span>
              )}
            </div>

            <div className="professionals-page__avatar-copy">
              <strong>Foto de perfil</strong>
              <p>Perfis com imagem e descricao transmitem mais confianca para novos clientes.</p>
            </div>
          </div>

          <div className="professionals-page__upload-actions">
            <label className="btn btn--outline btn--sm professionals-page__upload-button">
              Selecionar imagem
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onAvatarChange}
              />
            </label>
            {avatar.preview && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={onAvatarClear}>
                Remover
              </button>
            )}
          </div>

          <small className="muted professionals-page__help">
            Formatos aceitos: PNG, JPG ou WEBP, com ate 2MB.
          </small>
        </div>
      </div>

      <div className="professionals-page__status-box">
        <div className="professionals-page__status-copy">
          <strong>{form.ativo ? 'Perfil ativo para operacao' : 'Perfil pausado temporariamente'}</strong>
          <p>Profissionais ativos ficam disponiveis para vinculo em servicos e organizacao da agenda.</p>
        </div>

        <div className="professionals-page__status-control">
          <span className={`chip ${form.ativo ? 'chip--status-active' : 'chip--status-default'}`}>
            {form.ativo ? 'Ativo' : 'Inativo'}
          </span>
          <label className="switch">
            <input
              type="checkbox"
              checked={Boolean(form.ativo)}
              onChange={(event) => setForm((current) => ({ ...current, ativo: event.target.checked }))}
            />
            <span />
          </label>
        </div>
      </div>
    </div>
  );
}

function ProfessionalsSkeleton() {
  return (
    <div className="professionals-page__grid">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="professionals-page__card professionals-page__card--skeleton">
          <div className="professionals-page__card-top">
            <div className="professionals-page__avatar professionals-page__avatar--skeleton">
              <div className="shimmer professionals-page__shimmer-fill" />
            </div>
            <div className="professionals-page__identity professionals-page__identity--stacked">
              <div className="professionals-page__nameblock">
                <div className="shimmer professionals-page__shimmer-line professionals-page__shimmer-line--title" />
                <div className="shimmer professionals-page__shimmer-line professionals-page__shimmer-line--meta" />
              </div>
              <div className="shimmer professionals-page__shimmer-pill" />
            </div>
          </div>
          <div className="shimmer professionals-page__shimmer-line" />
          <div className="shimmer professionals-page__shimmer-line professionals-page__shimmer-line--short" />
          <div className="professionals-page__meta">
            <div className="shimmer professionals-page__shimmer-box" />
            <div className="shimmer professionals-page__shimmer-box" />
            <div className="shimmer professionals-page__shimmer-box" />
          </div>
          <div className="professionals-page__card-actions">
            <div className="shimmer professionals-page__shimmer-button" />
            <div className="shimmer professionals-page__shimmer-button" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ProfissionaisEstabelecimento() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('todos');
  const [toast, setToast] = useState(null);

  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nome: '', descricao: '', ativo: true });
  const [newAvatar, setNewAvatar] = useState({ preview: null, dataUrl: null });
  const newAvatarInputRef = useRef(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ nome: '', descricao: '', ativo: true });
  const [editAvatar, setEditAvatar] = useState({ preview: null, dataUrl: null, remove: false });
  const editAvatarInputRef = useRef(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const toastTimerRef = useRef(null);

  function showToast(type, message, timeout = 5000) {
    setToast({ type, message });
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), timeout);
  }

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const rows = await Api.profissionaisList();
        if (!active) return;
        setList(Array.isArray(rows) ? rows : []);
      } catch {
        if (active) showToast('error', 'Falha ao carregar profissionais.');
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const statusCounts = useMemo(() => {
    const total = list.length;
    const activeCount = list.filter((item) => item?.ativo).length;
    return {
      todos: total,
      ativos: activeCount,
      inativos: Math.max(total - activeCount, 0),
    };
  }, [list]);

  const metrics = useMemo(() => {
    const activeCount = list.filter((item) => item?.ativo).length;
    const withPhotoCount = list.filter((item) => String(item?.avatar_url || '').trim()).length;
    const completeProfiles = list.filter(
      (item) => String(item?.avatar_url || '').trim() && String(item?.descricao || '').trim(),
    ).length;

    return [
      {
        key: 'total',
        label: 'Equipe cadastrada',
        value: list.length,
        help: list.length === 1 ? '1 perfil pronto para operar.' : `${list.length} perfis no cadastro.`,
        icon: IconUsers,
      },
      {
        key: 'active',
        label: 'Perfis ativos',
        value: activeCount,
        help: activeCount === 1 ? '1 profissional disponivel.' : `${activeCount} profissionais disponiveis.`,
        icon: IconChart,
      },
      {
        key: 'complete',
        label: 'Perfis completos',
        value: completeProfiles,
        help:
          completeProfiles === 1
            ? '1 perfil com foto e descricao.'
            : `${completeProfiles} perfis com foto e descricao.`,
        icon: IconStar,
      },
      {
        key: 'photo',
        label: 'Fotos configuradas',
        value: withPhotoCount,
        help:
          withPhotoCount === 1
            ? '1 profissional com avatar.'
            : `${withPhotoCount} profissionais com avatar.`,
        icon: IconUsers,
      },
    ];
  }, [list]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return [...list]
      .filter((item) => {
        if (statusFilter === 'ativos') return Boolean(item?.ativo);
        if (statusFilter === 'inativos') return !item?.ativo;
        return true;
      })
      .filter((item) => {
        if (!normalizedQuery) return true;
        const name = String(item?.nome || '').toLowerCase();
        const description = String(item?.descricao || '').toLowerCase();
        return name.includes(normalizedQuery) || description.includes(normalizedQuery);
      })
      .sort((left, right) => {
        const activeDelta = Number(Boolean(right?.ativo)) - Number(Boolean(left?.ativo));
        if (activeDelta !== 0) return activeDelta;
        return String(left?.nome || '').localeCompare(String(right?.nome || ''), 'pt-BR');
      });
  }, [list, query, statusFilter]);

  const hasFilters = Boolean(query.trim()) || statusFilter !== 'todos';
  const formInvalid = !String(form.nome || '').trim();
  const editInvalid = !String(editForm.nome || '').trim();

  function resetAddForm() {
    setForm({ nome: '', descricao: '', ativo: true });
    setNewAvatar({ preview: null, dataUrl: null });
    if (newAvatarInputRef.current) newAvatarInputRef.current.value = '';
  }

  function closeAdd() {
    if (saving) return;
    resetAddForm();
    setAddOpen(false);
  }

  function openEdit(professional) {
    setEditTarget(professional);
    setEditForm({
      nome: professional?.nome || '',
      descricao: professional?.descricao || '',
      ativo: Boolean(professional?.ativo),
    });
    setEditAvatar({
      preview: resolveAssetUrl(professional?.avatar_url || ''),
      dataUrl: null,
      remove: false,
    });
    if (editAvatarInputRef.current) editAvatarInputRef.current.value = '';
    setEditOpen(true);
  }

  function closeEdit() {
    if (editSaving) return;
    setEditOpen(false);
    setEditTarget(null);
    setEditForm({ nome: '', descricao: '', ativo: true });
    setEditAvatar({ preview: null, dataUrl: null, remove: false });
    if (editAvatarInputRef.current) editAvatarInputRef.current.value = '';
  }

  async function handleAvatarSelection(file, onSuccess) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'Envie uma imagem PNG, JPG ou WEBP.');
      return;
    }
    if (file.size > MAX_AVATAR_SIZE) {
      showToast('error', 'A imagem deve ter no maximo 2MB.');
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      onSuccess(dataUrl);
    } catch {
      showToast('error', 'Nao foi possivel ler a imagem.');
    }
  }

  async function handleNewAvatarChange(event) {
    const file = event.target.files?.[0];
    await handleAvatarSelection(file, (dataUrl) => {
      setNewAvatar({ preview: dataUrl, dataUrl });
    });
  }

  async function handleEditAvatarChange(event) {
    const file = event.target.files?.[0];
    await handleAvatarSelection(file, (dataUrl) => {
      setEditAvatar({ preview: dataUrl, dataUrl, remove: false });
    });
  }

  function clearNewAvatar() {
    setNewAvatar({ preview: null, dataUrl: null });
    if (newAvatarInputRef.current) newAvatarInputRef.current.value = '';
  }

  function clearEditAvatar() {
    setEditAvatar({ preview: null, dataUrl: null, remove: true });
    if (editAvatarInputRef.current) editAvatarInputRef.current.value = '';
  }

  async function addProfessional(event) {
    event.preventDefault();

    if (formInvalid) {
      showToast('error', 'Informe o nome do profissional.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        nome: form.nome.trim(),
        descricao: form.descricao?.trim() || null,
        ativo: Boolean(form.ativo),
      };

      if (newAvatar.dataUrl) payload.avatar = newAvatar.dataUrl;

      const created = await Api.profissionaisCreate(payload);
      setList((current) => [created, ...current]);
      showToast('success', 'Profissional cadastrado com sucesso.');
      closeAdd();
    } catch (error) {
      if (error?.status === 403 && error?.data?.error === 'plan_limit') {
        showToast('error', error?.data?.message || 'Limite do plano atingido.');
      } else if (error?.status === 402 && error?.data?.error === 'plan_delinquent') {
        showToast('error', 'Plano em atraso. Regularize para continuar.');
      } else if (error?.data?.error === 'avatar_invalido') {
        showToast('error', 'Envie uma imagem PNG, JPG ou WEBP.');
      } else if (error?.data?.error === 'avatar_grande') {
        showToast('error', 'A imagem deve ter no maximo 2MB.');
      } else {
        showToast('error', 'Erro ao cadastrar profissional.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();

    if (!editTarget) return;
    if (editInvalid) {
      showToast('error', 'Informe o nome do profissional.');
      return;
    }

    setEditSaving(true);
    try {
      const payload = {
        nome: editForm.nome.trim(),
        descricao: editForm.descricao?.trim() || null,
        ativo: Boolean(editForm.ativo),
      };

      if (editAvatar.dataUrl) payload.avatar = editAvatar.dataUrl;
      if (editAvatar.remove && !editAvatar.dataUrl) payload.avatarRemove = true;

      const updated = await Api.profissionaisUpdate(editTarget.id, payload);
      setList((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      showToast('success', 'Profissional atualizado.');
      closeEdit();
    } catch (error) {
      if (error?.data?.error === 'avatar_invalido') {
        showToast('error', 'Envie uma imagem PNG, JPG ou WEBP.');
      } else if (error?.data?.error === 'avatar_grande') {
        showToast('error', 'A imagem deve ter no maximo 2MB.');
      } else {
        showToast('error', 'Falha ao atualizar profissional.');
      }
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActive(professional) {
    if (!professional || togglingId === professional.id) return;

    setTogglingId(professional.id);
    try {
      const updated = await Api.profissionaisUpdate(professional.id, { ativo: !professional.ativo });
      setList((current) => current.map((item) => (item.id === updated.id ? updated : item)));

      if (editTarget?.id === professional.id) {
        setEditTarget(updated);
        setEditForm((current) => ({ ...current, ativo: Boolean(updated.ativo) }));
      }

      showToast('success', updated.ativo ? 'Profissional ativado.' : 'Profissional inativado.');
    } catch {
      showToast('error', 'Falha ao atualizar status.');
    } finally {
      setTogglingId(null);
    }
  }

  function openDeleteModal(professional) {
    setDeleteTarget(professional);
  }

  function closeDeleteModal() {
    if (deletingId) return;
    setDeleteTarget(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;

    const targetId = deleteTarget.id;
    setDeletingId(targetId);
    try {
      await Api.profissionaisDelete(targetId);
      setList((current) => current.filter((item) => item.id !== targetId));
      if (editTarget?.id === targetId) closeEdit();
      showToast('success', 'Profissional removido.');
      setDeleteTarget(null);
    } catch {
      showToast('error', 'Falha ao excluir profissional.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="grid professionals-page">
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}

      <section className="card professionals-page__hero">
        <div className="professionals-page__hero-top">
          <div className="professionals-page__hero-copy">
            <span className="professionals-page__eyebrow">Gestao da equipe</span>
            <h1 className="professionals-page__title">Profissionais</h1>
            <p className="professionals-page__subtitle">
              Organize a equipe, mantenha perfis bem apresentados e controle quem fica ativo para operar.
            </p>
          </div>

          <div className="professionals-page__hero-actions">
            <button className="btn btn--primary professionals-page__hero-button" type="button" onClick={() => setAddOpen(true)}>
              <IconPlus aria-hidden="true" />
              <span>Adicionar profissional</span>
            </button>
            <p className="professionals-page__hero-note">
              Perfis completos ajudam clientes a confiar mais na etapa de agendamento.
            </p>
          </div>
        </div>

        <div className="professionals-page__metrics">
          {metrics.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.key} className="professionals-page__metric-card">
                <div className="professionals-page__metric-icon">
                  <Icon aria-hidden="true" />
                </div>
                <div className="professionals-page__metric-content">
                  <span className="professionals-page__metric-label">{item.label}</span>
                  <strong className="professionals-page__metric-value">{item.value}</strong>
                  <small className="professionals-page__metric-help">{item.help}</small>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card professionals-page__panel">
        <div className="professionals-page__toolbar">
          <label className="professionals-page__search">
            <IconSearch className="professionals-page__search-icon" aria-hidden="true" />
            <input
              className="input professionals-page__search-input"
              placeholder="Buscar por nome ou descricao"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="professionals-page__filters" role="tablist" aria-label="Filtro de profissionais">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`professionals-page__filter${statusFilter === filter.value ? ' is-active' : ''}`}
                onClick={() => setStatusFilter(filter.value)}
              >
                <span>{filter.label}</span>
                <strong>{statusCounts[filter.value] || 0}</strong>
              </button>
            ))}
          </div>
        </div>

        <div className="professionals-page__summary">
          <span>
            Exibindo <strong>{filtered.length}</strong> de <strong>{list.length}</strong>{' '}
            {list.length === 1 ? 'profissional' : 'profissionais'}.
          </span>
          {hasFilters && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setQuery('');
                setStatusFilter('todos');
              }}
            >
              Limpar filtros
            </button>
          )}
        </div>

        {loading ? (
          <ProfessionalsSkeleton />
        ) : filtered.length === 0 ? (
          <div className="professionals-page__empty">
            <div className="professionals-page__empty-icon">
              <IconUsers aria-hidden="true" />
            </div>
            <h2>{list.length ? 'Nenhum resultado para os filtros atuais' : 'Monte sua equipe profissional'}</h2>
            <p>
              {list.length
                ? 'Ajuste a busca ou troque o filtro para encontrar o perfil desejado.'
                : 'Cadastre profissionais com foto, descricao e status operacional para manter o painel mais organizado.'}
            </p>
            <div className="professionals-page__empty-actions">
              {list.length ? (
                <button
                  type="button"
                  className="btn btn--outline"
                  onClick={() => {
                    setQuery('');
                    setStatusFilter('todos');
                  }}
                >
                  Mostrar todos
                </button>
              ) : (
                <button type="button" className="btn btn--primary" onClick={() => setAddOpen(true)}>
                  Adicionar primeiro profissional
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="professionals-page__grid">
            {filtered.map((professional) => {
              const avatarUrl = resolveAssetUrl(professional?.avatar_url || '');
              const hasPhoto = Boolean(avatarUrl);
              const hasDescription = Boolean(String(professional?.descricao || '').trim());
              const isComplete = hasPhoto && hasDescription;
              const isBusy = deletingId === professional.id || togglingId === professional.id;

              return (
                <article
                  key={professional.id}
                  className={`professionals-page__card${professional.ativo ? '' : ' is-inactive'}`}
                >
                  <div className="professionals-page__card-top">
                    <div className={`professionals-page__avatar${hasPhoto ? ' has-image' : ''}`}>
                      {hasPhoto ? (
                        <img src={avatarUrl} alt={`Foto de ${professional.nome}`} />
                      ) : (
                        <span>{getInitials(professional.nome)}</span>
                      )}
                    </div>

                    <div className="professionals-page__identity">
                      <div className="professionals-page__nameblock">
                        <h3>{professional.nome}</h3>
                        <div className="professionals-page__chips">
                          <span className={`chip ${professional.ativo ? 'chip--status-active' : 'chip--status-default'}`}>
                            {professional.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                          <span className="chip">{hasPhoto ? 'Com foto' : 'Sem foto'}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="btn btn--outline btn--sm"
                        onClick={() => openEdit(professional)}
                        disabled={isBusy}
                      >
                        Editar
                      </button>
                    </div>
                  </div>

                  <p className={`professionals-page__description${hasDescription ? '' : ' is-placeholder'}`}>
                    {getDescriptionLabel(professional.descricao)}
                  </p>

                  <div className="professionals-page__meta">
                    <div className="professionals-page__meta-card">
                      <span>Status</span>
                      <strong>{professional.ativo ? 'Disponivel' : 'Pausado'}</strong>
                    </div>
                    <div className="professionals-page__meta-card">
                      <span>Apresentacao</span>
                      <strong>{hasDescription ? 'Pronta' : 'Ajustar bio'}</strong>
                    </div>
                    <div className="professionals-page__meta-card">
                      <span>Perfil</span>
                      <strong>{isComplete ? 'Completo' : 'Em construcao'}</strong>
                    </div>
                  </div>

                  <div className="professionals-page__card-actions">
                    <button
                      type="button"
                      className={`btn btn--sm ${professional.ativo ? 'btn--outline' : 'btn--primary'}`}
                      onClick={() => toggleActive(professional)}
                      disabled={isBusy}
                    >
                      {togglingId === professional.id ? <span className="spinner" /> : professional.ativo ? 'Inativar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => openDeleteModal(professional)}
                      disabled={isBusy}
                    >
                      {deletingId === professional.id ? <span className="spinner" /> : 'Excluir'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {addOpen && (
        <Modal
          title="Novo profissional"
          onClose={saving ? undefined : closeAdd}
          closeButton={!saving}
          actions={[
            <button key="cancel" type="button" className="btn btn--outline" onClick={closeAdd} disabled={saving}>
              Cancelar
            </button>,
            <button
              key="submit"
              type="submit"
              form="professional-add-form"
              className="btn btn--primary"
              disabled={saving || formInvalid}
            >
              {saving ? <span className="spinner" /> : 'Salvar profissional'}
            </button>,
          ]}
        >
          <form id="professional-add-form" onSubmit={addProfessional}>
            <ProfessionalFormFields
              form={form}
              setForm={setForm}
              avatar={newAvatar}
              avatarInputRef={newAvatarInputRef}
              onAvatarChange={handleNewAvatarChange}
              onAvatarClear={clearNewAvatar}
            />
          </form>
        </Modal>
      )}

      {editOpen && editTarget && (
        <Modal
          title="Editar profissional"
          onClose={editSaving ? undefined : closeEdit}
          closeButton={!editSaving}
          actions={[
            <button
              key="delete"
              type="button"
              className="btn btn--danger"
              onClick={() => {
                closeEdit();
                openDeleteModal(editTarget);
              }}
              disabled={editSaving}
            >
              Excluir
            </button>,
            <button key="cancel" type="button" className="btn btn--outline" onClick={closeEdit} disabled={editSaving}>
              Cancelar
            </button>,
            <button
              key="submit"
              type="submit"
              form="professional-edit-form"
              className="btn btn--primary"
              disabled={editSaving || editInvalid}
            >
              {editSaving ? <span className="spinner" /> : 'Salvar alteracoes'}
            </button>,
          ]}
        >
          <form id="professional-edit-form" onSubmit={saveEdit}>
            <ProfessionalFormFields
              form={editForm}
              setForm={setEditForm}
              avatar={editAvatar}
              avatarInputRef={editAvatarInputRef}
              onAvatarChange={handleEditAvatarChange}
              onAvatarClear={clearEditAvatar}
            />
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title="Excluir profissional"
          onClose={deletingId ? undefined : closeDeleteModal}
          closeButton={!deletingId}
          actions={[
            <button
              key="cancel"
              type="button"
              className="btn btn--outline"
              onClick={closeDeleteModal}
              disabled={Boolean(deletingId)}
            >
              Cancelar
            </button>,
            <button
              key="confirm"
              type="button"
              className="btn btn--danger"
              onClick={confirmDelete}
              disabled={Boolean(deletingId)}
            >
              {deletingId ? <span className="spinner" /> : 'Excluir definitivamente'}
            </button>,
          ]}
        >
          <div className="professionals-page__delete-dialog">
            <p>
              Voce esta prestes a remover <strong>{deleteTarget.nome}</strong> do cadastro.
            </p>
            <p className="muted">
              Essa acao remove o perfil da equipe e pode impactar a organizacao da agenda vinculada.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
