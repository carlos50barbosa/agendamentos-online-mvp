import React, { useEffect } from 'react';

export default function Drawer({
  open = false,
  title,
  children,
  onClose,
  actions,
  closeButton = true,
  bodyClassName = '',
  width,
}) {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const { style } = document.body;
    const prevOverflow = style.overflow;
    style.overflow = 'hidden';
    return () => {
      style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  const bodyClass = bodyClassName ? `drawer__body ${bodyClassName}` : 'drawer__body';

  const handleBackdropClick = (event) => {
    if (typeof onClose === 'function') onClose(event);
  };

  return (
    <div className="drawer-backdrop" role="presentation" onClick={handleBackdropClick}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Detalhes'}
        onClick={(event) => event.stopPropagation()}
        style={width ? { width } : undefined}
      >
        {(title || closeButton) && (
          <div className="drawer__header">
            {title ? <h3 className="drawer__title">{title}</h3> : <span aria-hidden="true" />}
            {closeButton && (
              <button type="button" className="drawer__close" onClick={onClose} aria-label="Fechar">
                <span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        )}
        <div className={bodyClass}>{children}</div>
        {actions && <div className="drawer__actions">{actions}</div>}
      </aside>
    </div>
  );
}



