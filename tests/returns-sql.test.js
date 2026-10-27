import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createReturnsDatabase, migration } from './helpers/returns-fixture.js';

test('devoluciones en PostgreSQL aislado', { timeout: 90000 }, async t => {
    const db = await createReturnsDatabase();
    try {
        const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.value;
        const act = async (items = [{ linea: 0, cantidad: 2 }], requestId = randomUUID(), extra = {}) => {
            const original = await scalar('SELECT items AS value FROM salidas WHERE id=$1', [extra.acta || 'a']);
            const payload = items.map(item => ({ eppId: original?.[item.linea]?.eppId, entregado: original?.[item.linea]?.cantidad, ...item }));
            return scalar('SELECT epp_registrar_devolucion($1,$2,$3::jsonb,$4,$5,$6::uuid) AS value',
                [extra.rut || '11.111.111-1', extra.acta || 'a', JSON.stringify(payload), extra.motivo ?? 'No utilizado', extra.notas || '', requestId]);
        };
        const stock = () => scalar("SELECT stock AS value FROM inventario WHERE id='g'");
        await t.test('parcial, reintento idempotente, rechazo de cambios y total', async () => {
            const id = randomUUID();
            const first = await act(undefined, id);
            assert.equal(await stock(), '9');
            assert.equal(first.items[0].stock_anterior, 7);
            assert.equal(first.items[0].stock_nuevo, 9);
            assert.equal((await act(undefined, id)).id, first.id);
            assert.equal(await stock(), '9');
            await assert.rejects(act([{ linea: 0, cantidad: 1 }], id), /otros datos/);
            await assert.rejects(act([{ linea: 0, cantidad: 2 }]), /saldo/);
            await act([{ linea: 0, cantidad: 1 }, { linea: 1, cantidad: 2 }]);
            assert.equal(await stock(), '10');
            assert.equal(await scalar("SELECT stock AS value FROM inventario WHERE id='c'"), '10');
            await assert.rejects(act([{ linea: 0, cantidad: 1 }]), /saldo/);
            assert.deepEqual(await scalar("SELECT items AS value FROM salidas WHERE id='a'"), [{ eppId: 'g', cantidad: 3 }, { eppId: 'c', cantidad: 2 }]);
        });
        await t.test('rechaza actor sin permiso, origen inexistente y entradas inválidas', async () => {
            await assert.rejects(act(undefined, undefined, { rut: '22.222.222-2' }), /autorizado/);
            await assert.rejects(act(undefined, undefined, { rut: 'inexistente' }), /autorizado/);
            await assert.rejects(act(undefined, undefined, { acta: 'inexistente' }), /no existe/);
            await assert.rejects(act([{ linea: 0, cantidad: 1, eppId: 'otro' }]), /original cambió/);
            for (const items of [[], [{ linea: -1, cantidad: 1 }], [{ linea: 99, cantidad: 1 }], [{ linea: '0', cantidad: 1 }], [{ linea: 0, cantidad: '1' }], [{ linea: 0, cantidad: -1 }]]) {
                await assert.rejects(act(items));
            }
        });
        await t.test('conserva actas relacionadas y bloquea escrituras directas a devoluciones', async () => {
            await assert.rejects(db.exec("DELETE FROM salidas WHERE id='a'"), /debe conservarse/);
            await assert.rejects(db.exec("UPDATE salidas SET items='[]' WHERE id='a'"), /No se puede modificar/);
            await assert.rejects(db.exec("UPDATE salidas SET firma='otra' WHERE id='a'"), /No se puede modificar/);
            await db.exec('SET ROLE anon');
            await assert.rejects(db.exec('DELETE FROM epp_devoluciones'), /permission denied/);
            await db.exec('RESET ROLE');
        });
        await t.test('un fallo posterior al cambio de stock revierte todo', async () => {
            await db.exec(`INSERT INTO salidas SELECT 'b',fecha,trabajador,rut,area,turno,items,firma,registrado_por FROM salidas WHERE id='a';
                CREATE FUNCTION fail_return() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fallo simulado'; END $$;
                CREATE TRIGGER fail_return BEFORE INSERT ON epp_devoluciones FOR EACH ROW EXECUTE FUNCTION fail_return();`);
            const before = await stock();
            await assert.rejects(act(undefined, undefined, { acta: 'b' }), /Fallo simulado/);
            assert.equal(await stock(), before);
            assert.equal(await scalar("SELECT count(*)::integer AS value FROM epp_devoluciones WHERE salida_id='b'"), 0);
            await db.exec('DROP TRIGGER fail_return ON epp_devoluciones');
        });
        await t.test('artículos repetidos se distinguen por línea; una línea repetida se rechaza', async () => {
            await db.exec(`INSERT INTO salidas SELECT 'repeated',fecha,trabajador,rut,area,turno,'[{"eppId":"g","cantidad":1},{"eppId":"g","cantidad":2}]',firma,registrado_por FROM salidas WHERE id='a'`);
            const before = Number(await stock());
            await assert.rejects(act([{ linea: 0, cantidad: 1 }, { linea: 0, cantidad: 1 }], undefined, { acta: 'repeated' }), /repetida/);
            assert.equal(Number(await stock()), before);
            await act([{ linea: 0, cantidad: 1 }, { linea: 1, cantidad: 2 }], undefined, { acta: 'repeated' });
            assert.equal(Number(await stock()), before + 3);
        });
        await t.test('reaplicar la migración conserva movimientos y stock', async () => {
            const before = await stock();
            const count = await scalar('SELECT count(*)::integer AS value FROM epp_devoluciones');
            await db.exec(migration);
            assert.equal(await stock(), before);
            assert.equal(await scalar('SELECT count(*)::integer AS value FROM epp_devoluciones'), count);
        });
        await t.test('solicitudes simultáneas no pueden recuperar dos veces el saldo restante', async () => {
            await db.exec(`INSERT INTO salidas SELECT 'single',fecha,trabajador,rut,area,turno,'[{"eppId":"g","cantidad":1}]',firma,registrado_por FROM salidas WHERE id='a'`);
            const before = Number(await stock());
            const results = await Promise.allSettled([act([{ linea: 0, cantidad: 1 }], undefined, { acta: 'single' }), act([{ linea: 0, cantidad: 1 }], undefined, { acta: 'single' })]);
            assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
            assert.equal(Number(await stock()), before + 1);
        });
        await t.test('stock entero rechaza fracciones que provocarían redondeo', async () => {
            const integerDb = await createReturnsDatabase({ integerStock: true });
            try {
                await assert.rejects(integerDb.query('SELECT epp_registrar_devolucion($1,$2,$3::jsonb,$4,$5,$6::uuid)',
                    ['11.111.111-1', 'a', JSON.stringify([{ linea: 0, cantidad: 0.5, eppId: 'g', entregado: 3 }]), 'No utilizado', '', randomUUID()]), /precisión/);
                assert.equal((await integerDb.query("SELECT stock FROM inventario WHERE id='g'")).rows[0].stock, 7);
            } finally { await integerDb.close(); }
        });
    } finally { await db.close(); }
});
