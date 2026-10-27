import { test as base, expect } from '@playwright/test';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3x8AAAAASUVORK5CYII=';
const acta = { rut: '11.111.111-1', area: 'Operaciones', turno: 'Turno A', fecha: '2026-10-01T12:00:00Z', items: [{ eppId: 'g', cantidad: 1 }], registrado_por: 'Bodega' };
const rows = {
    inventario: [{ id: 'g', codigo: 'G-01', nombre: 'Guantes', stock: 7, stock_minimo: 1, categoria: 'Manos', unidad: 'Par', tipo_control: 'Consumo', duracion_meses: 6 }],
    salidas: [{ ...acta, id: 'a', trabajador: 'Ana Digital', firma: png }, { ...acta, id: 'b', trabajador: 'Ana Física', firma: 'Firma Física en Acta Impresa' }, { ...acta, id: 'c', trabajador: 'Ana Sin Firma', firma: null }]
};
const test = base.extend({
    backend: async ({ context }, use) => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const backend = { signatures: [], summaries: [], hold: null, fail: false, invalidSignature: false, release, writes: [] };
        const errors = [];
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        await context.addInitScript(() => {
            localStorage.setItem('epp_active_user', JSON.stringify({ rut: '11.111.111-1', nombre: 'Supervisión', rol: 'Supervisor' }));
            window.__printedActas = [];
            window.print = () => window.__printedActas.push({ acta: document.getElementById('v-meta-id').textContent, signature: document.getElementById('v-signature-img').getAttribute('src') });
        });
        const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,HEAD,OPTIONS' };
        await context.route('https://guias-tests.supabase.co/**', async route => {
            const req = route.request();
            if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
            const url = new URL(req.url()), table = url.pathname.split('/').at(-1);
            const respond = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
            if (table === 'guias_modulo_version') return respond(5);
            if (!['GET', 'HEAD'].includes(req.method())) { backend.writes.push(table); return respond({}, 403); }
            const select = url.searchParams.get('select') || '*';
            const id = url.searchParams.get('id')?.replace(/^eq\./, '');
            if (table === 'salidas' && id) {
                backend.signatures.push(id);
                if (backend.hold === id) await gate;
                if (backend.fail) return respond({ code: '42501', message: 'Firma temporalmente no disponible' }, 400);
                if (backend.invalidSignature) return respond({ id, firma: 'data:image/png;base64,aW52YWxpZA==' });
            } else if (table === 'salidas') backend.summaries.push(select);
            const list = (rows[table] || []).filter(row => !id || String(row.id) === id)
                .slice(Number(url.searchParams.get('offset') || 0), Number(url.searchParams.get('offset') || 0) + Number(url.searchParams.get('limit') || 500))
                .map(row => select.split(',').includes('*') ? row : Object.fromEntries(select.split(',').filter(key => key in row).map(key => [key, row[key]])));
            return respond(req.headers().accept?.includes('application/vnd.pgrst.object+json') ? list[0] || null : list);
        });
        try { await use(backend); expect(errors).toEqual([]); expect(backend.writes).toEqual([]); }
        finally { release(); }
    }
});

async function openWorker(page) {
    await page.goto('/');
    await expect(page.locator('#inventory-tbody')).toContainText('Guantes');
    await page.locator('.nav-item[data-view="view-workers"]').click();
    await page.locator('#worker-search-rut').fill('11.111.111-1');
    await page.locator('#view-workers button[type="submit"]').click();
    await expect(page.locator('#worker-history-tbody tr')).toHaveCount(3);
}
const open = (page, id) => page.locator(`.w-profile-view-voucher[data-id="${id}"]`).click();
const close = page => page.locator('#voucher-modal').getByRole('button', { name: 'Cerrar', exact: true }).click();

test('inicio sin firmas; consulta digital y física con caché e impresión confirmada', async ({ page, backend }) => {
    await openWorker(page);
    expect(backend.signatures).toEqual([]);
    expect(backend.summaries.every(fields => !fields.split(',').includes('firma'))).toBe(true);
    await expect(page.locator('#worker-history-tbody')).toContainText('Consultar en acta');
    await open(page, 'a');
    await expect(page.locator('#voucher-print-button')).toBeEnabled();
    await expect(page.locator('#v-signature-img')).toBeVisible();
    await expect(page.locator('#v-signature-img')).toHaveAttribute('src', png);
    await page.locator('#voucher-print-button').click();
    expect(await page.evaluate(() => window.__printedActas)).toEqual([{ acta: 'ID: ACTA-a', signature: png }]);
    await close(page);
    await open(page, 'a');
    await expect(page.locator('#voucher-print-button')).toBeEnabled();
    expect(backend.signatures).toEqual(['a']);
    await close(page);
    await open(page, 'b');
    await expect(page.locator('#voucher-print-button')).toBeEnabled();
    await expect(page.locator('#v-signature-physical')).toBeVisible();
    await expect(page.locator('#v-signature-img')).toBeHidden();
    expect(backend.signatures).toEqual(['a', 'b']);
});

test('espera una firma lenta; la impresión no puede adelantar la descarga ni la decodificación', async ({ page, backend }) => {
    backend.hold = 'a';
    await openWorker(page);
    await open(page, 'a');
    await expect(page.locator('#v-signature-status')).toContainText('Cargando firma');
    await expect(page.locator('#voucher-print-button')).toBeDisabled();
    await expect(page.locator('#v-signature-physical')).toBeHidden();
    await page.evaluate(() => { void window.printVoucher(); });
    expect(await page.evaluate(() => window.__printedActas)).toHaveLength(0);
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#voucher-print-area')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    backend.release();
    await expect(page.locator('#voucher-print-button')).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.__printedActas.length)).toBe(1);
});

test('error de red conserva el bloqueo y permite reintentar sin convertirla en firma física', async ({ page, backend }) => {
    backend.fail = true;
    await openWorker(page);
    await open(page, 'a');
    await expect(page.locator('#v-signature-status')).toContainText('No fue posible cargar la firma');
    await expect(page.locator('#voucher-print-button')).toBeDisabled();
    await expect(page.locator('#v-signature-physical')).toBeHidden();
    await page.evaluate(() => window.printVoucher());
    expect(await page.evaluate(() => window.__printedActas)).toHaveLength(0);
    backend.fail = false;
    await page.locator('#voucher-signature-retry').click();
    await expect(page.locator('#voucher-print-button')).toBeEnabled();
    await expect(page.locator('#v-signature-img')).toHaveAttribute('src', png);
    expect(backend.signatures).toEqual(['a', 'a']);
});

test('una respuesta anterior no cambia la firma ni imprime otra acta después de cerrar', async ({ page, backend }) => {
    backend.hold = 'a';
    await openWorker(page);
    await open(page, 'a');
    await expect(page.locator('#voucher-print-button')).toBeDisabled();
    await page.evaluate(() => { void window.printVoucher(); });
    await close(page);
    await open(page, 'b');
    await expect(page.locator('#voucher-print-button')).toBeEnabled();
    await page.locator('#voucher-print-button').click();
    backend.release();
    await expect(page.locator('#v-worker-name')).toHaveText('Ana Física');
    await expect(page.locator('#v-signature-physical')).toBeVisible();
    await expect(page.locator('#v-signature-img')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__printedActas.length)).toBe(1);
    expect(await page.evaluate(() => window.__printedActas[0].acta)).toBe('ID: ACTA-b');
});

test('imagen inválida bloquea impresión; reintentar vuelve a consultar y permite recuperar una firma válida', async ({ page, backend }) => {
    backend.invalidSignature = true;
    await openWorker(page);
    await open(page, 'a');
    await expect(page.locator('#v-signature-status')).toContainText('No fue posible cargar la firma');
    await expect(page.locator('#voucher-print-button')).toBeDisabled();
    backend.invalidSignature = false;
    await page.locator('#voucher-signature-retry').click();
    await expect(page.locator('#voucher-print-button')).toBeEnabled();
    await expect(page.locator('#v-signature-img')).toHaveAttribute('src', png);
    expect(backend.signatures).toEqual(['a', 'a']);
});

test('ausencia confirmada se distingue de pendiente; exportar no descarga firmas', async ({ page, backend }) => {
    await openWorker(page);
    await page.locator('.nav-item[data-view="view-analytics"]').click();
    await page.locator('#ana-filter-start-date').fill('');
    await page.locator('#ana-filter-end-date').fill('');
    await page.locator('#ana-export-type').selectOption('deliveries');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#view-analytics').getByRole('button', { name: /Exportar CSV/ }).click()]);
    const stream = await download.createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    expect(Buffer.concat(chunks).toString('utf8')).toContain('Pendiente de consultar en acta');
    expect(backend.signatures).toEqual([]);
    await page.locator('.nav-item[data-view="view-workers"]').click();
    await page.locator('#worker-search-rut').fill('11.111.111-1');
    await page.locator('#view-workers button[type="submit"]').click();
    await open(page, 'c');
    await expect(page.locator('#voucher-print-button')).toBeEnabled();
    await expect(page.locator('#v-signature-stamp-text')).toHaveText('Sin firma registrada');
    await expect(page.locator('#v-signature-physical')).toBeHidden();
});
