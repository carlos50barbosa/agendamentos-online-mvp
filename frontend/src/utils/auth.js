export function saveToken(token){ localStorage.setItem('token', token); }
export function getToken(){ return localStorage.getItem('token') || ''; }
export function clearToken(){ localStorage.removeItem('token'); }
export function saveUser(user){ localStorage.setItem('user', JSON.stringify(user)); }
export function getUser(){ try { return JSON.parse(localStorage.getItem('user')||'null'); } catch { return null; } }
export function logout(){ clearToken(); localStorage.removeItem('user'); }