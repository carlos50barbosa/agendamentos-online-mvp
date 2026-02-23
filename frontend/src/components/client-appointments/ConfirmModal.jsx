import React, { useEffect, useId, useRef } from 'react';
import Button from './Button.jsx';

export default function ConfirmModal({
  open,
  title,
  description,
  onCancel,
  onConfirm,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Voltar',
  loading = false,
}) {
  const titleId = useId();
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const previous = document.activeElement;
    cancelRef.current?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!loading) onCancel?.();
        return;
      }

      if (event.key === 'Tab') {
        const focusables = [cancelRef.current, confirmRef.current].filter(Boolean);
        if (!focusables.length) return;
        const activeIndex = focusables.indexOf(document.activeElement);
        const isShift = event.shiftKey;
        const nextIndex =
          activeIndex < 0
            ? 0
            : (activeIndex + (isShift ? -1 : 1) + focusables.length) % focusables.length;
        event.preventDefault();
        focusables[nextIndex]?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previous && typeof previous.focus === 'function') previous.focus();
    };
  }, [open, onCancel, loading]);

  if (!open) return null;

  return (
    <div
      className="tw-fixed tw-inset-0 tw-z-50 tw-flex tw-items-center tw-justify-center tw-bg-slate-900/45 tw-p-4"
      role="presentation"
      onClick={() => {
        if (!loading) onCancel?.();
      }}
    >
      <div
        className="tw-w-full tw-max-w-md tw-rounded-2xl tw-border tw-border-slate-200 tw-bg-white tw-p-6 tw-shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id={titleId} className="tw-m-0 tw-text-lg tw-font-semibold tw-text-slate-900">
          {title}
        </h3>
        <p className="tw-mt-2 tw-text-sm tw-leading-relaxed tw-text-slate-600">{description}</p>
        <div className="tw-mt-6 tw-flex tw-justify-end tw-gap-2">
          <Button
            ref={cancelRef}
            variant="secondaryOutline"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            variant="danger"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Cancelando...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
