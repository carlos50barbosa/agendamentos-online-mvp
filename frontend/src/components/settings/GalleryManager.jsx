// src/components/settings/GalleryManager.jsx
// Galeria de fotos do estabelecimento, com noção explícita de CAPA (a 1ª foto).
// UX: dropzone (arrastar-e-soltar ou clicar), legenda/descrição só aparecem depois de escolher
// a foto (com preview), e a ordem pode ser mudada arrastando os cards — com ↑/↓ e "Tornar capa"
// como alternativa acessível. A capa é definida pela ordem: a primeira foto é a capa.
import React, { useEffect, useRef, useState } from 'react';
import { Api, resolveAssetUrl } from '../../utils/api';
import { compressImageToDataUrl, MAX_ENTRADA_BYTES } from '../../utils/imageCompress';
import './settings.css';

const MAX_BYTES = 3 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp';

function IconUpload(props) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v13" />
    </svg>
  );
}

function IconTrash(props) {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function GalleryManager({ establishmentId }) {
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(null); // { dataUrl, name, size }
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState(null); // id em ação, ou 'reorder'
  const [dragOver, setDragOver] = useState(false);
  const [dragFrom, setDragFrom] = useState(null);
  const [dragTo, setDragTo] = useState(null);
  const [msg, setMsg] = useState(null);
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
      try { await reload(); }
      catch { if (alive) setMsg({ type: 'error', message: 'Não foi possível carregar as fotos.' }); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [establishmentId]);

  // ---- seleção de arquivo (clique ou drop) ----
  const acceptFile = async (file) => {
    setMsg(null);
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setMsg({ type: 'error', message: 'Formato não aceito. Envie PNG, JPG ou WEBP.' });
      return;
    }
    if (file.size > MAX_ENTRADA_BYTES) {
      setMsg({ type: 'error', message: `A imagem tem ${formatSize(file.size)} — está grande demais para processar.` });
      return;
    }
    setBusy(true);
    try {
      // Comprime antes de medir contra MAX_BYTES: foto de celular so passa depois de reduzida.
      const { dataUrl, bytes } = await compressImageToDataUrl(file);
      if (bytes > MAX_BYTES) {
        setMsg({ type: 'error', message: `A imagem tem ${formatSize(bytes)} — o limite é 3 MB.` });
        return;
      }
      setPending({ dataUrl, name: file.name, size: bytes });
    } catch {
      setMsg({ type: 'error', message: 'Não foi possível ler a imagem.' });
    } finally {
      setBusy(false);
    }
  };

  const clearPending = () => {
    setPending(null); setTitulo(''); setDescricao('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer?.files?.[0]);
  };

  const add = async () => {
    if (!pending?.dataUrl) return;
    setBusy(true); setMsg(null);
    try {
      await Api.addEstablishmentImage(establishmentId, {
        image: pending.dataUrl,
        titulo: titulo.trim() || undefined,
        descricao: descricao.trim() || undefined,
      });
      clearPending();
      await reload();
      setMsg({ type: 'success', message: 'Foto adicionada.' });
    } catch (err) {
      setMsg({ type: 'error', message: err?.data?.message || 'Falha ao enviar a imagem.' });
    } finally { setBusy(false); }
  };

  // ---- ações sobre as fotos já enviadas ----
  const remove = async (id) => {
    if (!window.confirm('Remover esta foto da galeria?')) return;
    setActing(id); setMsg(null);
    try { await Api.deleteEstablishmentImage(establishmentId, id); await reload(); setMsg({ type: 'success', message: 'Foto removida.' }); }
    catch (err) { setMsg({ type: 'error', message: err?.data?.message || 'Falha ao remover a foto.' }); }
    finally { setActing(null); }
  };

  const applyOrder = async (order) => {
    setActing('reorder'); setMsg(null);
    try { await Api.reorderEstablishmentImages(establishmentId, order); await reload(); }
    catch { setMsg({ type: 'error', message: 'Falha ao reordenar as fotos.' }); }
    finally { setActing(null); }
  };

  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= images.length) return;
    const ids = images.map((i) => i.id);
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    applyOrder(ids);
  };

  const makeCover = (id) => applyOrder([id, ...images.filter((i) => i.id !== id).map((i) => i.id)]);

  // ---- reordenar arrastando ----
  const resetDrag = () => { setDragFrom(null); setDragTo(null); };
  const onCardDrop = (to) => {
    if (dragFrom == null || dragFrom === to) { resetDrag(); return; }
    const ids = images.map((i) => i.id);
    const [moved] = ids.splice(dragFrom, 1);
    ids.splice(to, 0, moved);
    resetDrag();
    applyOrder(ids);
  };

  if (!establishmentId) return <p className="muted">Disponível apenas para contas de estabelecimento.</p>;

  const isActing = acting != null;

  return (
    <div className="set-gal">
      {/* Área de envio: dropzone -> depois vira preview + campos */}
      {!pending ? (
        <div
          className={`set-drop${dragOver ? ' is-over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <IconUpload className="set-drop__icon" />
          <strong>Arraste uma foto aqui ou clique para escolher</strong>
          <span className="muted">PNG, JPG ou WEBP · até 3 MB</span>
        </div>
      ) : (
        <div className="set-gal__new">
          <img className="set-gal__new-thumb" src={pending.dataUrl} alt="Pré-visualização da foto escolhida" />
          <div className="set-gal__new-fields">
            <div className="set-gal__new-head">
              <span className="set-gal__new-name" title={pending.name}>{pending.name}</span>
              <span className="muted">{formatSize(pending.size)}</span>
            </div>
            <label className="label">
              <span>Legenda <em className="muted">(opcional)</em></span>
              <input className="input" maxLength={120} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Ambiente" />
            </label>
            <label className="label">
              <span>Descrição <em className="muted">(opcional)</em></span>
              <input className="input" maxLength={240} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Nossa recepção" />
            </label>
            <div className="set-gal__new-actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={clearPending} disabled={busy}>Cancelar</button>
              <button type="button" className="btn btn--primary btn--sm" onClick={add} disabled={busy}>
                {busy ? 'Enviando…' : 'Adicionar foto'}
              </button>
            </div>
          </div>
        </div>
      )}
      <input ref={fileRef} type="file" accept={ACCEPT} onChange={(e) => acceptFile(e.target.files?.[0])} style={{ display: 'none' }} />

      {msg && <div className={`notice notice--${msg.type}`} role="status">{msg.message}</div>}

      {/* Fotos já enviadas */}
      {loading ? (
        <div className="set-gal__grid">
          {[0, 1, 2].map((i) => <div key={i} className="set-gal__skeleton" />)}
        </div>
      ) : images.length === 0 ? (
        <div className="set-gal__empty">
          <strong>Nenhuma foto ainda</strong>
          <span className="muted">A primeira que você adicionar vira a capa da sua página pública.</span>
        </div>
      ) : (
        <>
          <p className="set-gal__count muted">
            {images.length === 1 ? '1 foto' : `${images.length} fotos`} · arraste para reordenar — a primeira é a capa.
          </p>

          <div className="set-gal__grid">
            {images.map((img, idx) => {
              const src = resolveAssetUrl(img.url);
              const isCover = idx === 0;
              return (
                <figure
                  key={img.id}
                  className={[
                    'set-gal__card',
                    isCover ? 'is-cover' : '',
                    dragFrom === idx ? 'is-dragging' : '',
                    dragTo === idx && dragFrom !== idx ? 'is-drop-target' : '',
                  ].filter(Boolean).join(' ')}
                  draggable={!isActing}
                  onDragStart={() => setDragFrom(idx)}
                  onDragOver={(e) => { e.preventDefault(); setDragTo(idx); }}
                  onDragLeave={() => setDragTo((t) => (t === idx ? null : t))}
                  onDrop={() => onCardDrop(idx)}
                  onDragEnd={resetDrag}
                >
                  <div className="set-gal__media">
                    {src
                      ? <img src={src} alt={img.titulo || 'Foto do estabelecimento'} loading="lazy" draggable={false} />
                      : <span className="muted">Imagem indisponível</span>}
                    {isCover && <span className="set-gal__badge">★ Capa</span>}
                  </div>

                  {(img.titulo || img.descricao) && (
                    <figcaption className="set-gal__cap">
                      {img.titulo && <strong>{img.titulo}</strong>}
                      {img.descricao && <span>{img.descricao}</span>}
                    </figcaption>
                  )}

                  <div className="set-gal__actions">
                    {!isCover && (
                      <button type="button" className="set-gal__link" onClick={() => makeCover(img.id)} disabled={isActing}>
                        Tornar capa
                      </button>
                    )}
                    <div className="set-gal__spacer" />
                    <button type="button" className="set-gal__icon" onClick={() => move(idx, -1)} disabled={isActing || idx === 0} title="Mover para trás" aria-label="Mover para trás">↑</button>
                    <button type="button" className="set-gal__icon" onClick={() => move(idx, 1)} disabled={isActing || idx === images.length - 1} title="Mover para frente" aria-label="Mover para frente">↓</button>
                    <button type="button" className="set-gal__icon set-gal__icon--danger" onClick={() => remove(img.id)} disabled={acting === img.id} title="Remover foto" aria-label="Remover foto">
                      <IconTrash />
                    </button>
                  </div>
                </figure>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
