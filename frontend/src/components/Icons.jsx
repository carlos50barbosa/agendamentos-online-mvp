// src/components/Icons.jsx
import React from 'react';

const base = {
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function IconUser(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M20 21a8 8 0 10-16 0"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

export function IconMenu(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M4 6h16M4 12h16M4 18h16"/>
    </svg>
  );
}

export function IconHome(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M3 11l9-7 9 7"/>
      <path d="M9 22V12h6v10"/>
    </svg>
  );
}

export function IconPlus(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12 5v14M5 12h14"/>
    </svg>
  );
}

export function IconGear(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06A1.65 1.65 0 0015 19.4a1.65 1.65 0 00-1 .6 1.65 1.65 0 00-.33 1.82l.02.07a2 2 0 01-3.38 0l.02-.07A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82-.33l-.07.03a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-.6-1 1.65 1.65 0 00-1.82-.33l-.07.03a2 2 0 010-3.38l.07.02A1.65 1.65 0 004.6 9a1.65 1.65 0 00.33-1.82l-.06-.06A2 2 0 017.7 4.29l.06.06A1.65 1.65 0 009 4.6c.3-.2.54-.46.7-.77l.03-.07a2 2 0 013.38 0l.03.07c.16.31.4.57.7.77.53.35 1.2.35 1.73 0l.06-.06A2 2 0 0120 7.12l-.06.06c-.2.3-.2.7 0 1 .2.31.46.57.77.73l.07.03a2 2 0 010 3.38l-.07-.03c-.31-.16-.57-.4-.77-.7-.35-.53-.35-1.2 0-1.73z"/>
    </svg>
  );
}

export function IconHelp(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="10"/>
      <path d="M9.09 9a3 3 0 115.82 1c0 2-3 2-3 4"/>
      <circle cx="12" cy="17" r="1"/>
    </svg>
  );
}

export function IconLogout(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
      <path d="M16 17l5-5-5-5"/>
      <path d="M21 12H9"/>
    </svg>
  );
}

export function IconChevronLeft(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M15 18l-6-6 6-6"/>
    </svg>
  );
}

export function IconChevronRight(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M9 6l6 6-6 6"/>
    </svg>
  );
}

export function IconList(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M8 6h13M3 6h.01M8 12h13M3 12h.01M8 18h13M3 18h.01" />
    </svg>
  );
}

export function IconChart(props){
  return (
    <svg {...base} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M3 3v18h18"/>
      <rect x="7" y="13" width="3" height="5" rx="1"/>
      <rect x="12" y="9" width="3" height="9" rx="1"/>
      <rect x="17" y="5" width="3" height="13" rx="1"/>
    </svg>
  );
}

export default {
  IconUser,
  IconMenu,
  IconHome,
  IconPlus,
  IconGear,
  IconHelp,
  IconLogout,
  IconChevronLeft,
  IconChevronRight,
  IconList,
  IconChart,
};
