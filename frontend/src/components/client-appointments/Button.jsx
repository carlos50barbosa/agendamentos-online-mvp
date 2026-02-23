import React from 'react';

const BUTTON_BASE =
  'tw-inline-flex tw-items-center tw-justify-center tw-gap-2 tw-whitespace-nowrap tw-rounded-xl tw-border tw-px-4 tw-py-2 tw-text-sm tw-font-semibold tw-transition-colors tw-duration-150 focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-offset-2 disabled:tw-cursor-not-allowed disabled:tw-opacity-60';

const BUTTON_BASE_FAB =
  'tw-inline-flex tw-items-center tw-justify-center tw-transition-all tw-duration-150 active:tw-scale-[0.98] focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-offset-2 disabled:tw-cursor-not-allowed disabled:tw-opacity-60';

const BUTTON_VARIANTS = {
  primary:
    'tw-border-indigo-700 tw-bg-indigo-700 tw-text-white tw-shadow-sm hover:tw-bg-indigo-800 focus-visible:tw-ring-indigo-300',
  secondaryOutline:
    'tw-border-slate-200 tw-bg-white tw-text-slate-700 hover:tw-bg-slate-50 focus-visible:tw-ring-slate-200',
  secondary:
    'tw-border-slate-200 tw-bg-white tw-text-slate-700 hover:tw-bg-slate-50 focus-visible:tw-ring-slate-200',
  outline:
    'tw-border-slate-200 tw-bg-white tw-text-slate-700 hover:tw-bg-slate-50 focus-visible:tw-ring-slate-200',
  dangerOutline:
    'tw-border-rose-200 tw-bg-white tw-text-rose-700 hover:tw-bg-rose-50 focus-visible:tw-ring-rose-200',
  danger:
    'tw-border-rose-600 tw-bg-rose-600 tw-text-white tw-shadow-sm hover:tw-bg-rose-700 focus-visible:tw-ring-rose-200',
  warning:
    'tw-border-amber-200 tw-bg-amber-50 tw-text-amber-800 hover:tw-bg-amber-100 focus-visible:tw-ring-amber-200',
  fab:
    'tw-h-14 tw-w-14 tw-rounded-full tw-bg-indigo-700 tw-text-white tw-shadow-lg tw-ring-1 tw-ring-black/5 hover:tw-bg-indigo-800 focus-visible:tw-ring-indigo-300',
};

export function buttonClassName(variant = 'secondary', className = '') {
  const base = variant === 'fab' ? BUTTON_BASE_FAB : BUTTON_BASE;
  return `${base} ${BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary} ${className}`.trim();
}

const Button = React.forwardRef(function Button(
  { variant = 'secondary', className = '', type = 'button', ...props },
  ref
) {
  return <button ref={ref} type={type} className={buttonClassName(variant, className)} {...props} />;
});

export default Button;
