import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGuiasRepository } from '../src/guias-db.js';
import { createReturnsRepository } from '../src/returns-db.js';

const dbSource = readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
const storageKey = 'db_guias_despacho_v2';

function harness({ cache = {}, response = () => ({ data: [], error: null }) } = {}) {
    const storage = new Map(Object.entries(cache));
    const context = {
        createReturnsRepository,
        createGuiasRepository: (client, cache) => createGuiasRepository(client, cache, () => ({ rut: '11.111.111-1' })),
        console: { warn() {}, error() {} },
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value)
        },
        supabase: {
            rpc(name, payload) { return Promise.resolve(response({ table: 'rpc', operation: 'rpc', name, payload })); },
            from(table) {
                return {
                    table, operation: 'select',
                    select() { return this; }, order() { return this; }, eq() { return this; }, single() { return this; }, range() { return this; },
                    insert(payload) { this.operation = 'insert'; this.payload = payload; return this; },
                    then(resolve, reject) { return Promise.resolve(response(this)).then(resolve, reject); }
                };
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(dbSource.slice(dbSource.indexOf('// Estado de memoria local sincronizado'))
        .replace(/^export /gm, '') + '\nthis.setGuias = rows => { dbGuias = rows; };', context);
    return { context, storage };
}

test('una respuesta vacía del servidor vacía memoria y caché, aunque existan guías anteriores', async () => {
    const historical = [{ id: 1, folio: 41 }];
    const { context, storage } = harness({ cache: { [storageKey]: JSON.stringify(historical) } });
    context.setGuias(historical);
    const result = await context.dbFetchGuias();
    assert.equal(result.length, 0);
    assert.equal(storage.get(storageKey), '[]');
});

test('un error de conexión no recupera la antigua caché histórica', async () => {
    const { context } = harness({
        cache: { db_guias_despacho: JSON.stringify([{ id: 1, folio: 41 }]) },
        response: () => ({ data: null, error: { message: 'Sin conexión' } })
    });
    assert.equal((await context.dbFetchGuias()).length, 0);
});

test('un error de conexión conserva las nuevas guías de la caché vigente', async () => {
    const current = [{ id: 900, folio: 1 }];
    const { context } = harness({
        cache: { [storageKey]: JSON.stringify(current) },
        response: () => ({ data: null, error: { message: 'Sin conexión' } })
    });
    assert.equal(JSON.stringify(await context.dbFetchGuias()), JSON.stringify(current));
});

test('una caché corrupta o con formato incorrecto no repone guías históricas', async () => {
    for (const cached of ['{incompleto', '{"folio":41}', 'null']) {
        const { context } = harness({ cache: { [storageKey]: cached }, response: () => ({ error: { message: 'Sin conexión' } }) });
        assert.equal((await context.dbFetchGuias()).length, 0);
    }
});

test('la inicialización completa admite tablas vacías y actualiza la caché de guías', async () => {
    const { context, storage } = harness({ cache: { db_guias_despacho: '[{"folio":41}]' } });
    await context.initDatabase();
    assert.equal(storage.get(storageKey), '[]');
    assert.equal((await context.dbFetchGuias()).length, 0);
});

test('la primera nueva guía usa folio 1 y se guarda en la caché renovada', async () => {
    const { context, storage } = harness({
        response: query => ({ data: query.name === 'guias_modulo_version' ? 3 : query.name === 'guias_operar_aplicacion' ? { id: 900, folio: 1, items: [{ descripcion: 'Carga de prueba', cantidad: 1, unidad: 'UN' }] } : [], error: null })
    });
    const result = await context.dbInsertGuia({ lugar_entrega: 'Destino de prueba', fecha: '2026-10-21', hora: '09:00', chofer: 'Chofer', vehiculo: 'Camioneta' }, [{ descripcion: 'Carga de prueba', cantidad: 1, unidad: 'UN' }]);
    assert.equal(result.folio, 1);
    assert.equal(result.id, 900);
    assert.equal(JSON.parse(storage.get(storageKey))[0].folio, 1);
    assert.equal(storage.has('db_guias_despacho'), false);
});

test('la instalación ya no importa guías ni sus ítems históricos', () => {
    const sql = readFileSync(new URL('../scratch/setup_guias_despacho.sql', import.meta.url), 'utf8');
    assert.doesNotMatch(sql, /INSERT INTO guias_despacho\s*\(/i);
    assert.doesNotMatch(sql, /INSERT INTO guia_despacho_items\s*\(/i);
    assert.doesNotMatch(dbSource, /guiasSeed|guias_seed\.json/);
    assert.doesNotMatch(sql, /INSERT INTO guias_despacho_catalogos/);
    assert.doesNotMatch(sql, /INSERT INTO guias_despacho_config/);
    assert.doesNotMatch(dbSource, /defVehiculos|defDestinos|defChoferes|Maxus T60|PWM Chile/);
    assert.match(sql, /EXISTS \(SELECT 1 FROM guias_despacho\)/);
});
