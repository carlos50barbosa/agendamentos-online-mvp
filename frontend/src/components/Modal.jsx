// src/components/Modal.jsx
//
// O diálogo é renderizado por PORTAL no <body>, e não no lugar onde foi escrito na árvore.
//
// Motivo concreto: o "Sair da conta" mora dentro da sidebar, que tem `transform: translateX(0)`.
// Um transform diferente de `none` transforma o elemento em bloco contentor dos descendentes
// `position: fixed` — então o `inset: 0` do backdrop passava a valer contra a SIDEBAR (260px de
// largura, começando abaixo da topbar) em vez da janela, e o `overflow-y: auto` dela ainda
// recortava o resto. O modal aparecia espremido dentro do menu.
//
// Não é um caso isolado: qualquer ancestral com transform, filter, backdrop-filter, contain ou
// will-change repete o problema. Por isso a correção mora aqui, e não numa regra de CSS para a
// sidebar — assim vale para todo modal do app, inclusive os que ainda não existem.
//
// Portal é seguro neste projeto porque o tema vive em `:root` (data-theme no documentElement) e
// nenhum CSS escopa `.modal`/`.modal-backdrop` sob um pai específico.
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

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



  const dialogo = (

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

  // Sem `document` (SSR/teste sem DOM) devolve inline: melhor renderizar no lugar errado do que
  // quebrar a página inteira.
  if (typeof document === 'undefined' || !document.body) return dialogo;

  return createPortal(dialogo, document.body);

}

