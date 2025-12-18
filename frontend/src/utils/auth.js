export const USER_EVENT = 'ao:user-updated';
export function saveToken(token){ localStorage.setItem('token', token); }
export function getToken(){ return localStorage.getItem('token') || ''; }
export function clearToken(){ localStorage.removeItem('token'); }
export function saveUser(user){ localStorage.setItem('user', JSON.stringify(user)); try { window.dispatchEvent(new CustomEvent(USER_EVENT, { detail: { user } })); } catch {} }
export function getUser(){ try { return JSON.parse(localStorage.getItem('user')||'null'); } catch { return null; } }
const PLAN_KEYS = ['plan_current', 'plan_status', 'trial_end', 'ao_last_plan_purchase_signature'];
export function clearPlanCache(){
  PLAN_KEYS.forEach((key) => {
    try { localStorage.removeItem(key); } catch {}
  });
}
export function logout(){
  clearToken();
  localStorage.removeItem('user');
  clearPlanCache();
  try { window.dispatchEvent(new CustomEvent(USER_EVENT, { detail: { user: null } })); } catch {}
}
