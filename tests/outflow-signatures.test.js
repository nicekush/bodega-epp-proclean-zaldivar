import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutflowSignaturesRepository, hasOutflowSignature, outflowSignatureLabel } from '../src/outflow-signatures.js';

const row = { id: 'a', trabajador: 'Ana', rut: '1-9', area: 'Área', turno: 'Turno A', fecha: '2026-10-01', items: [{ eppId: 'g', cantidad: 3 }], registrado_por: 'Bodega', motivo_entrega: 'Reposición', comentarios: 'Comentario', talla_ropa: 'L', razon_cambio_ropa: 'Talla', firma: 'data:image/png;base64,FIRMA' };
function harness({ rows = [row], unsupported = [], response = () => null } = {}) {
    const calls = [];
    const client = { from() { return {
        select(fields) { this.fields = fields.split(','); return this; }, order() { return this; },
        range(start, end) { this.start = start; this.end = end; return this; },
        eq(key, value) { this.id = value; return this; }, single() { this.singleRow = true; return this; },
        then(resolve, reject) {
            const query = { fields: this.fields, start: this.start, end: this.end, id: this.id, single: this.singleRow };
            calls.push(query);
            return Promise.resolve(response(query)).then(override => {
                if (override) return override;
                const absent = this.fields.find(field => unsupported.includes(field));
                if (absent) return { data: null, error: { code: '42703', message: `column salidas.${absent} does not exist` } };
                const selected = this.singleRow ? rows.filter(row => String(row.id) === String(this.id)) : rows.slice(this.start, this.end + 1);
                const data = selected.map(row => Object.fromEntries(this.fields.filter(field => field in row).map(field => [field, structuredClone(row[field])])));
                return { data: this.singleRow ? data[0] || null : data, error: null };
            }).then(resolve, reject);
        }
    }; } };
    return { calls, repository: createOutflowSignaturesRepository(client) };
}

test('carga todos los datos operacionales y las páginas sin solicitar firmas', async () => {
    const rows = Array.from({ length: 1001 }, (_, id) => ({ ...row, id: String(id) }));
    const app = harness({ rows });
    const summaries = await app.repository.loadSummaries();
    assert.equal(summaries.length, 1001);
    assert.deepEqual(app.calls.map(query => query.start), [0, 500, 1000]);
    assert.ok(app.calls.every(query => !query.fields.includes('firma')));
    const { firma, ...expected } = rows[0];
    assert.deepEqual(summaries[0], expected);
    assert.equal(hasOutflowSignature(summaries[0]), false);
    assert.equal(outflowSignatureLabel(summaries[0]), 'Pendiente de consultar en acta');
});

test('carga solo la firma del acta consultada y la conserva durante la sesión', async () => {
    const app = harness();
    const [summary] = await app.repository.loadSummaries();
    await app.repository.loadSignature(summary);
    await app.repository.loadSignature(summary);
    const requests = app.calls.filter(query => query.single);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].fields, ['id', 'firma']);
    assert.equal(requests[0].id, row.id);
    assert.equal(summary.firma, row.firma);
    assert.equal(outflowSignatureLabel(summary), 'Firma digital registrada');
    await app.repository.loadSignature(summary, { refresh: true });
    assert.equal(app.calls.filter(query => query.single).length, 2);
});

test('consultas simultáneas de la misma firma comparten la petición', async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const app = harness({ response: query => query.single ? gate : null });
    const [summary] = await app.repository.loadSummaries();
    const copy = { ...summary };
    const first = app.repository.loadSignature(summary), second = app.repository.loadSignature(copy);
    release(null);
    await Promise.all([first, second]);
    assert.equal(app.calls.filter(query => query.single).length, 1);
    assert.equal(copy.firma, row.firma);
});

test('un error o una respuesta incompleta permite reintentar sin fingir una firma física', async () => {
    let attempts = 0;
    const app = harness({ response: query => query.single && ++attempts === 1 ? { data: null, error: { message: 'Sin conexión' } } : null });
    const [summary] = await app.repository.loadSummaries();
    await assert.rejects(app.repository.loadSignature(summary), /Reintenta/);
    assert.equal(hasOutflowSignature(summary), false);
    await app.repository.loadSignature(summary);
    assert.equal(summary.firma, row.firma);
    for (const data of [{ id: 'otro', firma: row.firma }, { id: 'a' }, null]) {
        const incomplete = harness({ response: query => query.single ? { data, error: null } : null });
        await assert.rejects(incomplete.repository.loadSignature({ id: 'a' }), /no confirmó/);
    }
});

test('conserva compatibilidad con columnas opcionales ausentes; los demás errores son fatales', async () => {
    const app = harness({ unsupported: ['turno', 'talla_ropa'] });
    const [summary] = await app.repository.loadSummaries();
    assert.equal(summary.motivo_entrega, row.motivo_entrega);
    assert.equal(summary.comentarios, row.comentarios);
    assert.equal('turno' in summary, false);
    const before = app.calls.length;
    await app.repository.loadSummaries();
    assert.equal(app.calls.length, before + 1);
    for (const error of [{ code: '42501', message: 'permission denied' }, { code: '42703', message: 'column salidas.items does not exist' }]) {
        const rejected = harness({ response: () => ({ data: null, error }) });
        await assert.rejects(rejected.repository.loadSummaries());
        assert.equal(rejected.calls.length, 1);
    }
});

test('distingue pendiente, física, texto y ausencia de firma confirmada', async () => {
    for (const firma of ['Firma Física en Acta Impresa', 'Firmado vía QR', '', null]) {
        const app = harness({ rows: [{ ...row, firma }] });
        const [summary] = await app.repository.loadSummaries();
        await app.repository.loadSignature(summary);
        assert.equal(hasOutflowSignature(summary), true);
        assert.equal(outflowSignatureLabel(summary), firma || 'Sin firma registrada');
    }
});
