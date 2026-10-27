import test from 'node:test';
import assert from 'node:assert/strict';
import { createReturnsRepository } from '../src/returns-db.js';

function harness({ rows = [], readError = null, response = null, user = { rut: '1-9' } } = {}) {
    const calls = [];
    const record = { id: 'r', salida_id: 'a', items: [{ linea: 0, cantidad: 2 }] };
    const client = {
        from(table) { return { select() { return this; }, order() { return this; }, range(start, end) { calls.push({ table, start }); return Promise.resolve({ data: rows.slice(start, end + 1), error: readError }); } }; },
        rpc(name, payload) { calls.push({ name, payload }); return Promise.resolve(response || { data: record, error: null }); }
    };
    return { calls, repo: createReturnsRepository(client, () => user) };
}
const payload = { salidaId: 'a', items: [{ linea: 0, cantidad: 2, eppId: 'g', entregado: 3 }], motivo: 'Sin uso', requestId: 'request' };

test('carga todas las páginas y deduplica la respuesta de un reintento', async () => {
    const { repo, calls } = harness({ rows: Array.from({ length: 501 }, (_, index) => ({ id: `r${index}` })) });
    await repo.load();
    assert.equal(repo.state.records.length, 501);
    assert.deepEqual(calls.map(row => row.start), [0, 500]);
    await repo.save(payload);
    await repo.save(payload);
    assert.equal(repo.state.records.filter(row => row.id === 'r').length, 1);
    assert.equal(calls.at(-1).payload.p_request_id, 'request');
});

test('sin migración, sin usuario o con rechazo no crea una devolución local', async () => {
    const missing = harness({ readError: { code: 'PGRST205' } });
    await missing.repo.load();
    await assert.rejects(missing.repo.save(payload), /SQL/);
    assert.equal(missing.calls.some(row => row.name), false);
    const anonymous = harness({ user: null });
    await anonymous.repo.load();
    await assert.rejects(anonymous.repo.save(payload), /sesión/);
    const rejected = harness({ response: { error: { message: 'Saldo rechazado' } } });
    await rejected.repo.load();
    await assert.rejects(rejected.repo.save(payload));
    assert.equal(rejected.repo.state.records.length, 0);
});

test('respuesta incompleta no se interpreta como confirmación de recepción', async () => {
    const { repo } = harness({ response: { data: { id: 'r' }, error: null } });
    await repo.load();
    await assert.rejects(repo.save(payload), /no confirmó/);
    assert.equal(repo.state.records.length, 0);
});
