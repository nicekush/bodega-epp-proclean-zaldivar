import { test as base, expect } from '@playwright/test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export { expect };
export const test = base.extend({
    backend: async ({ context }, use) => {
        const db = new PGlite();
        await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
            CREATE TABLE public.usuarios(rut text PRIMARY KEY,nombre text,rol text,password text,cambio_clave_pendiente boolean DEFAULT false);
            INSERT INTO public.usuarios VALUES('11.111.111-1','Supervisión de prueba','Supervisor','clave-test',false),('22.222.222-2','Bodega de prueba','Bodeguero','clave-test',false);
            CREATE FUNCTION public.verificar_credenciales(p_rut text,p_password text)
            RETURNS TABLE(success boolean,rut text,nombre text,rol text,cambio_clave_pendiente boolean)
            LANGUAGE sql SECURITY DEFINER AS $$ SELECT u.password=p_password,u.rut,u.nombre,u.rol,u.cambio_clave_pendiente FROM public.usuarios u WHERE u.rut=p_rut $$;`);
        await db.exec(readFileSync(new URL('../scratch/setup_guias_despacho.sql', import.meta.url), 'utf8'));
        await db.exec(readFileSync(new URL('../scratch/upgrade_guias_despacho_v2.sql', import.meta.url), 'utf8'));
        const scalar = async (sql, params = []) => (await db.query(sql, params)).rows[0]?.value;
        const session = await scalar('SELECT public.guias_iniciar_sesion($1,$2) AS value', ['11.111.111-1', 'clave-test']);
        const backend = {
            db, scalar, session, schemaReady: true, rejectAction: null, loseResponse: null,
            create: async (extra = {}) => scalar('SELECT public.guias_operar($1,$2,$3::jsonb) AS value', [session.token, 'crear', JSON.stringify({
                request_id: randomUUID(), guia: { fecha: '2026-10-21', hora: '09:00', lugar_entrega: 'Faena Norte', chofer: 'Carlos Díaz', vehiculo: 'Maxus T60', patente: 'ABCD12', ...extra },
                items: [{ articulo: '1', descripcion: 'Repuestos de prueba', cantidad: 2, unidad: 'UN' }]
            })])
        };
        await backend.create();
        await backend.create({ lugar_entrega: 'Taller Sur', chofer: 'María Pérez', patente: 'EFGH34' });
        await backend.create({ lugar_entrega: 'Faena Norte', chofer: 'Carlos Díaz', vehiculo: 'Toyota Hilux', patente: 'IJKL56' });
        await context.addInitScript(session => {
            localStorage.setItem('epp_active_user', JSON.stringify(session.user));
            sessionStorage.setItem('epp_guias_session_v1', JSON.stringify(session));
        }, session);
        const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,HEAD,OPTIONS' };
        await context.route('https://guias-tests.supabase.co/**', async route => {
            const request = route.request();
            if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
            const url = new URL(request.url());
            const target = url.pathname.split('/').filter(Boolean).at(-1);
            const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
            try {
                if (url.pathname.includes('/rpc/')) {
                    const payload = request.postDataJSON() || {};
                    if (target === 'verificar_credenciales') return respond((await db.query('SELECT * FROM public.verificar_credenciales($1,$2)', [payload.p_rut, payload.p_password])).rows);
                    if (target === 'guias_modulo_version') {
                        if (!backend.schemaReady) return respond({ code: 'PGRST202', message: 'Función aún no instalada' }, 404);
                        return respond(2);
                    }
                    if (target === 'guias_iniciar_sesion') return respond(await scalar('SELECT public.guias_iniciar_sesion($1,$2) AS value', [payload.p_rut, payload.p_password]));
                    if (target === 'guias_cerrar_sesion') { await scalar('SELECT public.guias_cerrar_sesion($1) AS value', [payload.p_token]); return respond(null); }
                    if (target === 'guias_operar') {
                        if (backend.rejectAction === payload.p_action) return respond({ code: 'P0001', message: 'Guardado rechazado de prueba' }, 400);
                        const result = await scalar('SELECT public.guias_operar($1,$2,$3::jsonb) AS value', [payload.p_token, payload.p_action, JSON.stringify(payload.p_payload)]);
                        if (backend.loseResponse === payload.p_action) { backend.loseResponse = null; return respond({ code: '503', message: 'Respuesta no recibida. Reintenta con los mismos datos.' }, 503); }
                        return respond(result);
                    }
                    return respond({ code: 'PGRST202', message: `RPC de prueba no implementada: ${target}` }, 404);
                }
                if (request.method() !== 'GET' && request.method() !== 'HEAD') return respond({ code: '42501', message: 'Escritura directa no permitida' }, 403);
                const offset = Number(url.searchParams.get('offset') || 0);
                const limit = Math.min(500, Number(url.searchParams.get('limit') || 500));
                if (target === 'guias_despacho') return respond((await db.query('SELECT guia_private.documento(id) AS document FROM public.guias_despacho ORDER BY id LIMIT $1 OFFSET $2', [limit, offset])).rows.map(row => row.document));
                if (target === 'guias_despacho_catalogos') return respond((await db.query('SELECT * FROM public.guias_despacho_catalogos ORDER BY id LIMIT $1 OFFSET $2', [limit, offset])).rows);
                if (target === 'guias_despacho_config') return respond((await db.query('SELECT * FROM public.guias_despacho_config ORDER BY clave')).rows);
                return respond([]);
            } catch (error) {
                return respond({ code: error.code || 'P0001', message: error.message }, error.code === '28000' ? 401 : error.code === '42501' ? 403 : 400);
            }
        });
        await use(backend);
        await db.close();
    }
});

export async function openGuias(page) {
    await page.goto('/');
    await page.locator('.nav-item[data-view="view-guias"]').click();
    await expect(page.locator('#guias-connection-status')).toContainText('Conectado');
    await expect(page.locator('#guias-table-body tr')).toHaveCount(3);
}

export async function fillNewGuia(page, description = 'Carga nueva') {
    await page.getByRole('button', { name: /Nueva Guía/ }).click();
    await page.locator('#gw-destino').fill('Destino nuevo');
    await page.locator('#gw-chofer').fill('Chofer nuevo');
    await page.locator('#gw-vehiculo').selectOption('Maxus T60');
    await page.locator('.gw-item-desc').fill(description);
    await page.locator('.gw-item-cant').fill('2.5');
}
