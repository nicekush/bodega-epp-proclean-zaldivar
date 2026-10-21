const SESSION_KEY = 'epp_guias_session_v1';

export function getGuiasSession() {
    try {
        const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
        if (session?.token && new Date(session.expires_at).getTime() > Date.now()) return session;
        sessionStorage.removeItem(SESSION_KEY);
    } catch { /* El navegador puede restringir el almacenamiento. */ }
    return null;
}

export function setGuiasSession(session) {
    if (!session?.token || !session.expires_at) throw new Error('No se pudo validar la sesión de guías.');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearGuiasSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Sesión ya cerrada. */ }
}
