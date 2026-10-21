import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildAnalyticsExportSections, serializeAnalyticsCSV, formatExportDate } from '../src/analytics-export.js';

const inventory = [
    { id: 'g', codigo: 'G-01', nombre: 'Guante anticorte', categoria: 'Manos', unidad: 'Par', stock: 10, stock_minimo: 5, duracion_meses: 6 },
    { id: 'c', codigo: 'C-01', nombre: 'Casco', categoria: 'Cabeza', unidad: 'Unidad', stock: 20, stock_minimo: 3, duracion_meses: 12 }
];
const item = (eppId, cantidad, analytics = {}) => ({ eppId, cantidad, analytics });
const delivery = (id, fecha, items, extra = {}) => ({
    id, fecha, items, rut: '11.111.111-1', trabajador: 'Ana', area: 'Operaciones', turno: 'Turno A',
    ...extra
});
const generatedAt = new Date('2026-10-21T15:00:00Z');
const build = (data = {}) => buildAnalyticsExportSections({ inventory, generatedAt, ...data });
const section = (sections, id) => sections.find(entry => entry.id === id);
const cell = (table, row, header) => row[table.headers.indexOf(header)];

// Lector CSV independiente para comprobar el archivo que recibirá Excel.
function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const records = [];
    let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === '"') {
            if (quoted && text[i + 1] === '"') { value += '"'; i++; }
            else quoted = !quoted;
        } else if (char === ';' && !quoted) {
            row.push(value); value = '';
        } else if (char === '\r' && text[i + 1] === '\n' && !quoted) {
            row.push(value); records.push(row); row = []; value = ''; i++;
        } else value += char;
    }
    if (value || row.length) { row.push(value); records.push(row); }
    assert.equal(quoted, false, 'El CSV no puede terminar con una celda abierta');
    return records;
}

test('exporta todas las líneas, sus antecedentes, motivos y responsables sin truncar por página', () => {
    const deliveries = Array.from({ length: 120 }, (_, i) => delivery(`acta-${i}`, '2026-10-10T12:00:00', [item('g', 2, {
        previousDeliveryDate: '2026-09-25T12:00:00', daysSincePrevious: 15, lifespanDays: 180, isCritical: true
    })], { motivo_entrega: 'Desgaste', comentarios: 'Cambio revisado', registrado_por: 'Bodega', firma: 'data:image/png;base64,PRUEBA' }));
    const sections = build({ deliveries });
    const detail = section(sections, 'deliveries');
    assert.equal(detail.rows.length, 120);
    assert.equal(cell(detail, detail.rows[0], 'Entrega anterior (historial completo)'), '2026-09-25T12:00:00');
    assert.equal(cell(detail, detail.rows[0], 'Motivo de entrega'), 'Desgaste');
    assert.equal(cell(detail, detail.rows[0], 'Registrado por'), 'Bodega');
    assert.equal(cell(detail, detail.rows[0], 'Registro de firma'), 'Firma digital registrada');
    assert.equal(section(sections, 'alerts').rows.length, 120);
    assert.equal(section(sections, 'summary').rows.find(row => row[0] === 'Cantidad despachada (Par)')[1], 240);
    assert.equal(serializeAnalyticsCSV(sections).includes('base64'), false);
});

test('ranking dentro de cada EPP agrupa por RUT normalizado y diferencia cantidades de actas', () => {
    const sections = build({ deliveries: [
        delivery('a1', '2026-10-01T12:00:00', [item('g', 2), item('c', 1)]),
        delivery('a2', '2026-10-11T12:00:00', [item('g', 3)], { rut: '11111111-1', trabajador: 'Ana actualizada', area: 'Mantención' }),
        delivery('b1', '2026-10-05T12:00:00', [item('g', 15)], { rut: '22222222-2', trabajador: 'Luis' })
    ] });
    const operators = section(sections, 'operators');
    const gloves = operators.rows.filter(row => cell(operators, row, 'ID EPP') === 'g');
    assert.equal(gloves.length, 2);
    assert.equal(cell(operators, gloves[0], 'Operador'), 'Luis');
    assert.equal(cell(operators, gloves[0], 'Participación en cantidad del EPP (%)'), 75);
    assert.equal(cell(operators, gloves[1], 'Cantidad recibida'), 5);
    assert.equal(cell(operators, gloves[1], 'Actas distintas'), 2);
    assert.equal(cell(operators, gloves[1], 'Cantidad media por acta'), 2.5);
    assert.equal(cell(operators, gloves[1], 'Intervalo medio entre actas seleccionadas (días)'), 10);
    assert.equal(cell(operators, gloves[1], 'Operador'), 'Ana actualizada');
    assert.match(cell(operators, gloves[1], 'Áreas registradas'), /Mantención.*Operaciones/);
    const helmet = operators.rows.find(row => cell(operators, row, 'ID EPP') === 'c');
    assert.equal(cell(operators, helmet, 'Posición dentro del EPP'), 1);
    assert.equal(cell(operators, helmet, 'Intervalo medio entre actas seleccionadas (días)'), '');
    assert.equal(cell(operators, helmet, 'Participación en cantidad del EPP (%)'), 100);
});

test('las actas con varios artículos se cuentan una vez y las cantidades no mezclan unidades', () => {
    const sections = build({ deliveries: [delivery('a1', '2026-10-01', [item('g', 2), item('c', 1)])] });
    const summary = section(sections, 'summary');
    assert.equal(summary.rows.find(row => row[0] === 'Actas distintas')[1], 1);
    const areas = section(sections, 'areas');
    assert.equal(areas.rows.length, 2);
    assert.deepEqual(areas.rows.map(row => [row[1], row[2]]), [['Par', 2], ['Unidad', 1]]);
});

test('no fusiona personas sin RUT ni inventa stock para artículos fuera del catálogo', () => {
    const sections = build({ deliveries: [
        delivery('x1', 'fecha inválida', [item('desconocido', 'no numérico')], { rut: '', trabajador: 'Sin identificar' }),
        delivery('x2', '2026-10-02T12:00:00', [item('desconocido', 2)], { rut: '', trabajador: 'Sin identificar' })
    ] });
    assert.equal(section(sections, 'operators').rows.length, 2);
    const products = section(sections, 'products');
    assert.equal(cell(products, products.rows[0], 'Stock actual (referencia)'), '');
    assert.equal(cell(products, products.rows[0], 'Cantidad despachada'), 2);
    const detail = section(sections, 'deliveries');
    assert.match(cell(detail, detail.rows[1], 'Observaciones de datos'), /Fecha inválida.*Sin RUT.*SKU fuera.*Cantidad no numérica/);
    assert.equal(cell(detail, detail.rows[1], 'Cantidad'), 'no numérico');
});

test('CSV preserva separadores, comillas, saltos de línea, tildes y neutraliza fórmulas en texto', () => {
    const sections = [{ id: 'values', title: 'Prueba', headers: ['Texto', 'Decimal', 'Cero', 'Vacío', 'Fórmula', 'Con espacio', 'Con tab'], rows: [
        ['Protección; "oídos"\nsegunda línea', 2.5, 0, null, '=HYPERLINK("https://example.com")', '  +SUM(1)', '\t@SUM(1)']
    ] }];
    const csv = serializeAnalyticsCSV(sections, 'values');
    assert.equal(csv.charCodeAt(0), 0xFEFF);
    const records = parseCSV(csv);
    assert.equal(records.length, 2);
    assert.deepEqual(records[1], ['Protección; "oídos"\nsegunda línea', '2,5', '0', '', '\'=HYPERLINK("https://example.com")', '\'  +SUM(1)', "'\t@SUM(1)"]);
    assert.equal(records[1].length, records[0].length);
});

test('cada tabla independiente tiene una sola cabecera, contexto y filas rectangulares', () => {
    const sections = build({ deliveries: [delivery('x', '2026-10-01', [item('g', 1)])], filters: { product: 'g', startDate: '2026-10-01' } });
    for (const mode of ['deliveries', 'operators', 'products']) {
        const records = parseCSV(serializeAnalyticsCSV(sections, mode));
        assert.deepEqual(records[0], section(sections, mode).headers);
        assert.equal(records.length, 2);
        assert.equal(records[1].length, records[0].length);
        assert.match(records[1].at(-1), /SKU: G-01 - Guante anticorte/);
        assert.equal(records[1].at(-2), generatedAt.toISOString());
    }
    assert.throws(() => serializeAnalyticsCSV(sections, 'no-existe'), /desconocido/);
});

test('informe completo conserva observados, stock y requerimientos con su alcance explícito', () => {
    const sections = build({
        filters: { area: 'Operaciones' },
        observed: [{ trabajador: 'Ana', rut: '1-1', area: 'Operaciones', eppName: 'Guante', entregasCount: 2, avgDays: 10, lifespanDays: 180 }],
        runway: [{ codigo: 'G-01', nombre: 'Guante', stock: 2, runwayDays: 3, runwayText: '3 días', riskText: 'Crítico' }],
        requests: [{ id: 's1', codigo: 'REQ-1', trabajador: 'Ana', items: [{ nombre: 'Guante', solicitado: 5, recibido: 2 }] }]
    });
    assert.equal(section(sections, 'observed').rows.length, 1);
    assert.equal(section(sections, 'stock').rows.length, 1);
    const requests = section(sections, 'requests');
    assert.equal(cell(requests, requests.rows[0], 'Cantidad pendiente'), 3);
    assert.match(section(sections, 'metadata').rows.find(row => row[0] === 'Requerimientos')[1], /no aplica SKU/);
    const csv = serializeAnalyticsCSV(sections);
    assert.match(csv, /CONSUMO POR TURNO/);
    assert.match(csv, /EVOLUCIÓN MENSUAL/);
    assert.match(csv, /COLABORADORES OBSERVADOS/);
    assert.match(csv, /COBERTURA DE STOCK/);
    assert.equal(csv.includes('undefined'), false);
});

test('selección vacía mantiene cabeceras y valores de cero, sin filas ficticias', () => {
    const sections = build();
    for (const mode of ['deliveries', 'operators', 'products']) {
        assert.equal(parseCSV(serializeAnalyticsCSV(sections, mode)).length, 1);
    }
    assert.equal(section(sections, 'summary').rows.find(row => row[0] === 'Actas distintas')[1], 0);
    assert.equal(section(sections, 'operators').rows.length, 0);
});

test('no modifica datos ni orden originales', () => {
    const input = { inventory, generatedAt, deliveries: [
        delivery('posterior', '2026-10-15', [item('g', 1)]),
        delivery('anterior', '2026-10-01', [item('g', 2)])
    ] };
    const before = structuredClone(input);
    buildAnalyticsExportSections(input);
    assert.deepEqual(input, before);
});

// Integra el renderer real con DOM y descargas simuladas, sin importar db.js.
function dashboardHarness(deliveries, filters = {}, mode = 'deliveries') {
    const elements = new Map();
    for (const id of ['area', 'category', 'product', 'shift', 'worker', 'alert', 'start-date', 'end-date']) {
        elements.set(`ana-filter-${id}`, { value: filters[id] || '', options: [{}, {}] });
    }
    for (const id of ['total', 'deviation', 'shift-ratio', 'sla', 'total-sub', 'deviation-sub', 'shift-sub', 'sla-sub']) {
        elements.set(`ana-kpi-${id}`, { textContent: '', innerHTML: '' });
    }
    elements.set('ana-export-type', { value: mode });
    const downloads = [], notices = [], links = [];
    const context = {
        dbInventario: inventory, dbSalidas: deliveries, dbInsumos: [], dbAreas: [], dbCategorias: [],
        window: {}, Blob, buildAnalyticsExportSections, serializeAnalyticsCSV, formatExportDate,
        showToast: (...args) => notices.push(args), setTimeout: callback => callback(),
        URL: { createObjectURL: blob => { downloads.push(blob); return 'blob:prueba'; }, revokeObjectURL() {} },
        document: {
            getElementById: id => elements.get(id) || null, querySelectorAll: () => [],
            body: { appendChild() {} },
            createElement: () => { const link = { setAttribute(key, value) { this[key] = value; }, click() {}, remove() {} }; links.push(link); return link; }
        }
    };
    const source = readFileSync(new URL('../src/analytics.js', import.meta.url), 'utf8')
        .replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '');
    vm.createContext(context);
    vm.runInContext(source, context);
    return { context, elements, downloads, notices, links };
}

test('botón exporta la misma selección del panel e incluye antecedente anterior al período', async () => {
    const history = [
        delivery('historia', '2026-09-20T12:00:00', [item('g', 1)]),
        delivery('seleccionada', '2026-10-05T12:00:00', [item('g', 3), item('c', 1)]),
        delivery('otra-area', '2026-10-05T12:00:00', [item('g', 20)], { area: 'Otra' }),
        delivery('otro-turno', '2026-10-05T12:00:00', [item('g', 30)], { turno: 'Turno B' }),
        delivery('otro-operador', '2026-10-05T12:00:00', [item('g', 40)], { trabajador: 'Luis', rut: '22222222-2' })
    ];
    const before = structuredClone(history);
    const harness = dashboardHarness(history, {
        area: 'Operaciones', category: 'Manos', product: 'g', shift: 'Turno A', worker: 'ana',
        alert: 'critical', 'start-date': '2026-10-01', 'end-date': '2026-10-31'
    });
    harness.context.exportAnalyticsCSV();
    assert.equal(harness.downloads.length, 1);
    const records = parseCSV(await harness.downloads[0].text());
    assert.equal(records.length, 2);
    assert.equal(records[1][records[0].indexOf('ID acta')], 'seleccionada');
    assert.equal(records[1][records[0].indexOf('Cantidad')], '3');
    assert.equal(records[1][records[0].indexOf('Entrega anterior (historial completo)')], '2026-09-20T12:00:00');
    assert.equal(harness.elements.get('ana-kpi-total').textContent, 3);
    assert.match(harness.links[0].download, /^Analitica_EPP_deliveries_\d{4}-\d{2}-\d{2}\.csv$/);
    assert.deepEqual(history, before);
});

test('botón no limita por páginas, refresca la selección y bloquea fechas invertidas', async () => {
    const data = Array.from({ length: 40 }, (_, i) => delivery(`a-${i}`, '2026-10-05T12:00:00', [item('g', 1)]));
    const harness = dashboardHarness(data);
    harness.context.changeAnalyticsDeviationsPageSize(10);
    harness.context.exportAnalyticsCSV();
    assert.equal(parseCSV(await harness.downloads[0].text()).length, 41);
    harness.elements.get('ana-filter-product').value = 'c';
    harness.context.exportAnalyticsCSV();
    assert.equal(parseCSV(await harness.downloads[1].text()).length, 1);
    harness.elements.get('ana-filter-start-date').value = '2026-10-31';
    harness.elements.get('ana-filter-end-date').value = '2026-10-01';
    harness.context.exportAnalyticsCSV();
    assert.equal(harness.downloads.length, 2);
    assert.equal(harness.notices.at(-1)[1], 'warning');
});
