import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const setup = readFileSync(new URL('../scratch/setup_guias_despacho.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../scratch/upgrade_guias_despacho_v2.sql', import.meta.url), 'utf8');
const header = { fecha: '2026-10-21', hora: '09:00', lugar_entrega: 'Faena de prueba', chofer: 'Chofer de prueba', vehiculo: 'Camioneta', patente: 'ABCD12', emisor_nombre: 'Responsable', observaciones: 'Prueba' };
const load = [{ articulo: '1', descripcion: 'Carga 1/2" <sin HTML activo>', cantidad: 2.5, unidad: 'UN', observacion: 'Frágil' }];
const signature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3x8AAAAASUVORK5CYII=';

test('migración de Guías v2 en PostgreSQL aislado', { timeout: 90000 }, async t => {
    const db = new PGlite();
    try {
        await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
            CREATE TABLE public.usuarios(rut text PRIMARY KEY,nombre text,rol text,password text,cambio_clave_pendiente boolean DEFAULT false);
            INSERT INTO public.usuarios VALUES ('11.111.111-1','Supervisor Prueba','Supervisor','clave-test',false),('22.222.222-2','Operador Prueba','Bodeguero','clave-test',false);
            CREATE FUNCTION public.verificar_credenciales(p_rut text,p_password text)
            RETURNS TABLE(success boolean,rut text,nombre text,rol text,cambio_clave_pendiente boolean)
            LANGUAGE sql SECURITY DEFINER AS $$ SELECT u.password=p_password,u.rut,u.nombre,u.rol,u.cambio_clave_pendiente FROM public.usuarios u WHERE u.rut=p_rut $$;`);
        await db.exec(setup);
        await db.exec('GRANT ALL ON public.guias_despacho,public.guia_despacho_items,public.guias_despacho_audit,public.guias_despacho_catalogos,public.guias_despacho_config TO anon,authenticated;');
        await db.exec(migration);
        const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
        const login = async rut => scalar('SELECT public.guias_iniciar_sesion($1,$2) AS value', [rut, 'clave-test']);
        const admin = await login('11.111.111-1');
        const operator = await login('22.222.222-2');
        const act = async (action, payload = {}, token = admin.token) => scalar('SELECT public.guias_operar($1,$2,$3::jsonb) AS value', [token, action, JSON.stringify(payload)]);
        const create = (extra = {}, items = load, token = admin.token) => act('crear', { request_id: randomUUID(), guia: { ...header, ...extra }, items }, token);
        const revise = (guia, fields = {}) => ({ id: guia.id, expected_updated_at: guia.updated_at, ...fields });

        await t.test('instalar no crea guías y el primer folio es 1', async () => {
            assert.equal(await scalar('SELECT count(*)::integer AS value FROM public.guias_despacho'), 0);
            const guia = await create();
            assert.equal(guia.folio, 1);
            assert.equal(guia.items[0].cantidad, 2.5);
            assert.equal(guia.items[0].descripcion, load[0].descripcion);
        });
        await t.test('reintentar la misma solicitud no duplica guía ni folio', async () => {
            const payload = { request_id: randomUUID(), guia: header, items: load };
            const first = await act('crear', payload);
            const second = await act('crear', payload);
            assert.equal(first.id, second.id);
            assert.equal(first.folio, second.folio);
            await assert.rejects(act('crear', { ...payload, guia: { ...header, lugar_entrega: 'Otro destino' } }), /ya fue guardada con otros datos/);
        });
        await t.test('un fallo al insertar carga revierte cabecera, auditoría y contador', async () => {
            await db.exec(`CREATE FUNCTION public.fallar_carga() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.descripcion='FALLAR' THEN RAISE EXCEPTION 'Fallo de carga simulado'; END IF; RETURN NEW; END $$;
                CREATE TRIGGER prueba_fallo_carga BEFORE INSERT ON public.guia_despacho_items FOR EACH ROW EXECUTE FUNCTION public.fallar_carga();`);
            const before = await scalar('SELECT jsonb_build_array((SELECT count(*) FROM public.guias_despacho),(SELECT count(*) FROM public.guias_despacho_audit),(SELECT last_folio FROM guia_private.folio_counter)) AS value');
            await assert.rejects(create({}, [{ ...load[0], descripcion: 'FALLAR' }]), /Fallo de carga/);
            const after = await scalar('SELECT jsonb_build_array((SELECT count(*) FROM public.guias_despacho),(SELECT count(*) FROM public.guias_despacho_audit),(SELECT last_folio FROM guia_private.folio_counter)) AS value');
            assert.deepEqual(after, before);
        });
        await t.test('un fallo al reemplazar carga conserva el documento original', async () => {
            const guia = await create();
            await assert.rejects(act('editar', revise(guia, { guia: { ...header, observaciones: 'No persistir' }, items: [{ ...load[0], descripcion: 'FALLAR' }] })), /Fallo de carga/);
            assert.deepEqual(await scalar('SELECT guia_private.documento($1) AS value', [guia.id]), guia);
        });
        await t.test('un fallo de auditoría revierte la operación completa', async () => {
            await db.exec(`CREATE FUNCTION public.fallar_auditoria() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fallo de auditoría simulado'; END $$;
                CREATE TRIGGER prueba_fallo_audit BEFORE INSERT ON public.guias_despacho_audit FOR EACH ROW EXECUTE FUNCTION public.fallar_auditoria();`);
            const before = await scalar('SELECT count(*)::integer AS value FROM public.guias_despacho');
            await assert.rejects(create(), /Fallo de auditoría/);
            assert.equal(await scalar('SELECT count(*)::integer AS value FROM public.guias_despacho'), before);
            await db.exec('DROP TRIGGER prueba_fallo_audit ON public.guias_despacho_audit;');
        });
        await t.test('cantidades cero, negativas, texto y carga vacía son rechazadas', async () => {
            for (const cantidad of [0, -1, '2']) await assert.rejects(create({}, [{ ...load[0], cantidad }]), /cantidades|cantidad/);
            await assert.rejects(create({}, []), /entre 1 y 500/);
        });
        await t.test('el servidor ignora el autor propuesto y atribuye la operación a la sesión', async () => {
            const guia = await create({ created_by: 'Identidad falsa' }, load, operator.token);
            assert.equal(guia.created_by, 'Operador Prueba');
            const logs = await act('auditoria', { id: guia.id }, operator.token);
            assert.equal(logs[0].usuario, 'Operador Prueba');
        });
        await t.test('la edición no permite cambiar folio o declarar entrega', async () => {
            const guia = await create();
            await assert.rejects(act('editar', revise(guia, { guia: { ...header, folio: 900 }, items: load })), /folio no se puede modificar/);
            await assert.rejects(act('editar', revise(guia, { guia: { ...header, estado: 'ENTREGADA' }, items: load })), /acciones de ruta/);
            await assert.rejects(create({ estado: 'ENTREGADA' }), /deben comenzar/);
        });
        await t.test('la recepción exige ruta, receptor y firma', async () => {
            let guia = await create();
            await assert.rejects(act('entregar', revise(guia, { receptor_nombre: 'Receptor', firma_digital: signature })), /debe estar en ruta/);
            guia = await act('ruta', revise(guia));
            await assert.rejects(act('entregar', revise(guia, { receptor_nombre: '', firma_digital: signature })), /nombre/);
            await assert.rejects(act('entregar', revise(guia, { receptor_nombre: 'Receptor', firma_digital: '' })), /firma válida/);
            await assert.rejects(act('entregar', revise(guia, { receptor_nombre: 'Receptor', firma_digital: 'data:image/png;base64,' + 'A'.repeat(180) })), /PNG válida/);
            guia = await act('entregar', revise(guia, { receptor_nombre: 'Receptor', firma_digital: signature }));
            assert.equal(guia.estado, 'ENTREGADA');
            assert.ok(guia.despachado_at);
            assert.ok(guia.receptor_fecha);
            await assert.rejects(act('editar', revise(guia, { guia: header, items: load })), /Solo se puede editar/);
            await assert.rejects(act('eliminar', revise(guia)), /Solo se puede eliminar/);
            const events = await act('auditoria', { id: guia.id });
            assert.deepEqual(events.map(row => row.accion), ['ENTREGA_CONFORME', 'INICIO_RUTA', 'CREACION']);
            assert.equal(events[0].datos_despues.firma_registrada, true);
            assert.equal('firma_digital' in events[0].datos_despues, false);
        });
        await t.test('anular exige permiso y motivo y conserva la carga', async () => {
            const guia = await create();
            await assert.rejects(act('anular', revise(guia, { motivo: 'Motivo de prueba' }), operator.token), /Solo supervisores/);
            await assert.rejects(act('anular', revise(guia, { motivo: '' })), /motivo/);
            const cancelled = await act('anular', revise(guia, { motivo: 'Solicitud cancelada' }));
            assert.equal(cancelled.estado, 'ANULADA');
            assert.equal(cancelled.items.length, 1);
            assert.equal(cancelled.motivo_anulacion, 'Solicitud cancelada');
        });
        await t.test('el control de versión rechaza una edición con datos anteriores', async () => {
            const guia = await create();
            await act('editar', revise(guia, { guia: { ...header, observaciones: 'Primera edición' }, items: load }));
            await assert.rejects(act('editar', revise(guia, { guia: { ...header, observaciones: 'Edición obsoleta' }, items: load })), /Otra persona actualizó/);
        });
        await t.test('eliminar no reutiliza el último folio y conserva auditoría', async () => {
            const guia = await create();
            await assert.rejects(act('eliminar', revise(guia), operator.token), /Solo supervisores/);
            await act('eliminar', revise(guia));
            assert.equal(await scalar('SELECT count(*)::integer AS value FROM public.guia_despacho_items WHERE guia_id=$1', [guia.id]), 0);
            assert.equal((await create()).folio, guia.folio + 1);
            assert.equal(await scalar("SELECT count(*)::integer AS value FROM public.guias_despacho_audit WHERE folio=$1 AND accion='ELIMINACION'", [guia.folio]), 1);
        });
        await t.test('configurar y modificar catálogos exige permiso y no reescribe guías', async () => {
            const old = await create();
            await assert.rejects(act('configurar', { config: { empresa_razon_social: 'Empresa nueva' } }, operator.token), /Solo supervisores/);
            await act('configurar', { config: { empresa_razon_social: 'Empresa nueva' } });
            const next = await create();
            assert.equal(next.razon_social, 'Empresa nueva');
            assert.equal((await scalar('SELECT guia_private.documento($1) AS value', [old.id])).razon_social, old.razon_social);
            const catalog = await act('catalogo_agregar', { tipo: 'destino', nombre: 'Destino temporal' });
            await assert.rejects(act('catalogo_agregar', { tipo: 'destino', nombre: 'destino temporal' }), /ya está registrado/);
            await act('catalogo_eliminar', { id: catalog.id });
        });
        await t.test('una solicitud de impresión no cambia el estado de la guía', async () => {
            const guia = await create();
            const printed = await act('imprimir', { id: guia.id });
            assert.equal(printed.estado, 'PENDIENTE');
            const logs = await act('auditoria', { id: guia.id });
            assert.equal(logs[0].accion, 'SOLICITUD_IMPRESION');
            assert.match(logs[0].detalles, /no confirma/);
        });
        await t.test('auditoría inmutable y tablas sin permisos de escritura directa', async () => {
            await assert.rejects(db.exec("UPDATE public.guias_despacho_audit SET detalles='Modificar historial' WHERE id=(SELECT min(id) FROM public.guias_despacho_audit)"), /no se pueden modificar/);
            await assert.rejects(db.exec('DELETE FROM public.guias_despacho_audit WHERE id=(SELECT min(id) FROM public.guias_despacho_audit)'), /no se pueden modificar/);
            for (const table of ['guias_despacho', 'guia_despacho_items', 'guias_despacho_catalogos', 'guias_despacho_config', 'guias_despacho_audit']) {
                for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3) AS value', ['anon', `public.${table}`, privilege]), false);
            }
        });
        await t.test('sesiones falsas, caducadas y cerradas no autorizan operaciones', async () => {
            await assert.rejects(act('crear', {}, 'token-falso'), /Confirma tu clave/);
            const session = await login('22.222.222-2');
            await db.query('SELECT public.guias_cerrar_sesion($1)', [session.token]);
            await assert.rejects(act('auditoria', { id: 1 }, session.token), /Confirma tu clave/);
            const expired = await login('22.222.222-2');
            await db.exec("UPDATE guia_private.sessions SET expires_at=clock_timestamp()-interval '1 minute' WHERE rut='22.222.222-2'");
            await assert.rejects(act('auditoria', { id: 1 }, expired.token), /Confirma tu clave/);
        });
        await t.test('reaplicar la migración conserva el contador y los datos', async () => {
            const before = await scalar('SELECT jsonb_build_array((SELECT last_folio FROM guia_private.folio_counter),(SELECT count(*) FROM public.guias_despacho)) AS value');
            await db.exec(migration);
            const after = await scalar('SELECT jsonb_build_array((SELECT last_folio FROM guia_private.folio_counter),(SELECT count(*) FROM public.guias_despacho)) AS value');
            assert.deepEqual(after, before);
        });

        await t.test('v3 retira los tokens y conserva los documentos y las reglas transaccionales', async () => {
            const migrationV3 = readFileSync(new URL('../scratch/upgrade_guias_despacho_v3.sql', import.meta.url), 'utf8');
            const snapshot = () => scalar(`SELECT jsonb_build_array(
                (SELECT last_folio FROM guia_private.folio_counter),
                (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.guias_despacho g),
                (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.guia_despacho_items i),
                (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.guias_despacho_audit a),
                (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.guias_despacho_catalogos c),
                (SELECT jsonb_agg(to_jsonb(c) ORDER BY clave) FROM public.guias_despacho_config c)
            ) AS value`);
            const before = await snapshot();
            await db.exec(migrationV3);
            assert.deepEqual(await snapshot(), before);
            assert.equal(await scalar('SELECT public.guias_modulo_version() AS value'), 3);
            assert.equal(await scalar("SELECT to_regclass('guia_private.sessions') AS value"), null);
            for (const name of ['guias_iniciar_sesion(text,text)', 'guias_cerrar_sesion(text)', 'guias_operar(text,text,jsonb)']) {
                assert.equal(await scalar('SELECT to_regprocedure($1) AS value', [`public.${name}`]), null);
            }
            const appAct = (action, payload = {}, rut = '11.111.111-1') => scalar(
                'SELECT public.guias_operar_aplicacion($1,$2,$3::jsonb) AS value', [rut, action, JSON.stringify(payload)]
            );
            await assert.rejects(appAct('auditoria', { id: 1 }, ''), /Inicia sesión/);
            await assert.rejects(appAct('auditoria', { id: 1 }, '99.999.999-9'), /usuario ya no/);

            // El rol y nombre se consultan en usuarios, no en el payload propuesto.
            await db.exec("UPDATE public.usuarios SET nombre='Operador actualizado',rol='Bodeguero' WHERE rut='22.222.222-2'");
            const request = { request_id: randomUUID(), guia: { ...header, created_by: 'Falso', rol: 'Administrador' }, items: load };
            let guia = await appAct('crear', request, '22222222-2');
            assert.equal(guia.created_by, 'Operador actualizado');
            assert.equal((await appAct('crear', request, '22222222-2')).id, guia.id);
            await assert.rejects(appAct('anular', revise(guia, { motivo: 'No autorizado' }), '22.222.222-2'), /Solo supervisores/);
            guia = await appAct('editar', revise(guia, { guia: { ...header, observaciones: 'Desde sesión principal' }, items: load }));
            await assert.rejects(appAct('ruta', { id: guia.id, expected_updated_at: before[1][0].updated_at }), /Otra persona actualizó/);
            guia = await appAct('ruta', revise(guia));
            guia = await appAct('entregar', revise(guia, { receptor_nombre: 'Receptor', firma_digital: signature }));
            assert.equal(guia.estado, 'ENTREGADA');
            await assert.rejects(appAct('editar', revise(guia, { guia: header, items: load })), /Solo se puede editar/);
            assert.equal((await appAct('auditoria', { id: guia.id })).length, 4);
            const rollbackBefore = await snapshot();
            await assert.rejects(appAct('crear', { request_id: randomUUID(), guia: header, items: [{ ...load[0], descripcion: 'FALLAR' }] }), /Fallo de carga/);
            assert.deepEqual(await snapshot(), rollbackBefore);

            // Comprueba la llamada real con el rol usado por la aplicación.
            await db.exec('SET ROLE anon;');
            try {
                assert.ok((await appAct('auditoria', { id: guia.id })).length);
                await assert.rejects(db.exec("INSERT INTO public.guias_despacho_config(clave,valor) VALUES('prueba','x')"), /permission denied/);
            } finally { await db.exec('RESET ROLE;'); }
            const after = await snapshot();
            await db.exec(migrationV3);
            assert.deepEqual(await snapshot(), after);
        });
        await t.test('v4 admite transporte vacío al crear y editar sin modificar guías anteriores', async () => {
            const migrationV4 = readFileSync(new URL('../scratch/upgrade_guias_despacho_v4.sql', import.meta.url), 'utf8');
            const snapshot = () => scalar(`SELECT jsonb_build_array(
                (SELECT last_folio FROM guia_private.folio_counter),
                (SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.guias_despacho g),
                (SELECT count(*) FROM public.guia_despacho_items),
                (SELECT count(*) FROM public.guias_despacho_audit)
            ) AS value`);
            // Simula el SQL copiado del chat, con saltos y espacios diferentes.
            let definition = await scalar("SELECT pg_get_functiondef('public.guias_operar_aplicacion(text,text,jsonb)'::regprocedure) AS value");
            definition = definition.replace("IF length(btrim(COALESCE(v_g->>'lugar_entrega','')))", "IF length(\n btrim(COALESCE(v_g->>'lugar_entrega', ''))\n)");
            await db.exec(definition);
            const before = await snapshot();
            await db.exec(migrationV4);
            assert.deepEqual(await snapshot(), before);
            assert.equal(await scalar('SELECT public.guias_modulo_version() AS value'), 4);
            const appAct = (action, payload = {}) => scalar('SELECT public.guias_operar_aplicacion($1,$2,$3::jsonb) AS value', ['11.111.111-1', action, JSON.stringify(payload)]);
            const payload = { request_id: randomUUID(), guia: { ...header, chofer: '', vehiculo: '', patente: '' }, items: load };
            let guia = await appAct('crear', payload);
            assert.equal(guia.chofer, ''); assert.equal(guia.vehiculo, ''); assert.equal(guia.patente, '');
            assert.equal((await appAct('crear', payload)).id, guia.id);
            guia = await appAct('editar', revise(guia, { guia: { ...header, chofer: 'Conductor asignado', vehiculo: '', patente: 'abcd12' }, items: load }));
            assert.equal(guia.chofer, 'Conductor asignado'); assert.equal(guia.vehiculo, ''); assert.equal(guia.patente, 'ABCD12');
            guia = await appAct('editar', revise(guia, { guia: { ...header, chofer: '', vehiculo: '', patente: '' }, items: load }));
            assert.equal(guia.chofer, '');
            const { chofer, vehiculo, patente, ...withoutTransport } = header;
            const omitted = await appAct('crear', { request_id: randomUUID(), guia: withoutTransport, items: load });
            assert.equal(omitted.chofer, null); assert.equal(omitted.vehiculo, null);
            await assert.rejects(appAct('crear', { ...payload, request_id: randomUUID(), guia: { ...payload.guia, lugar_entrega: '' } }), /destino/);
            await assert.rejects(appAct('crear', { ...payload, request_id: randomUUID(), items: [] }), /entre 1 y 500/);
            await assert.rejects(appAct('crear', { ...payload, request_id: randomUUID(), items: [{ ...load[0], cantidad: 0 }] }), /cantidades/);
            const after = await snapshot();
            await db.exec(migrationV4);
            assert.deepEqual(await snapshot(), after);
        });
        await t.test('v5 permite configurar y ocultar la descripción sin textos predeterminados', async () => {
            const migrationV5 = readFileSync(new URL('../scratch/upgrade_guias_despacho_v5.sql', import.meta.url), 'utf8');
            const before = await scalar('SELECT jsonb_agg(to_jsonb(g) ORDER BY id) AS value FROM public.guias_despacho g');
            await db.exec(migrationV5);
            assert.equal(await scalar('SELECT public.guias_modulo_version() AS value'), 5);
            assert.deepEqual(await scalar('SELECT jsonb_agg(to_jsonb(g) ORDER BY id) AS value FROM public.guias_despacho g'), before);
            assert.equal(await scalar("SELECT count(*)::integer AS value FROM public.guias_despacho_config WHERE clave='empresa_descripcion'"), 0);
            const configure = (config, rut = '11.111.111-1') => scalar('SELECT public.guias_operar_aplicacion($1,$2,$3::jsonb) AS value', [rut, 'configurar', JSON.stringify({ config })]);
            await assert.rejects(configure({ empresa_descripcion: 'Descripción' }, '22.222.222-2'), /Solo supervisores/);
            const text = 'Descripción propia & <texto> "literal"';
            const config = await configure({ empresa_descripcion: text });
            assert.equal(config.empresa_descripcion, text);
            await db.exec(migrationV5);
            assert.equal(await scalar("SELECT valor AS value FROM public.guias_despacho_config WHERE clave='empresa_descripcion'"), text);
            await assert.rejects(configure({ empresa_descripcion: 'x'.repeat(501) }), /demasiado largo/);
            await assert.rejects(configure({ parametro_no_permitido: 'x' }), /Parámetro no permitido/);
            assert.equal((await configure({ empresa_descripcion: '' })).empresa_descripcion, '');
        });
    } finally { await db.close(); }
});
