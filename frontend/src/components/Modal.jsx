// src/components/Modal.jsx

import React, { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({

  title,

  children,

  onClose,

  actions,

  closeButton = false,

  disableOutsideClick = false,

  bodyClassName = '',

}) {

  const bodyClass = bodyClassName ? `modal__body ${bodyClassName}` : 'modal__body';
  const hasTitle = Boolean(title);
  const headerClass = hasTitle ? 'modal__header' : 'modal__header modal__header--compact';
  const dialogRef = useRef(null);

  // Gestão de foco (padrão de diálogo acessível): ao abrir, leva o foco para dentro;
  // prende o Tab no modal; ao fechar, devolve o foco a quem abriu. Mount-only (deps [])
  // para não "roubar" o foco em re-renders do consumidor.
  useEffect(() => {
    const prevFocus = typeof document !== 'undefined' ? document.activeElement : null;
    const node = dialogRef.current;
    if (node) {
      const first = node.querySelector(FOCUSABLE);
      (first || node).focus();
    }
    const onKeyDown = (event) => {
      if (event.key !== 'Tab' || !node) return;
      const items = node.querySelectorAll(FOCUSABLE);
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // Se o foco escapar do diálogo (ex.: um botão focado é desmontado ao alternar um
    // formulário interno), traz o foco de volta para dentro do modal.
    const onFocusIn = (event) => {
      if (node && !node.contains(event.target)) {
        const first = node.querySelector(FOCUSABLE);
        (first || node).focus();
      }
    };
    node?.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      node?.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      if (prevFocus instanceof HTMLElement) prevFocus.focus();
    };
  }, []);


  const handleBackdropClick = (event) => {

    if (disableOutsideClick) {

      event.stopPropagation();

      return;

    }

    if (typeof onClose === 'function') onClose(event);

  };



  return (

    <div className="modal-backdrop" role="presentation" onClick={handleBackdropClick}>

      <div

        className="modal"

        role="dialog"

        aria-modal="true"

        aria-label={title || 'Diálogo'}

        ref={dialogRef}

        tabIndex={-1}

        onClick={(e) => e.stopPropagation()}

      >

        {(title || closeButton) && (
          <div className={headerClass}>
            {title ? <h3 className="modal__title">{title}</h3> : <span aria-hidden="true" />}
            {closeButton && (

              <button type="button" className="modal__close" onClick={onClose} aria-label="Fechar">

                <span aria-hidden="true">X</span>

              </button>

            )}

          </div>

        )}

        <div className={bodyClass}>{children}</div>

        {actions && <div className="modal__actions">{actions}</div>}

      </div>

    </div>

  );

}

