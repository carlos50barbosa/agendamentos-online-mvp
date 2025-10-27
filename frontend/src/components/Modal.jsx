// src/components/Modal.jsx
import React from 'react';

export default function Modal({
  title,
  children,
  onClose,
  actions,
  closeButton = false,
  bodyClassName = '',
}) {
  const bodyClass = bodyClassName ? `modal__body ${bodyClassName}` : 'modal__body';

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Diálogo'}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || closeButton) && (
          <div className="modal__header">
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

