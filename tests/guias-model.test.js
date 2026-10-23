import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGuias, validateGuia, localGuiaDate, buildGuiasCSV, guiaTiming, canEditGuia, canAnnulGuia, escapeGuiaHTML } from '../src/guias-model.js';

const header = { fecha: '2026-10-21', hora: '09:00', lugar_entrega: 'Faena', chofer: 'Chofer', vehiculo: 'Vehículo' };
const load = [{ descripcion: 'Carga', cantidad: 2.5, unidad: 'UN' }];
const guides = [
    { id: 1, folio: 1, fecha: '2026-10-01', estado: 'PENDIENTE', lugar_entrega: 'Faena Norte', chofer: 'María Díaz', vehiculo: 'Camión', patente: 'ABCD12', observaciones: 'Frágil', items: [{ descripcion: 'Manguera', cantidad: 2.5, unidad: 'LT' }] },
    { id: 2, folio: 10, fecha: '2026-10-21', estado: 'EN_TRANSITO', lugar_entrega: 'Taller Sur', chofer: 'Carlos', vehiculo: 'Camioneta', patente: 'EFGH34', items: [{ descripcion: 'Repuesto', cantidad: 1, unidad: 'UN' }] }
];

test('búsqueda por folio con # es exacta y el texto admite tildes, patente y varias palabras', () => {
    assert.deepEqual(selectGuias(guides, { query: '#1' }).map(row => row.id), [1]);
    assert.deepEqual(selectGuias(guides, { query: 'maria fragil' }).map(row => row.id), [1]);
    assert.deepEqual(selectGuias(guides, { query: 'ABCD12' }).map(row => row.id), [1]);
    assert.equal(selectGuias(guides, { query: 'sin resultado' }).length, 0);
});
test('todos los filtros se combinan e incluyen los extremos del rango de fecha', () => {
    assert.equal(selectGuias(guides, { start: '2026-10-01', end: '2026-10-01', destination: 'Faena Norte', driver: 'María Díaz', vehicle: 'Camión', state: 'PENDIENTE' }).length, 1);
    assert.equal(selectGuias(guides, { start: '2026-10-21', end: '2026-10-01' }).length, 0);
    assert.equal(selectGuias(guides, { state: 'ENTREGADA' }).length, 0);
    const before = structuredClone(guides); selectGuias(guides); assert.deepEqual(guides, before);
});
test('la validación rechaza cantidades inválidas, fecha imposible y carga vacía', () => {
    assert.doesNotThrow(() => validateGuia(header, load));
    for (const cantidad of [0, -1, NaN, Infinity, '']) assert.throws(() => validateGuia(header, [{ ...load[0], cantidad }]), /cantidades/);
    assert.throws(() => validateGuia(header, []), /entre 1 y 500/);
    assert.throws(() => validateGuia({ ...header, fecha: '2026-02-30' }, load), /fecha/);
    assert.throws(() => validateGuia({ ...header, fecha: '2026-99-99' }, load), /fecha/);
    assert.throws(() => validateGuia({ ...header, hora: '25:00' }, load), /hora/);
});
test('fechas calendario se conservan sin desplazamiento UTC', () => {
    assert.equal(localGuiaDate('2026-10-21'), '2026-10-21');
    assert.equal(localGuiaDate('fecha incorrecta'), '');
});

test('transporte vacío u omitido es válido y el destino sigue siendo obligatorio', () => {
    for (const transport of [{ chofer: '', vehiculo: '', patente: '' }, { chofer: ' ', vehiculo: null }, { chofer: undefined, vehiculo: undefined }]) {
        assert.doesNotThrow(() => validateGuia({ ...header, ...transport }, load));
    }
    assert.throws(() => validateGuia({ ...header, lugar_entrega: '' }, load), /destino/);
});
test('tiempos de seguimiento no infieren un despacho ausente', () => {
    assert.equal(guiaTiming({ estado: 'EN_TRANSITO' }).transitHours, null);
    assert.equal(guiaTiming({ estado: 'ENTREGADA', despachado_at: '2026-10-21T10:00:00Z', receptor_fecha: '2026-10-21T13:30:00Z' }).deliveryHours, 3.5);
});
test('los documentos cerrados no son editables y la anulación exige rol de gestión', () => {
    assert.equal(canEditGuia({ estado: 'ENTREGADA' }), false);
    assert.equal(canAnnulGuia({ estado: 'PENDIENTE' }, { rol: 'Supervisor' }), true);
    assert.equal(canAnnulGuia({ estado: 'PENDIENTE' }, { rol: 'Bodeguero' }), false);
    assert.equal(canAnnulGuia({ estado: 'ENTREGADA' }, { rol: 'Administrador' }), false);
});
test('CSV respeta filtros y crea una fila independiente por cada artículo', () => {
    const data = [{ ...guides[0], items: [...guides[0].items, { descripcion: 'Manguera "especial"; conexión', cantidad: 1, unidad: 'UN' }] }, guides[1]];
    const csv = buildGuiasCSV(data, { query: '#1' }, new Date('2026-10-21T12:00:00Z'));
    assert.equal(csv.split('\r\n').length, 3);
    assert.match(csv, /"2,5";"LT"/);
    assert.match(csv, /Manguera ""especial""; conexión/);
    assert.doesNotMatch(csv, /Repuesto/);
    assert.equal(buildGuiasCSV(data, { query: 'no existe' }).split('\r\n').length, 1);
});
test('el texto interpolado en vistas conserva caracteres sin producir etiquetas activas', () => {
    assert.equal(escapeGuiaHTML('<img src="x" onerror="alert(1)">'), '&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;');
});
