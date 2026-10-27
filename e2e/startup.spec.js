import { test as base, expect } from '@playwright/test';

const rows = {
    categorias: [{ nombre: 'Manos' }], areas: [{ nombre: 'Operaciones' }], turnos: [{ nombre: 'Turno A' }],
    inventario: [{ id: 'g', codigo: 'G-01', nombre: 'Guantes de inicio', stock: 7, stock_minimo: 1, categoria: 'Manos', unidad: 'Par', tipo_control: 'Consumo', duracion_meses: 6 }],
    salidas: [{ id: 'a', trabajador: 'Ana', rut: '11.111.111-1', area: 'Operaciones', turno: 'Turno A', fecha: '2026-09-01T12:00:00Z', items: [{ eppId: 'g', cantidad: 3 }], firma: 'Firma Física en Acta Impresa' }],
    guias_despacho: [{ id: 1, folio: 1, estado: 'PENDIENTE', fecha: '2026-10-27', hora: '09:00', lugar_entrega: 'Destino de inicio', chofer: '', vehiculo: '', patente: '', items: [{ descripcion: 'Carga de inicio', cantidad: 1, unidad: 'UN' }] }]
};
const test = base.extend({
    backend: async ({ context }, use) => {
        const backend = { calls: [], writes: [], active: 0, hold: null, fail: null, release: null };
        let unblock;
        const gate = new Promise(resolve => { unblock = resolve; });
        backend.release = unblock;
        const errors = [];
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        await context.addInitScript(() => localStorage.setItem('epp_active_user', JSON.stringify({ rut: '11.111.111-1', nombre: 'Supervisión', rol: 'Supervisor' })));
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,HEAD,OPTIONS' };
        await context.route('https://guias-tests.supabase.co/**', async route => {
            const request = route.request();
            if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
            const url = new URL(request.url());
            const table = url.pathname.split('/').at(-1);
            const rpc = url.pathname.includes('/rpc/');
            backend.calls.push(table);
            backend.active++;
            try {
                if (table === backend.hold) await gate;
                if (table === backend.fail) return route.fulfill({ status: 400, headers, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'Consulta crítica rechazada en prueba' }) });
                if (request.method() !== 'GET' && request.method() !== 'HEAD' && !(rpc && table === 'guias_modulo_version')) {
                    backend.writes.push(table);
                    return route.fulfill({ status: 403, headers, body: '{}' });
                }
                const offset = Number(url.searchParams.get('offset') || 0);
                const limit = Number(url.searchParams.get('limit') || 500);
                const select = url.searchParams.get('select') || '*';
                const selected = (rows[table] || []).slice(offset, offset + limit).map(row => select.split(',').includes('*') ? row : Object.fromEntries(select.split(',').filter(key => key in row).map(key => [key, row[key]])));
                return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify(rpc ? 5 : selected) });
            } finally { backend.active--; }
        });
        try { await use(backend); expect(errors).toEqual([]); }
        finally { unblock(); }
    }
});

test('espera el historial lento y solo entonces muestra listo con una sola carga de guías', async ({ page, backend }) => {
    backend.hold = 'salidas';
    await page.goto('/');
    await expect.poll(() => backend.calls.includes('salidas')).toBe(true);
    await expect(page.locator('#toast-container')).not.toContainText('Base de datos cargada correctamente.');
    await expect(page.locator('#inventory-tbody')).toContainText('No hay stock registrado en el catálogo.');
    await expect(page.locator('#inventory-tbody')).not.toContainText('Guantes de inicio');
    backend.release();
    await expect(page.locator('#inventory-tbody')).toContainText('Guantes de inicio');
    await expect(page.locator('#toast-container')).toContainText('Base de datos cargada correctamente.');
    for (const table of ['guias_despacho', 'guias_despacho_catalogos', 'guias_despacho_config', 'guias_modulo_version']) {
        expect(backend.calls.filter(call => call === table)).toHaveLength(1);
    }
    expect(backend.calls).toHaveLength(17);
    expect(backend.writes).toEqual([]);
    await page.locator('.nav-item[data-view="view-guias"]').click();
    await expect(page.locator('#guias-connection-status')).toContainText('Conectado');
    await expect(page.locator('#guias-table-body')).toContainText('Carga de inicio');
});

test('una consulta obligatoria fallida no muestra listo ni renderiza inventario parcial', async ({ page, backend }) => {
    backend.fail = 'inventario';
    await page.goto('/');
    await expect(page.locator('#toast-container')).toContainText('Error de conexión a la base de datos.');
    await expect(page.locator('#toast-container')).not.toContainText('Base de datos cargada correctamente.');
    await expect(page.locator('#inventory-tbody')).toContainText('No hay stock registrado en el catálogo.');
    await expect(page.locator('#inventory-tbody')).not.toContainText('Guantes de inicio');
    await expect.poll(() => backend.active).toBe(0);
    expect(backend.writes).toEqual([]);
});
