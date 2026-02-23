export const USER_EVENT = 'ao:user-updated';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

function readStorage(storage, key){
  if (!storage) return null;
  try { return storage.getItem(key); } catch { return null; }
}

function writeStorage(storage, key, value){
  if (!storage) return;
  try { storage.setItem(key, value); } catch {}
}

function removeStorage(storage, key){
  if (!storage) return;
  try { storage.removeItem(key); } catch {}
}

function getLocalStorage(){
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

function getSessionStorage(){
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

export function saveToken(token, options = {}){
  const remember = options?.remember !== false;
  const local = getLocalStorage();
  const session = getSessionStorage();
  if (remember) {
    writeStorage(local, TOKEN_KEY, token);
    removeStorage(session, TOKEN_KEY);
    return;
  }
  writeStorage(session, TOKEN_KEY, token);
  removeStorage(local, TOKEN_KEY);
}

export function getToken(){
  const local = getLocalStorage();
  const session = getSessionStorage();
  return readStorage(local, TOKEN_KEY) || readStorage(session, TOKEN_KEY) || '';
}

export function clearToken(){
  removeStorage(getLocalStorage(), TOKEN_KEY);
  removeStorage(getSessionStorage(), TOKEN_KEY);
}

export function saveUser(user, options = {}){
  const remember = options?.remember !== false;
  const payload = JSON.stringify(user);
  const local = getLocalStorage();
  const session = getSessionStorage();
  if (remember) {
    writeStorage(local, USER_KEY, payload);
    removeStorage(session, USER_KEY);
  } else {
    writeStorage(session, USER_KEY, payload);
    removeStorage(local, USER_KEY);
  }
  try { window.dispatchEvent(new CustomEvent(USER_EVENT, { detail: { user } })); } catch {}
}

export function getUser(){
  const local = getLocalStorage();
  const session = getSessionStorage();
  const raw = readStorage(local, USER_KEY) || readStorage(session, USER_KEY) || 'null';
  try { return JSON.parse(raw); } catch { return null; }
}

const PLAN_KEYS = ['plan_current', 'plan_status', 'trial_end', 'ao_last_plan_purchase_signature'];
export function clearPlanCache(){
  const local = getLocalStorage();
  PLAN_KEYS.forEach((key) => {
    removeStorage(local, key);
  });
}
export function logout(){
  clearToken();
  removeStorage(getLocalStorage(), USER_KEY);
  removeStorage(getSessionStorage(), USER_KEY);
  clearPlanCache();
  try { window.dispatchEvent(new CustomEvent(USER_EVENT, { detail: { user: null } })); } catch {}
}
