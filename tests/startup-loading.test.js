import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGuiasRepository } from '../src/guias-db.js';
import { createReturnsRepository } from '../src/returns-db.js';
import { createOutflowSignaturesRepository } from '../src/outflow-signatures.js';

const dbSource = readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const guidesSource = readFileSync(new URL('../src/guias-view.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const data = {
    categorias: [{ nombre: 'Manos' }], areas: [{ nombre: 'Operaciones' }], turnos: [{ nombre: 'Turno A' }],
    inventario: [{ id: 'g', nombre: 'Guantes', codigo: 'G-1', stock: 7 }],
    ingresos: [{ id: 'i', items: [{ eppId: 'g', cantidad: 10 }] }],
    salidas: [{ id: 'a', rut: '1-9', fecha: '2026-09-01', items: [{ eppId: 'g', cantidad: 3 }], firma: 'firma original' }],
    epp_devoluciones: [{ id: 'd', salida_id: 'a', fecha: '2026-10-01', items: [{ linea: 0, cantidad: 1 }] }],
    insumos_mejoras: [{ id: 'ins' }], insumos_movimientos: [{ id: 'mov' }],
    solicitudes_abastecimiento: [{ id: 'req' }], equipos_seriales: [{ numero_serie: 'serie' }],
    prestamos: [{ id: 'prest' }], ajustes_stock: [{ id: 'audit' }],
    guias_despacho: [{ id: 1, folio: 1, items: [{ descripcion: 'Carga', cantidad: 1 }], firma_digital: 'firma guía' }],
    guias_despacho_catalogos: [{ id: 1, tipo: 'destino', nombre: 'Faena' }],
    guias_despacho_config: [{ clave: 'empresa_razon_social', valor: 'Empresa' }]
};

function harness({ rows = data, respond = async () => null, cache = {} } = {}) {
    const calls = [], events = [], notices = [], storage = new Map(Object.entries(cache));
    let active = 0, peak = 0, onLoad;
    async function request(query) {
        calls.push(query);
        active++;
        peak = Math.max(peak, active);
        try {
            const override = await respond(query);
            if (override) return override;
            const selected = (rows[query.table] || []).slice(query.start || 0, (query.end ?? Infinity) + 1);
            return { data: query.rpc ? 5 : structuredClone(selected.map(row => !query.columns || query.columns.split(',').includes('*') ? row : Object.fromEntries(query.columns.split(',').filter(key => key in row).map(key => [key, row[key]])))), error: null };
        } finally { active--; }
    }
    const supabase = {
        from(table) { return {
            table, select(columns = '*') { this.columns = columns; return this; }, order() { return this; },
            range(start, end) { this.start = start; this.end = end; return this; },
            then(resolve, reject) { return request({ table: this.table, columns: this.columns, start: this.start, end: this.end }).then(resolve, reject); }
        }; },
        rpc(name) { return request({ table: name, rpc: true }); }
    };
    const context = vm.createContext({
        supabase, createGuiasRepository, createReturnsRepository, createOutflowSignaturesRepository, currentUser: null,
        console: { warn() {}, error() {} },
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        document: { addEventListener(name, callback) { if (name === 'DOMContentLoaded') onLoad = callback; }, getElementById() { return null; } },
        $: () => null, registered: new WeakSet(),
        showToast: (text, type) => notices.push({ text, type })
    });
    for (const name of ['initAuth', 'populateCategoryDropdowns', 'populateAreasDropdown', 'populateTurnosDropdowns',
        'setupInflowForm', 'setupOutflowForm', 'setCurrentDates', 'initReplenishment', 'initLoans', 'updateDashboardStats',
        'renderInventoryTable', 'renderHistoryTable', 'updateReplenishmentStats', 'populateGuiasCatalogosDropdowns', 'renderGuiasTable', 'initSignaturePad']) {
        context[name] = () => events.push(name);
    }
    vm.runInContext(dbSource.slice(dbSource.indexOf('// Estado de memoria local sincronizado')).replace(/^export /gm, ''), context);
    vm.runInContext(guidesSource.slice(guidesSource.indexOf('export async function initGuiasView('), guidesSource.indexOf('export async function reloadGuias(')).replace(/^export /gm, ''), context);
    vm.runInContext(mainSource.slice(mainSource.indexOf('document.addEventListener("DOMContentLoaded"'), mainSource.indexOf('// SPA view router')), context);
    return { context, calls, events, notices, storage, start: () => onLoad(), active: () => active, peak: () => peak,
        state: () => JSON.parse(vm.runInContext('JSON.stringify({ dbCategorias, dbAreasFull, dbTurnos, dbInventario, dbIngresos, dbSalidas, dbDevoluciones, dbInsumos, dbInsumoMovimientos, dbSolicitudesAbastecimiento, dbEquiposSeriales, dbPrestamos, dbAjustesStock, dbGuias, dbGuiasCatalogos, dbGuiasConfig })', context)) };
}

test('arranque carga el historial completo sin firmas de actas; consulta guías y configuración una sola vez', async () => {
    const app = harness();
    await app.start();
    assert.equal(app.calls.length, 17);
    for (const table of ['guias_despacho', 'guias_despacho_catalogos', 'guias_despacho_config', 'guias_modulo_version']) {
        assert.equal(app.calls.filter(query => query.table === table).length, 1, table);
    }
    const state = app.state();
    assert.deepEqual(state.dbInventario, data.inventario);
    assert.deepEqual(state.dbSalidas, data.salidas.map(({ firma, ...row }) => row));
    assert.ok(app.calls.filter(query => query.table === 'salidas').every(query => !query.columns.split(',').includes('firma')));
    assert.deepEqual(state.dbDevoluciones, data.epp_devoluciones);
    assert.deepEqual(state.dbIngresos, data.ingresos);
    assert.deepEqual(state.dbCategorias, ['Manos']);
    assert.deepEqual(state.dbAreasFull, data.areas);
    assert.deepEqual(state.dbTurnos, ['Turno A']);
    assert.deepEqual(state.dbInsumos, data.insumos_mejoras);
    assert.deepEqual(state.dbInsumoMovimientos, data.insumos_movimientos);
    assert.deepEqual(state.dbSolicitudesAbastecimiento, data.solicitudes_abastecimiento);
    assert.deepEqual(state.dbEquiposSeriales, data.equipos_seriales);
    assert.deepEqual(state.dbPrestamos, data.prestamos);
    assert.deepEqual(state.dbAjustesStock, data.ajustes_stock);
    assert.deepEqual(state.dbGuias, data.guias_despacho);
    assert.deepEqual(state.dbGuiasCatalogos.destinos, data.guias_despacho_catalogos);
    assert.deepEqual(state.dbGuiasConfig, { empresa_razon_social: 'Empresa' });
    assert.equal(app.notices.at(-1).text, 'Base de datos cargada correctamente.');
    assert.equal(app.active(), 0);
});

test('una consulta lenta no anuncia listo ni inicializa formularios antes de completar el historial', async () => {
    const gate = deferred();
    const app = harness({ respond: query => query.table === 'salidas' ? gate.promise : null });
    const loading = app.start();
    await tick();
    assert.ok(app.peak() > 1);
    assert.ok(app.peak() <= 4, 'tres cargadores, uno con dos consultas de configuración');
    assert.equal(app.events.includes('setupOutflowForm'), false);
    assert.equal(app.notices.some(notice => notice.type === 'success'), false);
    gate.resolve(null);
    await loading;
    assert.ok(app.events.includes('setupOutflowForm'));
    assert.equal(app.notices.at(-1).type, 'success');
});

test('paginación conserva más de 500 actas y devoluciones con respuestas en distinto orden', async () => {
    const salidas = Array.from({ length: 1001 }, (_, id) => ({ ...data.salidas[0], id: String(id) }));
    const devoluciones = Array.from({ length: 501 }, (_, id) => ({ ...data.epp_devoluciones[0], id: String(id) }));
    const app = harness({ rows: { ...data, salidas, epp_devoluciones: devoluciones } });
    await app.start();
    assert.equal(app.state().dbSalidas.length, 1001);
    assert.equal(app.state().dbDevoluciones.length, 501);
    assert.deepEqual(app.calls.filter(query => query.table === 'salidas').map(query => query.start), [0, 500, 1000]);
    assert.deepEqual(app.calls.filter(query => query.table === 'epp_devoluciones').map(query => query.start), [0, 500]);
});

test('fallo crítico impide anunciar listo y no deja cargadores activos al terminar', async () => {
    const gate = deferred();
    const error = new Error('Inventario no disponible');
    const app = harness();
    let queuedStarted = false;
    const loaders = [() => Promise.reject(error), () => gate.promise, () => gate.promise, () => { queuedStarted = true; }];
    let ended = false;
    const loading = app.context.loadInParallel(loaders).then(() => { ended = true; }, failure => { ended = true; assert.equal(failure, error); });
    await tick();
    assert.equal(ended, false);
    gate.resolve();
    await loading;
    assert.equal(queuedStarted, false);
    for (const table of ['categorias', 'inventario', 'ingresos', 'salidas', 'insumos_mejoras', 'insumos_movimientos']) {
        const failing = harness({ respond: query => query.table === table ? { data: null, error: { message: 'Consulta no disponible' } } : null });
        await failing.start();
        assert.equal(failing.notices.some(notice => notice.type === 'success'), false, table);
        assert.equal(failing.events.includes('setupOutflowForm'), false, table);
        assert.equal(failing.active(), 0, table);
        assert.equal(failing.notices.at(-1).type, 'danger', table);
    }
});

test('mantiene los fallbacks existentes y no habilita saldos netos sin devoluciones confirmadas', async () => {
    const optional = new Set(['areas', 'turnos', 'solicitudes_abastecimiento', 'equipos_seriales', 'prestamos', 'ajustes_stock', 'epp_devoluciones']);
    const app = harness({ respond: query => optional.has(query.table) ? { data: null, error: { code: 'PGRST205', message: 'Sin tabla' } } : null,
        cache: { db_areas_full: JSON.stringify(data.areas), db_prestamos: JSON.stringify(data.prestamos), db_ajustes_stock: JSON.stringify(data.ajustes_stock) } });
    await app.start();
    assert.deepEqual(app.state().dbAreasFull, data.areas);
    assert.deepEqual(app.state().dbTurnos, ['Turno A', 'Turno B']);
    assert.deepEqual(app.state().dbPrestamos, data.prestamos);
    assert.deepEqual(app.state().dbAjustesStock, data.ajustes_stock);
    assert.equal(vm.runInContext('dbDevolucionesStatus.ready', app.context), false);
    assert.match(vm.runInContext('dbDevolucionesStatus.error', app.context), /actualización SQL/);
});

test('la inicialización independiente de guías conserva la recarga por defecto', async () => {
    const app = harness();
    await app.context.initGuiasView();
    assert.equal(app.calls.length, 4);
});

test('un fallo transitorio de guías conserva el reintento sin repetir las cargas confirmadas', async () => {
    let attempts = 0;
    const app = harness({ respond: query => query.table === 'guias_despacho' && ++attempts === 1 ? { data: null, error: { message: 'Error transitorio' } } : null });
    await app.start();
    assert.equal(attempts, 2);
    assert.equal(app.calls.filter(query => query.table === 'guias_despacho_config').length, 1);
    assert.equal(app.calls.filter(query => query.table === 'guias_despacho_catalogos').length, 1);
    assert.equal(app.calls.length, 18);
    assert.deepEqual(app.state().dbGuias, data.guias_despacho);
    assert.equal(vm.runInContext('dbGuiasStatus.online', app.context), true);
});
