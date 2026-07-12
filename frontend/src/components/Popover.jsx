// Botão que abre um painel ancorado. Existe para tirar da tela os controles que só são
// usados de vez em quando — mas quem colapsa filtro assume uma dívida: o que está ativo
// PRECISA continuar visível fora do painel, senão o usuário olha uma lista vazia sem
// entender por quê. Quem usa este componente é responsável por essa parte.
import React, { useEffect, useId, useRef, useState } from 'react';

export default function Popover({ label, badge = null, panelLabel, align = 'start', children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Devolve o foco ao botão: fechar com Esc não pode largar o foco no vazio.
      triggerRef.current?.focus();
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="popover" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`btn btn--sm popover__trigger ${badge || open ? '' : 'btn--outline'}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span>{label}</span>
        {badge ? <span className="popover__badge">{badge}</span> : null}
        <span className="popover__caret" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={panelId}
          className={`popover__panel popover__panel--${align}`}
          role="group"
          aria-label={panelLabel || label}
        >
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      )}
    </div>
  );
}
