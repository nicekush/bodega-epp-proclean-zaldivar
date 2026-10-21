import { getGuiasSession, setGuiasSession, clearGuiasSession } from './guias-session.js';
import { validateGuia } from './guias-model.js';

export function createGuiasRepository(client, cache, sessions = { get: getGuiasSession, set: setGuiasSession, clear: clearGuiasSession }) {
    const state = { guias: [], catalogos: { vehiculos: [], choferes: [], destinos: [] }, config: {}, online: false, schemaReady: false, error: '' };
    const persist = () => cache.write('guides', state.guias);
    const persistSettings = () => cache.write('settings', { catalogos: state.catalogos, config: state.config });
    const cached = (key, fallback) => {
        try { return cache.read(key) ?? fallback; } catch { return fallback; }
    };

    async function allRows(table, select = '*', order = 'id') {
        const result = [];
        for (let offset = 0; ; offset += 500) {
            const { data, error } = await client.from(table).select(select).order(order).range(offset, offset + 499);
            if (error) throw error;
            if (!Array.isArray(data)) throw new Error('Respuesta inválida al cargar guías de despacho.');
            result.push(...data);
            if (data.length < 500) return result;
        }
    }

    async function loadGuides() {
        try {
            state.guias = await allRows('guias_despacho', '*, items:guia_despacho_items(*)');
            state.guias.sort((a, b) => Number(b.folio) - Number(a.folio));
            state.online = true;
            state.error = '';
            persist();
        } catch (error) {
            const previous = cached('guides', []);
            state.guias = Array.isArray(previous) ? previous : [];
            state.online = false;
            state.error = 'Sin conexión. Se muestra la última copia disponible.';
        }
        return state.guias;
    }

    async function checkSchema() {
        try {
            const { data, error } = await client.rpc('guias_modulo_version');
            state.schemaReady = !error && data === 2;
        } catch { state.schemaReady = false; }
        return state.schemaReady;
    }

    async function loadSettings() {
        const previous = cached('settings', {});
        try {
            const [catalogos, config] = await Promise.all([
                allRows('guias_despacho_catalogos'), allRows('guias_despacho_config', '*', 'clave')
            ]);
            state.catalogos = {
                vehiculos: catalogos.filter(row => row.tipo === 'vehiculo'),
                choferes: catalogos.filter(row => row.tipo === 'chofer'),
                destinos: catalogos.filter(row => row.tipo === 'destino')
            };
            state.config = Object.fromEntries(config.map(row => [row.clave, row.valor]));
            persistSettings();
        } catch {
            state.catalogos = previous.catalogos || { vehiculos: [], choferes: [], destinos: [] };
            state.config = previous.config || {};
        }
        await checkSchema();
        return state;
    }

    async function login(rut, password) {
        sessions.clear();
        if (!await checkSchema()) throw new Error('Las operaciones de guías estarán disponibles después de actualizar el módulo en la base de datos.');
        const { data, error } = await client.rpc('guias_iniciar_sesion', { p_rut: rut, p_password: password });
        if (error) throw new Error(error.message || 'No se pudo confirmar la sesión.');
        sessions.set(data);
        return data;
    }

    async function logout() {
        const token = sessions.get()?.token;
        sessions.clear();
        if (token) {
            try { await client.rpc('guias_cerrar_sesion', { p_token: token }); } catch { /* El servidor también aplica caducidad. */ }
        }
    }

    async function operate(action, payload = {}) {
        if (!state.schemaReady && !await checkSchema()) throw new Error('Falta actualizar el módulo en la base de datos. Las guías permanecen en modo consulta.');
        const session = sessions.get();
        if (!session) throw new Error('Confirma tu clave para operar en Guías de Despacho.');
        const { data, error } = await client.rpc('guias_operar', { p_token: session.token, p_action: action, p_payload: payload });
        if (error) {
            if (error.code === '28000') sessions.clear();
            if (error.code === 'PGRST202') state.schemaReady = false;
            throw new Error(error.message || 'No se pudo completar la operación.');
        }
        if (data == null) throw new Error('El servidor no confirmó el resultado. Actualiza la lista antes de reintentar.');
        return data;
    }

    function current(id) {
        const guia = state.guias.find(row => String(row.id) === String(id));
        if (!guia) throw new Error('La guía ya no está disponible. Actualiza la lista.');
        return guia;
    }
    function remember(guia) {
        if (!guia?.id || !Array.isArray(guia.items)) throw new Error('Respuesta de guía incompleta. Actualiza la lista.');
        const index = state.guias.findIndex(row => String(row.id) === String(guia.id));
        if (index < 0) state.guias.unshift(guia); else state.guias[index] = guia;
        state.online = true;
        persist();
        return guia;
    }
    function revision(id, expected) {
        const value = expected || current(id).updated_at;
        if (!value) throw new Error('Actualiza esta guía antes de guardar cambios.');
        return value;
    }

    async function create(guia, items, requestId) {
        validateGuia(guia, items);
        return remember(await operate('crear', { guia, items, request_id: requestId || crypto.randomUUID() }));
    }
    async function edit(id, guia, items, expected) {
        if (current(id).estado !== 'PENDIENTE') throw new Error('Solo se puede editar una guía por despachar.');
        validateGuia(guia, items);
        return remember(await operate('editar', { id, guia, items, expected_updated_at: revision(id, expected) }));
    }
    async function change(id, action, fields = {}, expected) {
        return remember(await operate(action, { ...fields, id, expected_updated_at: revision(id, expected) }));
    }
    async function remove(id, expected) {
        const result = await operate('eliminar', { id, expected_updated_at: revision(id, expected) });
        if (!result.deleted || String(result.id) !== String(id)) throw new Error('No se confirmó la eliminación. Actualiza la lista.');
        state.guias = state.guias.filter(guia => String(guia.id) !== String(id));
        persist();
        return result;
    }
    async function saveConfig(config) {
        state.config = await operate('configurar', { config });
        persistSettings();
        return state.config;
    }
    async function addCatalog(tipo, nombre) {
        const item = await operate('catalogo_agregar', { tipo, nombre });
        const key = { vehiculo: 'vehiculos', chofer: 'choferes', destino: 'destinos' }[tipo];
        if (key) state.catalogos[key].push(item);
        persistSettings();
        return item;
    }
    async function deleteCatalog(id) {
        const item = await operate('catalogo_eliminar', { id });
        for (const key of ['vehiculos', 'choferes', 'destinos']) state.catalogos[key] = state.catalogos[key].filter(row => String(row.id) !== String(id));
        persistSettings();
        return item;
    }
    return { state, loadGuides, loadSettings, checkSchema, login, logout, create, edit, change, remove, saveConfig,
        addCatalog, deleteCatalog, audit: id => operate('auditoria', { id }), logPrint: id => operate('imprimir', { id }) };
}
