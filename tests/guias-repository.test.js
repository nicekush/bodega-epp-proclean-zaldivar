import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuiasRepository } from '../src/guias-db.js';

const header = { fecha: '2026-10-21', hora: '09:00', lugar_entrega: 'Destino', chofer: 'Chofer', vehiculo: 'Vehículo' };
const items = [{ descripcion: 'Carga', cantidad: 1, unidad: 'UN' }];
const document = { id: 1, folio: 1, estado: 'PENDIENTE', updated_at: '2026-10-21T12:00:00.123456Z', ...header, items };
function harness({ rows = [document], rpc = () => ({ data: document, error: null }), user = { rut: '11.111.111-1' }, schemaReady = true } = {}) {
    const cache = new Map(), calls = [];
    const app = { user };
    const client = {
        from(table) {
            return { select() { return this; }, order() { return this; }, range(start, end) { this.start = start; this.end = end; return this; },
                then(resolve, reject) { calls.push({ table, offset: this.start }); return Promise.resolve({ data: rows.slice(this.start, this.end + 1), error: null }).then(resolve, reject); } };
        },
        async rpc(name, payload) { calls.push({ name, payload }); return name === 'guias_modulo_version' ? { data: schemaReady ? 3 : null, error: schemaReady ? null : { code: 'PGRST202' } } : rpc(name, payload); }
    };
    const repository = createGuiasRepository(client, { read: key => cache.get(key), write: (key, value) => cache.set(key, structuredClone(value)) }, () => app.user);
    return { repository, cache, calls, app };
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
    const operation = calls.find(call => call.name === 'guias_operar_aplicacion');
    assert.equal(operation.payload.p_action, 'editar');
    assert.equal(operation.payload.p_rut, '11.111.111-1');
    assert.equal('p_token' in operation.payload, false);
    assert.equal(operation.payload.p_payload.expected_updated_at, '2026-10-20T12:00:00.123456Z');
    assert.equal(calls.filter(call => call.table).length, 1);
});
test('sin migración o sin sesión no se emiten escrituras', async () => {
    const missing = harness({ schemaReady: false });
    await assert.rejects(missing.repository.create(header, items), /Falta actualizar/);
    assert.equal(missing.calls.some(call => call.name === 'guias_operar_aplicacion'), false);
    const anonymous = harness({ user: null });
    await assert.rejects(anonymous.repository.create(header, items), /Inicia sesión en la aplicación/);
    assert.equal(anonymous.calls.some(call => call.name === 'guias_operar_aplicacion'), false);
});
test('el servidor debe confirmar el documento antes de guardarlo en memoria', async () => {
    const { repository, cache } = harness({ rows: [], rpc: () => ({ data: { id: 1, folio: 1 }, error: null }) });
    await assert.rejects(repository.create(header, items), /Respuesta de guía incompleta/);
    assert.equal(repository.state.guias.length, 0);
    assert.equal(cache.has('guides'), false);
});
test('cada operación usa el usuario vigente y cerrar la sesión principal impide nuevas escrituras', async () => {
    const { repository, app, calls } = harness();
    await repository.create(header, items);
    app.user = { rut: '22.222.222-2' };
    await repository.create(header, items);
    assert.deepEqual(calls.filter(call => call.name === 'guias_operar_aplicacion').map(call => call.payload.p_rut), ['11.111.111-1', '22.222.222-2']);
    app.user = null;
    await assert.rejects(repository.create(header, items), /Inicia sesión en la aplicación/);
    assert.equal(calls.filter(call => call.name === 'guias_operar_aplicacion').length, 2);
});
