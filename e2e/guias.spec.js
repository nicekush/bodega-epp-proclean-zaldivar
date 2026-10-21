import { test, expect, openGuias, fillNewGuia } from './guias-fixture.js';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page, backend }) => { await openGuias(page); });

test('busca folio exacto, tildes y patente y relaciona los filtros', async ({ page }) => {
    await page.locator('#guias-search-input').fill('#1');
    await expect(page.locator('#guias-table-body tr')).toHaveCount(1);
    await expect(page.locator('#guias-table-body')).toContainText('#1');
    await page.locator('#guias-search-input').fill('maria');
    await expect(page.locator('#guias-table-body')).toContainText('María Pérez');
    await page.locator('#guias-search-input').fill('ABCD12');
    await expect(page.locator('#guias-table-body')).toContainText('#1');
    await page.locator('#guias-search-input').clear();
    await page.locator('#guias-filter-destino').selectOption('Faena Norte');
    await expect(page.locator('#guias-table-body tr')).toHaveCount(2);
    await expect(page.locator('#guias-filter-chofer option')).toHaveCount(2);
    await page.locator('#guias-filter-vehiculo').selectOption('Toyota Hilux');
    await expect(page.locator('#guias-table-body tr')).toHaveCount(1);
    await page.locator('#guias-filter-desde').fill('2026-10-22');
    await expect(page.locator('#guias-table-body')).toContainText('No hay guías');
});

test('una búsqueda vacía no exporta todas las guías', async ({ page }) => {
    await page.locator('#guias-search-input').fill('SIN-COINCIDENCIAS');
    await expect(page.locator('#guias-table-body')).toContainText('No hay guías');
    const downloads = [];
    page.on('download', download => downloads.push(download));
    await page.getByRole('button', { name: 'Exportar CSV detallado' }).click();
    await expect(page.locator('#toast-container')).toContainText('No hay guías para los filtros');
    expect(downloads).toHaveLength(0);
});

test('la edición conserva comillas y texto HTML y muestra los cambios de carga', async ({ page, backend }) => {
    await page.locator('tr[data-guia-id="1"] button[data-guia-action="edit"]').click();
    const description = 'Manguera 1/2" <img src=x onerror="window.guiaXss=1">';
    await page.locator('.ge-item-desc').fill(description);
    await page.locator('#ge-observaciones').fill('Cambio de carga de prueba');
    await page.locator('#guia-edit-form button[type="submit"]').click();
    await expect(page.locator('#guia-edit-modal')).not.toHaveClass(/active/);
    await expect(page.locator('tr[data-guia-id="1"]')).toContainText(description);
    expect(await page.evaluate(() => window.guiaXss)).toBeUndefined();
    expect(await backend.scalar('SELECT descripcion AS value FROM public.guia_despacho_items WHERE guia_id=1')).toBe(description);
    await page.locator('tr[data-guia-id="1"] button[data-guia-action="view"]').click();
    await expect(page.locator('#gd-timeline-container')).toContainText('MODIFICACION');
    await page.locator('#gd-timeline-container summary').first().click();
    await expect(page.locator('#gd-timeline-container')).toContainText('Carga');
    await expect(page.locator('#gd-timeline-container')).toContainText(description);
});

test('la ruta y recepción requieren firma y cierran la edición del documento', async ({ page, backend }) => {
    await page.locator('tr[data-guia-id="1"] button[data-guia-action="route"]').click();
    await expect(page.locator('tr[data-guia-id="1"]')).toContainText('En ruta');
    await page.locator('tr[data-guia-id="1"] button[data-guia-action="receive"]').click();
    await page.locator('#gdel-nombre').fill('Receptor de prueba');
    await page.locator('#guia-deliver-form button[type="submit"]').click();
    await expect(page.locator('#toast-container')).toContainText('Registra la firma');
    expect(await backend.scalar("SELECT estado AS value FROM public.guias_despacho WHERE id=1")).toBe('EN_TRANSITO');
    const box = await page.locator('#guia-signature-canvas').boundingBox();
    await page.mouse.move(box.x + 30, box.y + 50); await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 80, { steps: 8 });
    await page.mouse.move(box.x + 150, box.y + 30, { steps: 8 }); await page.mouse.up();
    await page.locator('#guia-deliver-form button[type="submit"]').click();
    await expect(page.locator('tr[data-guia-id="1"]')).toContainText('Entregada conforme');
    await expect(page.locator('tr[data-guia-id="1"] button[data-guia-action="edit"]')).toHaveCount(0);
    await expect(page.locator('#gd-timeline-container')).toContainText('ENTREGA CONFORME');
    await expect(page.locator('#gd-receptor-nombre')).toHaveText('Receptor de prueba');
    expect(await backend.scalar('SELECT length(firma_digital)>100 AS value FROM public.guias_despacho WHERE id=1')).toBe(true);
});

test('un guardado rechazado conserva el formulario y no inventa una guía local', async ({ page, backend }) => {
    backend.rejectAction = 'crear';
    await fillNewGuia(page);
    await page.locator('#guia-wizard-form button[type="submit"]').click();
    await expect(page.locator('#toast-container')).toContainText('Guardado rechazado de prueba');
    await expect(page.locator('#guia-wizard-modal')).toHaveClass(/active/);
    expect(await backend.scalar('SELECT count(*)::integer AS value FROM public.guias_despacho')).toBe(3);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('db_guias_despacho_v2')).length)).toBe(3);
    backend.rejectAction = null;
    await page.locator('#guia-wizard-form button[type="submit"]').click();
    await expect(page.locator('#modal-remito-print')).toHaveClass(/active/);
    expect(await backend.scalar('SELECT count(*)::integer AS value FROM public.guias_despacho')).toBe(4);
});

test('un reintento tras perder la respuesta recupera la guía sin duplicarla', async ({ page, backend }) => {
    backend.loseResponse = 'crear';
    await fillNewGuia(page);
    await page.locator('#guia-wizard-form button[type="submit"]').click();
    await expect(page.locator('#toast-container')).toContainText('Respuesta no recibida');
    expect(await backend.scalar('SELECT count(*)::integer AS value FROM public.guias_despacho')).toBe(4);
    await page.locator('#guia-wizard-form button[type="submit"]').click();
    await expect(page.locator('#modal-remito-print')).toHaveClass(/active/);
    expect(await backend.scalar('SELECT count(*)::integer AS value FROM public.guias_despacho')).toBe(4);
    await expect(page.locator('#remito-p-folio')).toHaveText('4');
});

test('configuración y catálogo se guardan y las nuevas guías usan los parámetros', async ({ page, backend }) => {
    await page.locator('#view-guias .guia-module-tabs').getByRole('button', { name: 'Configuración', exact: true }).click();
    await expect(page.locator('#gcfg-status')).toContainText('Configuración compartida');
    await page.locator('#gcfg-razon').fill('Empresa de prueba actualizada');
    await page.locator('#form-gcfg-empresa button[type="submit"]').click();
    await expect(page.locator('#toast-container')).toContainText('Parámetros guardados');
    await page.locator('#tab-gcfg-catalogos').click();
    await page.locator('#gcfg-add-destino-input').fill('Destino "nuevo"');
    await page.locator('#gcfg-add-destino-input').press('Enter');
    await expect(page.locator('#gcfg-list-destinos')).toContainText('Destino "nuevo"');
    await page.getByRole('button', { name: 'Volver a Guías' }).click();
    await fillNewGuia(page);
    await page.locator('#guia-wizard-form button[type="submit"]').click();
    await expect(page.locator('#remito-p-razon')).toHaveText('Empresa de prueba actualizada');
    expect(await backend.scalar('SELECT razon_social AS value FROM public.guias_despacho WHERE folio=1')).toBe('ProCleanMG SPA');
});

test('vista previa no registra impresión y el formato impreso solo muestra el remito', async ({ page, backend }, testInfo) => {
    await page.locator('tr[data-guia-id="1"] button[data-guia-action="print"]').click();
    expect(await backend.scalar("SELECT count(*)::integer AS value FROM public.guias_despacho_audit WHERE accion='SOLICITUD_IMPRESION'")).toBe(0);
    await page.evaluate(() => { window.print = () => { window.guiaPrintRequested = true; }; });
    await page.locator('#modal-remito-print button[onclick="printRemito()"]').click();
    await expect.poll(() => page.evaluate(() => window.guiaPrintRequested)).toBe(true);
    expect(await backend.scalar("SELECT count(*)::integer AS value FROM public.guias_despacho_audit WHERE accion='SOLICITUD_IMPRESION'")).toBe(1);
    await page.emulateMedia({ media: 'print' });
    await page.setViewportSize({ width: 794, height: 1123 });
    await expect(page.locator('#modal-remito-print')).toBeVisible();
    await expect(page.locator('#voucher-modal')).toBeHidden();
    await expect(page.locator('.app-container')).toBeHidden();
    await expect(page.locator('#remito-p-items-body td').first()).toHaveCSS('color', 'rgb(17, 24, 39)');
    await page.screenshot({ path: testInfo.outputPath('remito-impresion.png'), fullPage: true });
});

test('interfaz móvil, filtros y nueva carga permanecen dentro del ancho de pantalla', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('guias-movil.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await fillNewGuia(page);
    const box = await page.locator('#guia-wizard-modal .modal-content').boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    expect(await page.locator('#guia-wizard-form').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('carga-movil.png'), fullPage: true });
});

test('exportar incluye otras páginas y eliminar la última fila ajusta la página', async ({ page, backend }) => {
    for (let i = 0; i < 8; i++) await backend.create();
    await page.getByRole('button', { name: 'Actualizar guías' }).click();
    await expect(page.locator('#guias-count-label')).toContainText('11 de 11');
    await page.locator('#guias-pagination select').selectOption('10');
    await page.getByRole('button', { name: 'Página siguiente' }).click();
    await expect(page.locator('#guias-table-body tr')).toHaveCount(1);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar CSV detallado' }).click()]);
    expect((await readFile(await download.path(), 'utf8')).split('\r\n')).toHaveLength(12);
    await page.locator('tr[data-guia-id="1"] button[data-guia-action="delete"]').click();
    await page.locator('#guia-delete-modal button[onclick="confirmDeleteGuia()"]').click();
    await expect(page.locator('#guias-table-body tr')).toHaveCount(10);
    await expect(page.locator('#guias-pagination')).toContainText('Pág. 1 de 1');
});

test('anular conserva la carga y muestra el motivo', async ({ page, backend }) => {
    await page.locator('tr[data-guia-id="1"] button[data-guia-action="annul"]').click();
    await page.locator('#guia-anular-motivo').fill('Traslado cancelado por el solicitante');
    await page.locator('#guia-anular-form button[type="submit"]').click();
    await expect(page.locator('tr[data-guia-id="1"]')).toContainText('Anulada');
    await page.locator('tr[data-guia-id="1"] button[data-guia-action="view"]').click();
    await expect(page.locator('#gd-anulacion')).toContainText('Traslado cancelado');
    expect(await backend.scalar('SELECT count(*)::integer AS value FROM public.guia_despacho_items WHERE guia_id=1')).toBe(1);
});

test('la sesión principal permite emitir y consultar historial sin token ni segunda clave', async ({ page, backend }) => {
    const requests = [];
    page.on('request', request => { if (request.url().includes('/rpc/')) requests.push(request); });
    await page.evaluate(() => sessionStorage.clear());
    await fillNewGuia(page);
    await expect(page.locator('#guia-wizard-modal')).toHaveClass(/active/);
    await expect(page.locator('#guias-session-modal')).toHaveCount(0);
    await page.locator('#guia-wizard-form button[type="submit"]').click();
    await expect(page.locator('#modal-remito-print')).toHaveClass(/active/);
    expect(await backend.scalar('SELECT created_by AS value FROM public.guias_despacho WHERE folio=4')).toBe('Supervisión de prueba');
    await page.locator('button[onclick="closePrintRemitoModal()"]').click();
    await page.locator('tr[data-guia-id="4"] button[data-guia-action="view"]').click();
    await expect(page.locator('#gd-timeline-container')).toContainText('CREACION');
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
    expect(requests.some(request => /guias_iniciar_sesion|guias_cerrar_sesion/.test(request.url()))).toBe(false);
    expect(requests.filter(request => request.url().endsWith('/guias_operar_aplicacion')).every(request => request.postDataJSON().p_rut === backend.user.rut && !('p_token' in request.postDataJSON()))).toBe(true);
});

test('cerrar la sesión principal impide emitir desde guías', async ({ page }) => {
    await page.evaluate(() => window.handleLogout());
    await page.evaluate(() => window.openNewGuiaModal());
    await expect(page.locator('#guia-wizard-modal')).not.toHaveClass(/active/);
    await expect(page.locator('#toast-container')).toContainText('Inicia sesión en la aplicación');
});

test('sin la migración el módulo conserva la consulta y deshabilita operaciones', async ({ page, backend }) => {
    backend.schemaReady = false;
    await page.reload();
    await page.locator('.nav-item[data-view="view-guias"]').click();
    await expect(page.locator('#guias-connection-status')).toContainText('Modo consulta');
    await expect(page.getByRole('button', { name: /Nueva Guía/ })).toBeDisabled();
    await expect(page.locator('#guias-table-body tr')).toHaveCount(3);
});

test('Configuración de Guías administra catálogos persistentes y conserva el historial al retirarlos', async ({ page, backend }, testInfo) => {
    await page.locator('#view-guias .guia-module-tabs').getByRole('button', { name: 'Configuración', exact: true }).click();
    await expect(page.locator('#view-guias-config')).toHaveClass(/active/);
    await expect(page.locator('.nav-item[data-view="view-guias"]')).toHaveClass(/active/);
    await expect(page.locator('#view-settings')).not.toHaveClass(/active/);
    await expect(page.locator('#view-settings button[onclick="openGuiasConfigModal()"]')).toHaveCount(0);
    await expect(page.locator('#gcfg-status')).toContainText('Configuración compartida');
    await page.locator('#tab-gcfg-catalogos').click();
    for (const [type, name, plural] of [['vehiculo', 'Furgón "Nuevo"', 'vehiculos'], ['chofer', 'Óscar Pérez', 'choferes'], ['destino', 'Bodega Ñuñoa', 'destinos']]) {
        await page.locator(`#gcfg-add-${type}-input`).fill(name);
        await page.locator(`#gcfg-add-${type}-input`).press('Enter');
        await expect(page.locator(`#gcfg-list-${plural}`)).toContainText(name);
    }
    await page.locator('#gcfg-search-chofer').fill('oscar');
    await expect(page.locator('#gcfg-list-choferes .guia-catalog-row')).toHaveCount(1);
    await expect(page.locator('#gcfg-count-chofer')).toHaveText('1 de 2 registros');
    await page.locator('#gcfg-search-destino').fill('no existe');
    await expect(page.locator('#gcfg-list-destinos')).toContainText('No hay coincidencias');
    await page.locator('#gcfg-search-destino').clear();
    await page.getByRole('button', { name: 'Retirar Maxus T60', exact: true }).click();
    await page.locator('#confirm-modal-btn-yes').click();
    await expect(page.locator('#gcfg-list-vehiculos')).not.toContainText('Maxus T60');
    expect(await backend.scalar('SELECT vehiculo AS value FROM public.guias_despacho WHERE id=1')).toBe('Maxus T60');
    await page.getByRole('button', { name: 'Actualizar configuración' }).click();
    await expect(page.locator('#gcfg-list-vehiculos')).toContainText('Furgón "Nuevo"');
    await expect(page.locator('#gcfg-list-vehiculos')).not.toContainText('Maxus T60');
    await page.screenshot({ path: testInfo.outputPath('configuracion-catalogos.png'), fullPage: true });
    await page.getByRole('button', { name: 'Volver a Guías' }).click();
    await page.getByRole('button', { name: /Nueva Guía/ }).click();
    await expect(page.locator('#gw-vehiculo option[value="Maxus T60"]')).toHaveCount(0);
    await page.locator('#gw-vehiculo').selectOption('Furgón "Nuevo"');
    await expect(page.locator('#gw-choferes-list option[value="Óscar Pérez"]')).toHaveCount(1);
    await expect(page.locator('#gw-destinos-list option[value="Bodega Ñuñoa"]')).toHaveCount(1);
});

test('un catálogo vacío permanece vacío y la configuración se adapta a móvil', async ({ page, backend }, testInfo) => {
    await backend.db.exec('DELETE FROM public.guias_despacho_catalogos;');
    await page.locator('#view-guias .guia-module-tabs').getByRole('button', { name: 'Configuración', exact: true }).click();
    await expect(page.locator('#gcfg-status')).toContainText('Configuración compartida');
    await page.locator('#tab-gcfg-catalogos').click();
    await expect(page.locator('#gcfg-list-vehiculos')).toContainText('Aún no hay registros');
    await page.getByRole('button', { name: 'Actualizar configuración' }).click();
    await expect(page.locator('#gcfg-count-vehiculo')).toHaveText('0 de 0 registros');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('configuracion-movil.png'), fullPage: true });
    await page.locator('#gcfg-add-vehiculo-input').fill('Transporte nuevo');
    await page.locator('#gcfg-add-vehiculo-input').press('Enter');
    await expect(page.locator('#gcfg-list-vehiculos')).toContainText('Transporte nuevo');
    await page.getByRole('button', { name: 'Volver a Guías' }).click();
    await page.getByRole('button', { name: /Nueva Guía/ }).click();
    await expect(page.locator('#gw-vehiculo option')).toHaveCount(2);
});
