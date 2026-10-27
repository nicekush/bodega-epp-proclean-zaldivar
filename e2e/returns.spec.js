import { test as base, expect } from '@playwright/test';
import { createReturnsDatabase } from '../tests/helpers/returns-fixture.js';

const test = base.extend({
    backend: async ({ context }, use) => {
        const db = await createReturnsDatabase();
        const backend = { db, schemaReady: true, loseResponse: false };
        const errors = [];
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        await context.addInitScript(() => localStorage.setItem('epp_active_user', JSON.stringify({ rut: '11.111.111-1', nombre: 'Bodega de prueba', rol: 'Supervisor' })));
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,HEAD,OPTIONS' };
        await context.route('https://guias-tests.supabase.co/**', async route => {
            const req = route.request();
            if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
            const url = new URL(req.url());
            const target = url.pathname.split('/').at(-1);
            const respond = (data, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(data) });
            try {
                if (url.pathname.includes('/rpc/')) {
                    if (target !== 'epp_registrar_devolucion') return respond({ code: 'PGRST202', message: 'RPC no instalada en esta prueba' }, 404);
                    const p = req.postDataJSON();
                    const result = (await db.query('SELECT epp_registrar_devolucion($1,$2,$3::jsonb,$4,$5,$6::uuid) AS value', [p.p_rut, p.p_salida_id, JSON.stringify(p.p_items), p.p_motivo, p.p_notas, p.p_request_id])).rows[0].value;
                    if (backend.loseResponse) { backend.loseResponse = false; return respond({ message: 'Respuesta perdida. Reintenta con los mismos datos.' }, 503); }
                    return respond(result);
                }
                if (target === 'epp_devoluciones' && !backend.schemaReady) return respond({ code: 'PGRST205', message: 'Tabla no instalada' }, 404);
                if (req.method() !== 'GET' && req.method() !== 'HEAD') return respond({ message: 'Escritura directa rechazada' }, 403);
                if (['inventario', 'salidas', 'epp_devoluciones'].includes(target)) {
                    const rows = (await db.query(`SELECT * FROM public.${target} ORDER BY id LIMIT $1 OFFSET $2`, [Number(url.searchParams.get('limit') || 500), Number(url.searchParams.get('offset') || 0)])).rows;
                    return respond(rows.map(row => target === 'inventario' ? { ...row, stock: Number(row.stock), stock_minimo: Number(row.stock_minimo) } : row));
                }
                return respond([]);
            } catch (error) { return respond({ message: error.message, code: error.code }, 400); }
        });
        await use(backend);
        expect(errors).toEqual([]);
        await db.close();
    }
});

async function openWorker(page) {
    await page.goto('/');
    await expect(page.locator('#inventory-tbody tr').first()).toBeVisible();
    await page.locator('.nav-item[data-view="view-workers"]').click();
    await page.locator('#worker-search-rut').fill('33.333.333-3');
    await page.locator('#view-workers button[type="submit"]').click();
    await expect(page.locator('#worker-profile-container')).toBeVisible();
}
async function openReturn(page, quantity = '2') {
    await page.getByRole('button', { name: 'Devolución / saldo', exact: true }).first().click();
    await expect(page.locator('#return-form')).toBeVisible();
    await page.locator('.return-quantity[data-line="0"]').fill(quantity);
    await page.locator('#return-reason').selectOption('No utilizado');
    await page.locator('#return-accepted').check();
}

test('devolución parcial actualiza ficha, stock, analítica, historial y conserva el acta', async ({ page, backend }) => {
    await openWorker(page);
    await expect(page.locator('#worker-return-balances')).toContainText('Guantes de prueba');
    await openReturn(page);
    await expect(page.locator('#return-impact')).toContainText('Reingreso: 2');
    await page.screenshot({ path: 'test-results/devolucion-formulario.png' });
    await page.locator('#return-save').click();
    await expect(page.locator('#return-receipt')).toContainText('Comprobante de devolución');
    await page.screenshot({ path: 'test-results/devolucion-comprobante.png' });
    expect((await backend.db.query("SELECT stock FROM inventario WHERE id='g'")).rows[0].stock).toBe('9');
    expect((await backend.db.query("SELECT items FROM salidas WHERE id='a'")).rows[0].items[0].cantidad).toBe(3);
    await page.locator('#return-close').click();
    await expect(page.locator('#worker-history-tbody')).toContainText('Devuelto: 2 · Neto: 1');
    await page.locator('.nav-item[data-view="view-analytics"]').click();
    // Todos los movimientos de prueba son de septiembre; quitar el filtro inicial de fechas.
    await page.locator('#ana-filter-start-date').fill('');
    await page.locator('#ana-filter-end-date').fill('');
    await page.locator('#ana-filter-product').selectOption('g');
    await expect(page.locator('#ana-kpi-total')).toHaveText('1');
    await page.locator('.nav-item[data-view="view-reports"]').click();
    await page.locator('#history-filter-type').selectOption('devolucion');
    await expect(page.locator('#history-tbody')).toContainText('Devolución sin uso');
    await page.getByRole('button', { name: 'Comprobante', exact: true }).click();
    await expect(page.locator('#return-receipt')).toContainText('Ana Prueba');
    await page.locator('#return-close').click();
    await page.reload();
    await page.locator('.nav-item[data-view="view-workers"]').click();
    await page.locator('#worker-search-rut').fill('33.333.333-3');
    await page.locator('#view-workers button[type="submit"]').click();
    await expect(page.locator('#worker-history-tbody')).toContainText('Devuelto: 2 · Neto: 1');
    await page.setViewportSize({ width: 390, height: 844 });
    await openReturn(page, '1');
    const box = await page.locator('#return-modal .modal-content').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: 'test-results/devolucion-movil.png' });
});

test('devolución total elimina el saldo del SKU y permite consultar su comprobante desde el acta', async ({ page, backend }) => {
    await openWorker(page);
    await page.locator('.w-profile-view-voucher').click();
    await page.locator('#voucher-return-button').click();
    await expect(page.locator('#return-form')).toBeVisible();
    await page.locator('.return-quantity[data-line="0"]').fill('3');
    await page.locator('#return-reason').selectOption('No utilizado');
    await page.locator('#return-accepted').check();
    await page.locator('#return-save').click();
    await expect(page.locator('#return-receipt')).toBeVisible();
    expect((await backend.db.query("SELECT stock FROM inventario WHERE id='g'")).rows[0].stock).toBe('10');
    await page.locator('#return-close').click();
    await page.locator('#voucher-modal').getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(page.locator('#worker-history-tbody')).toContainText('Devuelto: 3 · Neto: 0');
    await page.locator('.nav-item[data-view="view-analytics"]').click();
    await page.locator('#ana-filter-start-date').fill('');
    await page.locator('#ana-filter-end-date').fill('');
    await page.locator('#ana-filter-product').selectOption('g');
    await expect(page.locator('#ana-kpi-total')).toHaveText('0');
    await page.locator('#ana-export-type').selectOption('originals');
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 10000 }),
        page.locator('#view-analytics').getByRole('button', { name: /Exportar CSV/ }).click()
    ]);
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString('utf8');
    expect(csv).toContain('Entrega neta al corte');
    expect(csv).toContain('Guantes de prueba');
});

test('una respuesta perdida se puede reintentar sin duplicar la devolución ni el stock', async ({ page, backend }) => {
    await openWorker(page);
    await openReturn(page);
    backend.loseResponse = true;
    await page.locator('#return-save').click();
    await expect(page.locator('#return-message')).toContainText('Respuesta perdida');
    await page.locator('#return-save').click();
    await expect(page.locator('#return-receipt')).toBeVisible();
    expect((await backend.db.query('SELECT count(*)::integer AS count FROM epp_devoluciones')).rows[0].count).toBe(1);
    expect((await backend.db.query("SELECT stock FROM inventario WHERE id='g'")).rows[0].stock).toBe('9');
});

test('sin migración muestra una advertencia y bloquea recepción y saldos netos', async ({ page, backend }) => {
    backend.schemaReady = false;
    await openWorker(page);
    await expect(page.locator('#worker-return-balances')).toContainText('actualización SQL');
    await page.getByRole('button', { name: 'Devolución / saldo', exact: true }).first().click();
    await expect(page.locator('#return-message')).toContainText('actualización SQL');
    await expect(page.locator('#return-form')).toBeHidden();
    await page.locator('#return-close').click();
    await page.locator('.nav-item[data-view="view-analytics"]').click();
    await expect(page.locator('#ana-results')).toBeHidden();
});
