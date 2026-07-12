// src/components/settings/GalleryManager.jsx
// Galeria de fotos do estabelecimento com noção explícita de CAPA (a 1ª foto).
// Auto-carrega via Api.listEstablishmentImages; adiciona/remove/reordena com feedback próprio.
// A capa é definida pela ordem: "Tornar capa" move a foto para a 1ª posição.
import React, { useEffect, useRef, useState } from 'react';
import { Api, resolveAssetUrl } from '../../utils/api';

const MAX_BYTES = 3 * 1024 * 1024;

export default function GalleryManager({ establishmentId }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null); // { dataUrl, name }
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [busy, setBusy] = useState(false);
  const [actingId, setActingId] = useState(null); // id em remoção, ou 'reorder'
  const [msg, setMsg] = useState(null); // { type, message }
  const fileRef = useRef(null);

  const reload = async () => {
    const r = await Api.listEstablishmentImages(establishmentId);
    const list = Array.isArray(r?.images) ? r.images.slice() : [];
    list.sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || (a.id || 0) - (b.id || 0));
    setImages(list);
  };

  useEffect(() => {
    let alive = true;
    if (!establishmentId) { setLoading(false); return () => {}; }
    (async () => {
      setLoading(true);
      try { await reload(); } catch { if (alive) setMsg({ type: 'error', message: 'Não foi possível carregar as fotos.' }); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [establishmentId]);

  const onPick = (e) => {
    setMsg(null);
    const f = e.target.files?.[0];
    if (!f) { setPreview(null); return; }
    if (f.size > MAX_BYTES) {
      setMsg({ type: 'error', message: 'A imagem deve ter no máximo 3 MB.' });
      e.target.value = ''; setPreview(null); return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview({ dataUrl: reader.result, name: f.name });
    reader.onerror = () => setMsg({ type: 'error', message: 'Não foi possível ler a imagem.' });
    reader.readAsDataURL(f);
  };

  const add = async () => {
    if (!preview?.dataUrl) { setMsg({ type: 'error', message: 'Escolha uma imagem.' }); return; }
    setBusy(true); setMsg(null);
    try {
      await Api.addEstablishmentImage(establishmentId, {
        image: preview.dataUrl,
        titulo: titulo.trim() || undefined,
        descricao: descricao.trim() || undefined,
      });
      setPreview(null); setTitulo(''); setDescricao('');
      if (fileRef.current) fileRef.current.value = '';
      await reload();
      setMsg({ type: 'success', message: 'Foto adicionada.' });
    } catch (err) {
      setMsg({ type: 'error', message: err?.data?.message || 'Falha ao enviar a imagem.' });
    } finally { setBusy(false); }
  };

  const remove = async (id) => {
    if (!window.confirm('Remover esta foto da galeria?')) return;
    setActingId(id); setMsg(null);
    try { await Api.deleteEstablishmentImage(establishmentId, id); await reload(); setMsg({ type: 'success', message: 'Foto removida.' }); }
    catch (err) { setMsg({ type: 'error', message: err?.data?.message || 'Falha ao remover a foto.' }); }
    finally { setActingId(null); }
  };

  const applyOrder = async (order) => {
    setActingId('reorder'); setMsg(null);
    try { await Api.reorderEstablishmentImages(establishmentId, order); await reload(); }
    catch { setMsg({ type: 'error', message: 'Falha ao reordenar as fotos.' }); }
    finally { setActingId(null); }
  };

  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= images.length) return;
    const ids = images.map((i) => i.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    applyOrder(ids);
  };

  const makeCover = (id) => applyOrder([id, ...images.filter((i) => i.id !== id).map((i) => i.id)]);

  if (!establishmentId) return <p className="muted">Disponível apenas para contas de estabelecimento.</p>;

  const acting = actingId != null;

  return (
    <div className="set-gallery">
      <div className="set-gallery__add">
        <label className="set-file">
          <span className="set-file__label">Escolher foto</span>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onPick} disabled={busy} />
        </label>
        <label className="label"><span>Legenda <em className="muted">(opcional)</em></span>
          <input className="input" maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Ambiente" />
        </label>
        <label className="label"><span>Descrição <em className="muted">(opcional)</em></span>
          <input className="input" maxLength={240} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Nossa recepção" />
        </label>
        <button type="button" className="btn btn--primary btn--sm" onClick={add} disabled={busy || !preview}>
          {busy ? 'Enviando…' : 'Adicionar foto'}
        </button>
      </div>

      <p className="set-gallery__hint muted">
        PNG, JPG ou WEBP · até 3 MB. A <strong>primeira foto é a capa</strong> da sua página pública.
      </p>

      {preview && (
        <div className="set-gallery__preview">
          <img src={preview.dataUrl} alt="Pré-visualização" />
          <span className="muted">{preview.name}</span>
        </div>
      )}

      {msg && <div className={`notice notice--${msg.type}`} role="status">{msg.message}</div>}

      {loading ? (
        <p className="muted">Carregando fotos…</p>
      ) : images.length === 0 ? (
        <div className="set-gallery__empty">Nenhuma foto ainda. Adicione a primeira — ela será a capa da página pública.</div>
      ) : (
        <div className="set-gallery__grid">
          {images.map((img, idx) => {
            const src = resolveAssetUrl(img.url);
            return (
              <figure key={img.id} className="set-card">
                <div className="set-card__media">
                  {src ? <img src={src} alt={img.titulo || 'Foto do estabelecimento'} loading="lazy" /> : <span className="muted">Imagem indisponível</span>}
                  {idx === 0 && <span className="set-card__cover">★ Capa</span>}
                </div>
                {(img.titulo || img.descricao) && (
                  <figcaption className="set-card__cap">
                    {img.titulo && <strong>{img.titulo}</strong>}
                    {img.descricao && <span>{img.descricao}</span>}
                  </figcaption>
                )}
                <div className="set-card__actions">
                  {idx !== 0 && (
                    <button type="button" className="btn btn--outline btn--sm" onClick={() => makeCover(img.id)} disabled={acting}>Tornar capa</button>
                  )}
                  <button type="button" className="btn btn--sm set-icon" onClick={() => move(idx, -1)} disabled={acting || idx === 0} aria-label="Mover para cima" title="Subir">↑</button>
                  <button type="button" className="btn btn--sm set-icon" onClick={() => move(idx, 1)} disabled={acting || idx === images.length - 1} aria-label="Mover para baixo" title="Descer">↓</button>
                  <button type="button" className="btn btn--sm set-danger" onClick={() => remove(img.id)} disabled={actingId === img.id}>
                    {actingId === img.id ? '…' : 'Remover'}
                  </button>
                </div>
              </figure>
            );
          })}
        </div>
      )}
    </div>
  );
}
