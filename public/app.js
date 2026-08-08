const STORAGE_KEY = 'ceeac_session_v10';

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (_error) {
    return null;
  }
}

function setSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function redirectToPage(page) {
  window.location.href = `/?page=${page}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

async function api(path, options = {}) {
  const session = getSession();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (session?.token) {
    headers.set('Authorization', 'Bearer ' + session.token);
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.erro || data.message || 'Falha na requisição.';
    throw new Error(message);
  }

  return data;
}

async function requireSession({ admin = false } = {}) {
  const session = getSession();
  if (!session?.token || !session?.user) {
    clearSession();
    redirectToPage('login');
    return null;
  }

  if (admin && session.user.perfil !== 'ADMINISTRADOR') {
    clearSession();
    redirectToPage('login');
    return null;
  }

  try {
    const me = await api('/api/me');
    setSession({ ...session, user: me.usuario });
    return { ...session, user: me.usuario };
  } catch (_error) {
    clearSession();
    redirectToPage('login');
    return null;
  }
}

function normalizePlate(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
