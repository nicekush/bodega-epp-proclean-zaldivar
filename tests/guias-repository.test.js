import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuiasRepository } from '../src/guias-db.js';

const header = { fecha: '2026-10-21', hora: '09:00', lugar_entrega: 'Destino', chofer: 'Chofer', vehiculo: 'Vehículo' };
const items = [{ descripcion: 'Carga', cantidad: 1, unidad: 'UN' }];
const document = { id: 1, folio: 1, estado: 'PENDIENTE', updated_at: '2026-10-21T12:00:00.123456Z', ...header, items };
function harness({ rows = [document], rpc = () => ({ data: document, error: null }), session = { token: 'sesion-test' }, schemaReady = true } = {}) {
    const cache = new Map(), calls = [];
    const sessions = { value: session, get() { return this.value; }, set(value) { this.value = value; }, clear() { this.value = null; } };
    const client = {
        from(table) {
            return { select() { return this; }, order() { return this; }, range(start, end) { this.start = start; this.end = end; return this; },
                then(resolve, reject) { calls.push({ table, offset: this.start }); return Promise.resolve({ data: rows.slice(this.start, this.end + 1), error: null }).then(resolve, reject); } };
        },
        async rpc(name, payload) { calls.push({ name, payload }); return name === 'guias_modulo_version' ? { data: schemaReady ? 2 : null, error: schemaReady ? null : { code: 'PGRST202' } } : rpc(name, payload); }
    };
    const repository = createGuiasRepository(client, { read: key => cache.get(key), write: (key, value) => cache.set(key, structuredClone(value)) }, sessions);
    return { repository, cache, calls, sessions };
}
test('la carga recorre todas las páginas del servidor', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ ...document, id: i + 1, folio: i + 1 }));
    const { repository, calls } = harness({ rows });
    assert.equal((await repository.loadGuides()).length, 501);
    assert.deepEqual(calls.filter(call => call.table).map(call => call.offset), [0, 500]);
    assert.equal(repository.state.guias[0].folio, 501);
});
test('un rechazo del servidor no modifica memoria ni caché', async () => {
    const { repository, cache } = harness({ rpc: () => ({ data: null, error: { code: '23505', message: 'Operación rechazada' } }) });
    await repository.loadGuides();
    const before = structuredClone(repository.state.guias);
    await assert.rejects(repository.create(header, items, 'request-test'), /Operación rechazada/);
    assert.deepEqual(repository.state.guias, before);
    assert.deepEqual(cache.get('guides'), before);
    await assert.rejects(repository.remove(1), /Operación rechazada/);
    assert.deepEqual(repository.state.guias, before);
});
test('las mutaciones solo usan RPC y conservan la versión exacta del formulario', async () => {
    const { repository, calls } = harness();
    await repository.loadGuides();
    await repository.edit(1, header, items, '2026-10-20T12:00:00.123456Z');
    const operation = calls.find(call => call.name === 'guias_operar');
    assert.equal(operation.payload.p_action, 'editar');
    assert.equal(operation.payload.p_payload.expected_updated_at, '2026-10-20T12:00:00.123456Z');
    assert.equal(calls.filter(call => call.table).length, 1);
});
test('sin migración o sin sesión no se emiten escrituras', async () => {
    const missing = harness({ schemaReady: false });
    await assert.rejects(missing.repository.create(header, items), /Falta actualizar/);
    assert.equal(missing.calls.some(call => call.name === 'guias_operar'), false);
    const anonymous = harness({ session: null });
    await assert.rejects(anonymous.repository.create(header, items), /Confirma tu clave/);
    assert.equal(anonymous.calls.some(call => call.name === 'guias_operar'), false);
});
test('el servidor debe confirmar el documento antes de guardarlo en memoria', async () => {
    const { repository, cache } = harness({ rows: [], rpc: () => ({ data: { id: 1, folio: 1 }, error: null }) });
    await assert.rejects(repository.create(header, items), /Respuesta de guía incompleta/);
    assert.equal(repository.state.guias.length, 0);
    assert.equal(cache.has('guides'), false);
});
test('una sesión rechazada se descarta y cerrar sesión limpia el token', async () => {
    const { repository, sessions } = harness({ rpc: () => ({ data: null, error: { code: '28000', message: 'Sesión vencida' } }) });
    await assert.rejects(repository.create(header, items), /Sesión vencida/);
    assert.equal(sessions.get(), null);
    sessions.set({ token: 'otra-sesion' });
    await repository.logout();
    assert.equal(sessions.get(), null);
});
