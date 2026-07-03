// src/components/agenda/PixCheckout.jsx
// Exibe o PIX do sinal: QR (imagem Base64), copia-e-cola com botão copiar,
// valor e contagem de expiração. Consome dados que a Fase 2 (Asaas) fornece:
//   { encodedImage (Base64), payload (copia-e-cola), expirationDate, value }
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check, QrCode, Clock, CheckCircle2, XCircle } from 'lucide-react';
import { toDate } from '../../utils/agendaDates.js';

function formatBRL(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function useCountdown(expirationDate, active) {
  const [remaining, setRemaining] = useState(null);
  const target = useMemo(() => toDate(expirationDate), [expirationDate]);
  useEffect(() => {
    if (!target || !active) {
      setRemaining(null);
      return undefined;
    }
    const tick = () => setRemaining(Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target, active]);
  return remaining;
}

function fmtClock(totalSeconds) {
  if (totalSeconds == null) return null;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function PixCheckout({
  encodedImage,
  payload,
  value,
  expirationDate,
  status = 'pending',
  onExpire,
  className = '',
}) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  const paid = status === 'paid';
  const expiredProp = status === 'expired';
  const remaining = useCountdown(expirationDate, !paid && !expiredProp);
  const expired = expiredProp || remaining === 0;

  useEffect(() => {
    if (remaining === 0) onExpire?.();
  }, [remaining, onExpire]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const copy = async () => {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // Fallback silencioso para navegadores sem Clipboard API.
    }
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2000);
  };

  const imgSrc = encodedImage
    ? encodedImage.startsWith('data:')
      ? encodedImage
      : `data:image/png;base64,${encodedImage}`
    : null;

  return (
    <div
      className={`tw-mx-auto tw-flex tw-w-full tw-max-w-sm tw-flex-col tw-items-center tw-gap-4 tw-rounded-2xl tw-p-5 ${className}`}
      style={{ background: 'var(--surface, #fff)', border: '1px solid var(--brand-border, #E7E5F5)', boxShadow: 'var(--shadow-soft, 0 4px 16px -8px rgba(30,27,75,.16))' }}
    >
      {/* Estado */}
      {paid ? (
        <StatusStrip icon={CheckCircle2} tone="var(--status-confirmado-fg)" bg="var(--status-confirmado-bg)" label="Pagamento confirmado!" />
      ) : expired ? (
        <StatusStrip icon={XCircle} tone="var(--status-cancelado-fg)" bg="var(--status-cancelado-bg)" label="PIX expirado" />
      ) : (
        <StatusStrip
          icon={Clock}
          tone="var(--status-aguardando_sinal-fg)"
          bg="var(--status-aguardando_sinal-bg)"
          label={remaining != null ? `Expira em ${fmtClock(remaining)}` : 'Aguardando pagamento'}
        />
      )}

      {value != null && (
        <div className="tw-text-center">
          <p className="tw-m-0 tw-text-xs tw-font-medium" style={{ color: 'var(--muted-ink, #6B7280)' }}>
            Valor do sinal
          </p>
          <p className="tw-m-0 tw-text-2xl tw-font-extrabold" style={{ color: 'var(--brand-deep, #1E1B4B)' }}>
            {formatBRL(value)}
          </p>
        </div>
      )}

      {/* QR */}
      {!paid && (
        <div
          className="tw-flex tw-h-52 tw-w-52 tw-items-center tw-justify-center tw-rounded-2xl tw-p-2"
          style={{ background: '#fff', border: '1px solid var(--brand-border, #E7E5F5)', opacity: expired ? 0.4 : 1 }}
        >
          {imgSrc ? (
            <img src={imgSrc} alt="QR Code PIX" className="tw-h-full tw-w-full tw-object-contain" />
          ) : (
            <QrCode size={96} strokeWidth={1.2} aria-hidden="true" style={{ color: 'var(--brand-200, #D7D4F7)' }} />
          )}
        </div>
      )}

      {/* Copia e cola */}
      {!paid && payload && (
        <div className="tw-w-full">
          <p className="tw-mb-1 tw-text-xs tw-font-semibold" style={{ color: 'var(--muted-ink, #6B7280)' }}>
            PIX copia e cola
          </p>
          <div className="tw-flex tw-items-stretch tw-gap-2">
            <code
              className="tw-min-w-0 tw-flex-1 tw-truncate tw-rounded-xl tw-px-3 tw-py-2 tw-text-xs"
              style={{ background: 'var(--surface-soft, #F6F5FB)', color: 'var(--ink, #1E1B4B)', border: '1px solid var(--brand-border, #E7E5F5)' }}
              title={payload}
            >
              {payload}
            </code>
            <button
              type="button"
              onClick={copy}
              aria-label="Copiar código PIX"
              className="tw-inline-flex tw-items-center tw-gap-1 tw-rounded-xl tw-px-3 tw-text-sm tw-font-semibold tw-text-white"
              style={{ minHeight: 44, minWidth: 44, background: copied ? 'var(--status-confirmado-fg)' : 'var(--brand)' }}
            >
              {copied ? <Check size={18} strokeWidth={2.4} /> : <Copy size={18} strokeWidth={2.2} />}
              <span className="tw-hidden sm:tw-inline">{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
          </div>
        </div>
      )}

      {!paid && (
        <p className="tw-m-0 tw-text-center tw-text-xs" style={{ color: 'var(--muted-ink, #6B7280)' }}>
          Abra o app do seu banco, escolha PIX e leia o QR ou cole o código.
        </p>
      )}
    </div>
  );
}

function StatusStrip({ icon: Icon, tone, bg, label }) {
  return (
    <div
      className="tw-flex tw-w-full tw-items-center tw-justify-center tw-gap-2 tw-rounded-xl tw-py-2 tw-text-sm tw-font-semibold"
      style={{ background: bg, color: tone }}
    >
      <Icon size={18} strokeWidth={2.2} aria-hidden="true" />
      {label}
    </div>
  );
}
