import React from 'react';

function BaseIcon({ children, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function IconArrowUpRight(props) {
  return (
    <BaseIcon {...props}>
      <path d="M7 17 17 7" />
      <path d="M8 7h9v9" />
    </BaseIcon>
  );
}

export function IconBuilding(props) {
  return (
    <BaseIcon {...props}>
      <path d="M4 20h16" />
      <path d="M6 20V7l6-3 6 3v13" />
      <path d="M9 10h2" />
      <path d="M13 10h2" />
      <path d="M9 14h2" />
      <path d="M13 14h2" />
    </BaseIcon>
  );
}

export function IconCheck(props) {
  return (
    <BaseIcon {...props}>
      <path d="m5 12 5 5L19 8" />
    </BaseIcon>
  );
}

export function IconEye(props) {
  return (
    <BaseIcon {...props}>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </BaseIcon>
  );
}

export function IconEyeOff(props) {
  return (
    <BaseIcon {...props}>
      <path d="m3 3 18 18" />
      <path d="M10.7 5.1A12.4 12.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 3.9" />
      <path d="M6.5 6.6A17.3 17.3 0 0 0 2 12s3.5 7 10 7c1.5 0 2.9-.3 4.2-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </BaseIcon>
  );
}

export function IconKey(props) {
  return (
    <BaseIcon {...props}>
      <circle cx="8" cy="15" r="3" />
      <path d="M10.5 13.5 18 6" />
      <path d="M15 6h3v3" />
      <path d="M17 8 20 11" />
    </BaseIcon>
  );
}

export function IconLock(props) {
  return (
    <BaseIcon {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </BaseIcon>
  );
}

export function IconMail(props) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </BaseIcon>
  );
}

export function IconPhone(props) {
  return (
    <BaseIcon {...props}>
      <path d="M22 16.9v2a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 3.1 2 2 0 0 1 4.1 1h2a2 2 0 0 1 2 1.7l.5 3.1a2 2 0 0 1-.6 1.8L6.5 9.1a16 16 0 0 0 8.4 8.4l1.5-1.5a2 2 0 0 1 1.8-.6l3.1.5a2 2 0 0 1 1.7 2Z" />
    </BaseIcon>
  );
}

export function IconShield(props) {
  return (
    <BaseIcon {...props}>
      <path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3Z" />
      <path d="m9.5 12 1.8 1.8L15 10" />
    </BaseIcon>
  );
}

export function IconSpark(props) {
  return (
    <BaseIcon {...props}>
      <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
      <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      <path d="m5 14 .8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14Z" />
    </BaseIcon>
  );
}

export function IconUser(props) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </BaseIcon>
  );
}
