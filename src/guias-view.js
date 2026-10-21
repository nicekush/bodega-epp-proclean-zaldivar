import {
    dbGuias, dbGuiasCatalogos, dbGuiasConfig, dbGuiasStatus, dbFetchGuias, dbFetchGuiasSettings,
    dbInsertGuia, dbUpdateGuia, dbDeleteGuia, dbChangeGuiaEstado, dbConfirmarEntrega, dbLogGuiaImpresion,
    dbFetchGuiasAuditLogs, dbSaveGuiasConfig, dbAddGuiaCatalogo, dbDeleteGuiaCatalogo
} from './db.js';
import { showToast, showConfirmDialog } from './utils.js';
import { currentUser } from './auth.js';
import {
    GUIA_STATES, GUIA_UNITS, escapeGuiaHTML as html, normalizeGuiaText, localGuiaDate,
    selectGuias, validateGuia, guiaTiming, isGuiaManager, canEditGuia, canAnnulGuia, buildGuiasCSV
} from './guias-model.js';

const $ = id => document.getElementById(id);
const text = (id, value) => { if ($(id)) $(id).textContent = value ?? ''; };
const value = id => $(id)?.value?.trim() || '';
const modal = (id, open) => $(id)?.classList.toggle('active', open);
const toast = (message, type = 'success') => showToast(html(message), type);
const findGuia = id => dbGuias.find(guia => String(guia.id) === String(id));
const user = () => currentUser;
const stamp = raw => raw && Number.isFinite(new Date(raw).getTime()) ? new Date(raw).toLocaleString('es-CL') : raw || 'Sin fecha';
let currentFilter = 'ALL', currentPage = 1, pageSize = 15, searchTimer;
let activeDrawer = null, editTarget = null, receiveTarget = null, deleteTarget = null, annulTarget = null, printTarget = null;
let requestId = null, timelineRequest = 0, itemSequence = 0;
let signatureCanvas = null, signatureContext = null, drawing = false, signaturePoints = 0;
const pending = new Set();
const registered = new WeakSet();

function filters() {
    return { state: currentFilter, query: value('guias-search-input'), start: value('guias-filter-desde'),
        end: value('guias-filter-hasta'), destination: value('guias-filter-destino'),
        driver: value('guias-filter-chofer'), vehicle: value('guias-filter-vehiculo') };
}
function canOperate() {
    if (!currentUser?.rut) { toast('Inicia sesión en la aplicación antes de operar con guías.', 'warning'); return false; }
    if (!dbGuiasStatus.schemaReady) { toast('Las operaciones estarán disponibles al completar la actualización del módulo.', 'warning'); return false; }
    if (!dbGuiasStatus.online) { toast('Actualiza las guías al recuperar la conexión antes de guardar.', 'warning'); return false; }
    return true;
}
function updateStatus() {
    const status = $('guias-connection-status');
    if (status) {
        status.textContent = !dbGuiasStatus.online ? dbGuiasStatus.error : !dbGuiasStatus.schemaReady
            ? 'Modo consulta. Las operaciones se habilitarán al completar la actualización del módulo.'
            : 'Conectado. Las operaciones quedan registradas en el historial.';
    }
    document.querySelectorAll('[data-guia-write]').forEach(button => { button.disabled = !currentUser?.rut || !dbGuiasStatus.online || !dbGuiasStatus.schemaReady; });
    document.querySelectorAll('[data-guia-manager]').forEach(button => { button.hidden = !isGuiaManager(user()); });
    updateConfigStatus();
}
async function mutate(key, rootId, action) {
    if (pending.has(key)) return;
    pending.add(key);
    const buttons = [...($(rootId)?.querySelectorAll('button') || [])];
    buttons.forEach(button => { button.disabled = true; });
    try { await action(); }
    catch (error) { toast(error.message || 'No se pudo completar la operación.', 'danger'); }
    finally { pending.delete(key); buttons.forEach(button => { button.disabled = false; }); updateStatus(); }
}
function refresh() { renderGuiasTable(); if (activeDrawer) openGuiaDrawer(activeDrawer); }

export async function initGuiasView() {
    await Promise.all([dbFetchGuias(), dbFetchGuiasSettings()]);
    populateGuiasCatalogosDropdowns();
    renderGuiasTable();
    initSignaturePad();
    const table = $('guias-table-body');
    if (table && !registered.has(table)) {
        table.addEventListener('click', event => {
            const row = event.target.closest('[data-guia-id]');
            if (!row) return;
            const guia = findGuia(row.dataset.guiaId);
            if (!guia) return;
            const action = event.target.closest('[data-guia-action]')?.dataset.guiaAction || 'view';
            ({ view: () => openGuiaDrawer(guia.id), print: () => openPrintRemitoModal(guia.id), edit: () => openEditGuiaModal(guia.id),
                receive: () => openDeliverModal(guia.id), route: () => cambiarEstadoDirecto(guia.id, 'EN_TRANSITO'),
                delete: () => openDeleteGuiaModal(guia.id), annul: () => openAnularGuiaModal(guia.id) })[action]?.();
        });
        registered.add(table);
    }
}
export async function reloadGuias() {
    await Promise.all([dbFetchGuias(), dbFetchGuiasSettings()]);
    populateGuiasCatalogosDropdowns();
    refresh();
}
export function updateGuiasDashboardStats() {
    const list = selectGuias(dbGuias, filters());
    text('stat-guias-total', list.length);
    for (const [id, state] of [['pendientes', 'PENDIENTE'], ['transito', 'EN_TRANSITO'], ['entregadas', 'ENTREGADA'], ['anuladas', 'ANULADA']]) {
        text(`stat-guias-${id}`, list.filter(guia => guia.estado === state).length);
    }
    const timings = list.map(guia => guiaTiming(guia));
    const pendingHours = timings.map(row => row.pendingHours).filter(row => row !== null);
    const delivered = timings.map(row => row.deliveryHours).filter(row => row !== null);
    text('guias-followup', `Selección: ${list.length} guías. Pendiente más antiguo: ${pendingHours.length ? `${Math.floor(Math.max(...pendingHours) / 24)} días` : 'sin pendientes'}. Tiempo medio de despacho a recepción: ${delivered.length ? `${(delivered.reduce((a, b) => a + b, 0) / delivered.length).toFixed(1)} h` : 'sin datos'}.`);
    updateStatus();
}

function updateFacets(selected) {
    for (const [id, field, key, label] of [
        ['guias-filter-destino', 'lugar_entrega', 'destination', 'Todos los destinos'],
        ['guias-filter-chofer', 'chofer', 'driver', 'Todos los choferes'],
        ['guias-filter-vehiculo', 'vehiculo', 'vehicle', 'Todos los vehículos']
    ]) {
        const select = $(id);
        if (!select) continue;
        const counts = new Map();
        selectGuias(dbGuias, { ...selected, [key]: '' }).forEach(guia => {
            if (guia[field]) counts.set(guia[field], (counts.get(guia[field]) || 0) + 1);
        });
        if (selected[key] && !counts.has(selected[key])) counts.set(selected[key], 0);
        select.replaceChildren(new Option(label, ''));
        [...counts].sort(([a], [b]) => a.localeCompare(b, 'es')).forEach(([name, count]) => select.add(new Option(`${name} (${count})`, name)));
        select.value = selected[key] || '';
    }
}
function rowAction(action, label, icon) {
    return `<button type="button" class="btn btn-secondary btn-sm" data-guia-action="${action}" title="${label}" aria-label="${label}"><i class="fa-solid ${icon}" aria-hidden="true"></i></button>`;
}
export function renderGuiasTable() {
    const selected = filters();
    updateFacets(selected);
    const list = selectGuias(dbGuias, selected);
    currentPage = Math.min(Math.max(1, currentPage), Math.max(1, Math.ceil(list.length / pageSize)));
    text('guias-count-label', `${list.length} de ${dbGuias.length} guías`);
    const tbody = $('guias-table-body');
    if (tbody) {
        tbody.innerHTML = list.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(guia => {
            const badge = { PENDIENTE: 'badge-warning', EN_TRANSITO: 'badge-info', ENTREGADA: 'badge-success', ANULADA: 'badge-danger' }[guia.estado] || '';
            const items = (guia.items || []).map(item => `${item.cantidad} ${item.unidad} ${item.descripcion}`).join(' • ');
            let actions = rowAction('view', 'Ver detalle e historial', 'fa-eye') + rowAction('print', 'Vista previa', 'fa-print');
            if (canEditGuia(guia)) actions += rowAction('edit', 'Editar', 'fa-pen-to-square') + rowAction('route', 'Iniciar ruta', 'fa-truck-fast');
            if (guia.estado === 'EN_TRANSITO') actions += rowAction('receive', 'Registrar recepción', 'fa-signature');
            if (canAnnulGuia(guia, user())) actions += rowAction('annul', 'Anular con motivo', 'fa-ban');
            if (canEditGuia(guia) && isGuiaManager(user())) actions += rowAction('delete', 'Eliminar guía por despachar', 'fa-trash-can');
            return `<tr data-guia-id="${html(guia.id)}" class="clickable-row">
                <td><strong>#${html(guia.folio)}</strong></td><td>${html(guia.fecha)}</td>
                <td><strong>${html(guia.lugar_entrega)}</strong><div class="guia-muted">${html(guia.emisor_nombre)}</div></td>
                <td>${html(guia.chofer)}<div class="guia-muted">${html(guia.vehiculo)} · ${html(guia.patente || 'Sin patente')}</div></td>
                <td><div class="guia-load-summary" title="${html(items)}">${html(items || 'Sin carga registrada')}</div><div class="guia-muted">${guia.items?.length || 0} artículos</div></td>
                <td><span class="badge ${badge}">${html(GUIA_STATES[guia.estado] || guia.estado)}</span></td>
                <td><div class="guia-row-actions">${actions}</div></td></tr>`;
        }).join('') || '<tr><td colspan="7" class="guia-empty">No hay guías para los filtros seleccionados.</td></tr>';
    }
    renderGuiasPagination(list.length);
    updateGuiasDashboardStats();
}
function renderGuiasPagination(total) {
    const container = $('guias-pagination');
    if (!container) return;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    container.innerHTML = `<div class="pagination-info">${total ? (currentPage - 1) * pageSize + 1 : 0}–${Math.min(currentPage * pageSize, total)} de ${total} guías</div>
        <div class="pagination-controls"><button type="button" class="btn btn-secondary btn-sm" onclick="changeGuiasPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>
        <span>Pág. ${currentPage} de ${pages}</span><button type="button" class="btn btn-secondary btn-sm" onclick="changeGuiasPage(${currentPage + 1})" ${currentPage === pages ? 'disabled' : ''} aria-label="Página siguiente">›</button></div>
        <label>Mostrar <select class="filter-select" onchange="changeGuiasPageSize(this.value)">${[10, 15, 25, 50].map(size => `<option ${size === pageSize ? 'selected' : ''}>${size}</option>`).join('')}</select></label>`;
}
export function changeGuiasPage(page) { currentPage = Math.max(1, Number(page) || 1); renderGuiasTable(); }
export function changeGuiasPageSize(size) { pageSize = [10, 15, 25, 50].includes(Number(size)) ? Number(size) : 15; currentPage = 1; renderGuiasTable(); }
export function filterGuiasByState(state) {
    currentFilter = state;
    document.querySelectorAll('.guia-filter-btn').forEach(button => {
        const active = button.id === `guia-filter-${state.toLowerCase()}`;
        button.classList.toggle('active', active); button.classList.toggle('btn-primary', active); button.classList.toggle('btn-secondary', !active);
    });
    currentPage = 1; renderGuiasTable();
}
export function handleGuiasSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(() => { currentPage = 1; renderGuiasTable(); }, 180); }
export function handleGuiasDateFilter() {
    const selected = filters();
    if (selected.start && selected.end && selected.start > selected.end) toast('La fecha Desde debe ser anterior o igual a Hasta.', 'warning');
    currentPage = 1; renderGuiasTable();
}
export function handleGuiasDestinoFilter() { currentPage = 1; renderGuiasTable(); }
export function clearGuiasFilters() {
    clearTimeout(searchTimer);
    ['guias-search-input', 'guias-filter-desde', 'guias-filter-hasta', 'guias-filter-destino', 'guias-filter-chofer', 'guias-filter-vehiculo'].forEach(id => { if ($(id)) $(id).value = ''; });
    filterGuiasByState('ALL');
}

function addItemRow(containerId, prefix, art = '', desc = '', quantity = 1, unit = 'UN', observation = '') {
    const container = $(containerId);
    if (!container) return;
    const row = document.createElement('div');
    row.id = `${prefix}-item-row-${++itemSequence}`;
    row.className = `${prefix}-item-row guia-item-editor`;
    row.dataset.article = art;
    row.innerHTML = `<input class="form-control ${prefix}-item-desc" placeholder="Descripción de la carga" maxlength="2000" required aria-label="Descripción del artículo">
        <input class="form-control ${prefix}-item-cant" type="number" min="0.000001" max="1000000000" step="any" required aria-label="Cantidad">
        <select class="form-control ${prefix}-item-unid" aria-label="Unidad"></select>
        <button type="button" class="btn btn-secondary btn-sm" aria-label="Quitar artículo">×</button>
        <input class="form-control ${prefix}-item-obs guia-item-note" placeholder="Observación del artículo (opcional)" maxlength="2000" aria-label="Observación del artículo">`;
    row.querySelector(`.${prefix}-item-desc`).value = desc;
    row.querySelector(`.${prefix}-item-cant`).value = quantity;
    const select = row.querySelector('select');
    GUIA_UNITS.forEach(name => select.add(new Option(name, name)));
    select.value = GUIA_UNITS.includes(unit) ? unit : 'UN';
    row.querySelector(`.${prefix}-item-obs`).value = observation;
    row.querySelector('button').addEventListener('click', () => removeItemRow(row.id, containerId));
    container.appendChild(row);
}
function removeItemRow(id, containerId) {
    if ($(containerId)?.children.length > 1) $(id)?.remove(); else toast('La carga debe conservar al menos un artículo.', 'warning');
}
function readItems(prefix) {
    return [...document.querySelectorAll(`.${prefix}-item-row`)].map((row, index) => ({
        articulo: row.dataset.article || String(index + 1), descripcion: row.querySelector(`.${prefix}-item-desc`).value.trim(),
        cantidad: Number(row.querySelector(`.${prefix}-item-cant`).value), unidad: row.querySelector(`.${prefix}-item-unid`).value,
        observacion: row.querySelector(`.${prefix}-item-obs`).value.trim()
    }));
}
export function addWizardItemRow(art, desc, quantity, unit) { addItemRow('gw-items-container', 'gw', art, desc, quantity, unit); }
export function removeWizardItemRow(id) { removeItemRow(id, 'gw-items-container'); }
export function addEditItemRow(art, desc, quantity, unit, observation) { addItemRow('ge-items-container', 'ge', art, desc, quantity, unit, observation); }
export function selectDestinoQuick(name) { if ($('gw-destino')) $('gw-destino').value = name; }

function populateGuiasCatalogosDropdowns() {
    const vehicle = $('gw-vehiculo');
    if (vehicle) {
        const selected = vehicle.value;
        vehicle.replaceChildren(new Option('Selecciona vehículo', ''));
        sortedCatalog('vehiculos').forEach(item => vehicle.add(new Option(item.nombre, item.nombre)));
        if ([...vehicle.options].some(option => option.value === selected)) vehicle.value = selected;
    }
    const drivers = $('gw-choferes-list');
    if (drivers) {
        drivers.replaceChildren();
        sortedCatalog('choferes').forEach(item => drivers.appendChild(new Option(item.nombre, item.nombre)));
    }
    const destinations = $('gw-destinos-list');
    if (destinations) {
        destinations.replaceChildren();
        sortedCatalog('destinos').forEach(item => destinations.appendChild(new Option(item.nombre, item.nombre)));
    }
    const chips = $('gw-destinos-chips');
    if (chips) {
        chips.replaceChildren();
        dbGuiasCatalogos.destinos.slice(0, 8).forEach(item => {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'btn btn-secondary btn-sm'; button.textContent = item.nombre;
            button.addEventListener('click', () => selectDestinoQuick(item.nombre)); chips.appendChild(button);
        });
    }
    const editVehicles = $('ge-vehiculos-list');
    if (editVehicles) {
        editVehicles.replaceChildren();
        sortedCatalog('vehiculos').forEach(item => editVehicles.appendChild(new Option(item.nombre, item.nombre)));
    }
}
export function openNewGuiaModal() {
    if (!canOperate()) return;
    $('guia-wizard-form').reset();
    requestId = crypto.randomUUID();
    $('gw-folio').value = 'Al emitir';
    $('gw-fecha').value = localGuiaDate();
    if ($('gw-hora')) $('gw-hora').value = new Date().toTimeString().slice(0, 5);
    $('gw-emisor').value = dbGuiasConfig.emisor_nombre || user()?.nombre || '';
    $('gw-items-container').replaceChildren();
    addWizardItemRow(); populateGuiasCatalogosDropdowns(); modal('guia-wizard-modal', true);
}
export function closeNewGuiaModal() { if (!pending.has('create')) { modal('guia-wizard-modal', false); requestId = null; } }
export async function saveNewGuia(event) {
    event.preventDefault();
    if (!canOperate()) return;
    const guia = { fecha: value('gw-fecha'), hora: value('gw-hora'), lugar_entrega: value('gw-destino'),
        chofer: value('gw-chofer'), vehiculo: value('gw-vehiculo'), patente: value('gw-patente'),
        observaciones: value('gw-observaciones'), emisor_nombre: value('gw-emisor'), request_id: requestId };
    const items = readItems('gw');
    await mutate('create', 'guia-wizard-form', async () => {
        validateGuia(guia, items);
        const saved = await dbInsertGuia(guia, items);
        modal('guia-wizard-modal', false); requestId = null;
        refresh(); toast(`Guía #${saved.folio} guardada con su carga.`); openPrintRemitoModal(saved.id);
    });
}
export function openEditGuiaModal(id) {
    if (!canOperate()) return;
    const guia = findGuia(id);
    if (!canEditGuia(guia)) { toast('Solo se puede editar una guía por despachar.', 'warning'); return; }
    editTarget = { id: guia.id, revision: guia.updated_at };
    for (const [suffix, field] of Object.entries({ id: 'id', folio: 'folio', fecha: 'fecha', hora: 'hora', estado: 'estado', destino: 'lugar_entrega', chofer: 'chofer', vehiculo: 'vehiculo', patente: 'patente', observaciones: 'observaciones' })) {
        if ($(`ge-${suffix}`)) $(`ge-${suffix}`).value = guia[field] || '';
    }
    $('ge-items-container').replaceChildren();
    guia.items.forEach(item => addEditItemRow(item.articulo, item.descripcion, item.cantidad, item.unidad, item.observacion));
    modal('guia-edit-modal', true);
}
export function closeEditGuiaModal() { if (!pending.has('edit')) { modal('guia-edit-modal', false); editTarget = null; } }
export async function saveEditGuia(event) {
    event.preventDefault();
    if (!editTarget || !canOperate()) return;
    const target = { ...editTarget };
    await mutate('edit', 'guia-edit-form', async () => {
        const guia = { fecha: value('ge-fecha'), hora: value('ge-hora'), lugar_entrega: value('ge-destino'),
            chofer: value('ge-chofer'), vehiculo: value('ge-vehiculo'), patente: value('ge-patente'), observaciones: value('ge-observaciones'), expected_updated_at: target.revision };
        const items = readItems('ge');
        validateGuia(guia, items);
        await dbUpdateGuia(target.id, guia, items);
        modal('guia-edit-modal', false); editTarget = null; refresh(); toast('Guía y carga actualizadas.');
    });
}

function drawerAction(label, action, primary = false) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-sm`; button.textContent = label;
    button.addEventListener('click', action); $('gd-actions-container').appendChild(button);
}
export function openGuiaDrawer(id) {
    const guia = findGuia(id);
    if (!guia) return;
    activeDrawer = guia.id;
    text('gd-folio-badge', `#${guia.folio}`); text('gd-fecha-label', `${guia.fecha} · ${guia.hora}`);
    text('gd-estado-badge', GUIA_STATES[guia.estado]);
    for (const [suffix, field] of Object.entries({ destino: 'lugar_entrega', chofer: 'chofer', emisor: 'emisor_nombre', obs: 'observaciones' })) text(`gd-${suffix}`, guia[field] || 'Sin registro');
    text('gd-vehiculo', `${guia.vehiculo} · ${guia.patente || 'Sin patente'}`);
    text('gd-items-count', `${guia.items?.length || 0} artículos`);
    text('gd-anulacion', guia.estado === 'ANULADA' ? `Anulación: ${guia.motivo_anulacion || 'Sin motivo registrado'}` : '');
    const received = guia.estado === 'ENTREGADA';
    if ($('gd-recepcion-card')) $('gd-recepcion-card').hidden = !received;
    if ($('gd-recepcion-card')) $('gd-recepcion-card').style.display = received ? 'block' : 'none';
    text('gd-receptor-nombre', guia.receptor_nombre); text('gd-receptor-rut', guia.receptor_rut || 'Sin RUT registrado'); text('gd-receptor-fecha', stamp(guia.receptor_fecha));
    const validSignature = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(guia.firma_digital || '') && guia.firma_digital.length <= 1000000;
    if ($('gd-firma-container')) $('gd-firma-container').style.display = validSignature ? 'block' : 'none';
    if ($('gd-firma-img')) { if (validSignature) $('gd-firma-img').src = guia.firma_digital; else $('gd-firma-img').removeAttribute('src'); }
    $('gd-items-list').innerHTML = (guia.items || []).map(item => `<div class="guia-detail-item"><div><strong>${html(item.descripcion)}</strong><div class="guia-muted">${html(item.observacion || '')}</div></div><span>${html(item.cantidad)} ${html(item.unidad)}</span></div>`).join('');
    $('gd-actions-container').replaceChildren();
    drawerAction('Vista previa', () => openPrintRemitoModal(id));
    if (canEditGuia(guia)) { drawerAction('Editar', () => openEditGuiaModal(id)); drawerAction('Iniciar ruta', () => cambiarEstadoDirecto(id, 'EN_TRANSITO'), true); }
    if (guia.estado === 'EN_TRANSITO') drawerAction('Registrar recepción', () => openDeliverModal(id), true);
    if (canAnnulGuia(guia, user())) drawerAction('Anular con motivo', () => openAnularGuiaModal(id));
    modal('guia-drawer', true); modal('guia-drawer-overlay', true);
    renderGuiaTimeline(guia.id);
}
export function closeGuiaDrawer() { activeDrawer = null; timelineRequest++; modal('guia-drawer', false); modal('guia-drawer-overlay', false); }
async function renderGuiaTimeline(id) {
    const container = $('gd-timeline-container');
    if (!container) return;
    const request = ++timelineRequest;
    if (!currentUser?.rut) {
        container.textContent = 'Inicia sesión en la aplicación para consultar el historial de operaciones.';
        return;
    }
    container.textContent = 'Cargando historial…';
    try {
        const events = await dbFetchGuiasAuditLogs(id);
        if (request !== timelineRequest || String(activeDrawer) !== String(id)) return;
        container.innerHTML = events.map(event => {
            const before = event.datos_antes || {}, after = event.datos_despues || {};
            const fields = { estado: 'Estado', fecha: 'Fecha', hora: 'Hora', lugar_entrega: 'Destino', chofer: 'Chofer', vehiculo: 'Vehículo', patente: 'Patente', observaciones: 'Observaciones', receptor_nombre: 'Receptor', firma_registrada: 'Firma registrada' };
            const changes = event.datos_antes && event.datos_despues ? Object.entries(fields).filter(([key]) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
                .map(([key, label]) => `<tr><th>${label}</th><td>${html(before[key] ?? 'Sin registro')}</td><td>${html(after[key] ?? 'Sin registro')}</td></tr>`) : [];
            if (event.datos_antes && event.datos_despues && JSON.stringify(before.items) !== JSON.stringify(after.items)) {
                const describe = items => (items || []).map(item => `${item.cantidad} ${item.unidad} ${item.descripcion}${item.observacion ? ` (${item.observacion})` : ''}`).join(' · ');
                changes.push(`<tr><th>Carga</th><td>${html(describe(before.items))}</td><td>${html(describe(after.items))}</td></tr>`);
            }
            return `<div class="timeline-item"><span class="timeline-dot"></span><strong>${html(event.accion.replaceAll('_', ' '))}</strong><span class="guia-muted">${html(stamp(event.created_at))} · ${html(event.usuario)}</span><p>${html(event.detalles)}</p>${changes.length ? `<details><summary>Ver cambios</summary><div class="table-container"><table><thead><tr><th>Dato</th><th>Antes</th><th>Después</th></tr></thead><tbody>${changes.join('')}</tbody></table></div></details>` : ''}</div>`;
        }).join('') || 'No hay eventos registrados para esta guía.';
    } catch (error) { if (request === timelineRequest) container.textContent = error.message; }
}
export async function cambiarEstadoDirecto(id, state) {
    if (state !== 'EN_TRANSITO') { toast('Utiliza recepción o anulación para cerrar una guía.', 'warning'); return; }
    if (!canOperate()) return;
    await mutate(`route-${id}`, 'gd-actions-container', async () => { await dbChangeGuiaEstado(id, state); refresh(); toast('Inicio de ruta registrado.'); });
}
export function openAnularGuiaModal(id) {
    if (!canOperate()) return;
    const guia = findGuia(id);
    if (!canAnnulGuia(guia, user())) { toast('No puedes anular esta guía.', 'warning'); return; }
    annulTarget = { id: guia.id, revision: guia.updated_at }; text('guia-anular-folio', `#${guia.folio}`); $('guia-anular-motivo').value = ''; modal('guia-anular-modal', true);
}
export function closeAnularGuiaModal() { if (!pending.has('annul')) { annulTarget = null; modal('guia-anular-modal', false); } }
export async function confirmAnularGuia(event) {
    event.preventDefault();
    if (!annulTarget) return;
    await mutate('annul', 'guia-anular-form', async () => {
        const reason = value('guia-anular-motivo');
        if (reason.length < 5) throw new Error('Explica el motivo de anulación (mínimo 5 caracteres).');
        await dbChangeGuiaEstado(annulTarget.id, 'ANULADA', null, reason, annulTarget.revision);
        annulTarget = null; modal('guia-anular-modal', false); refresh(); toast('Guía anulada con motivo registrado.');
    });
}

export function openDeliverModal(id) {
    if (!canOperate()) return;
    const guia = findGuia(id);
    if (guia?.estado !== 'EN_TRANSITO') { toast('La guía debe estar en ruta antes de registrar la recepción.', 'warning'); return; }
    receiveTarget = { id: guia.id, revision: guia.updated_at }; text('gdel-folio-badge', `#${guia.folio}`);
    $('guia-deliver-form').reset(); clearGuiaSignature(); modal('guia-deliver-modal', true);
}
export function closeDeliverModal() { if (!pending.has('receive')) { receiveTarget = null; modal('guia-deliver-modal', false); } }
export function initSignaturePad() {
    const canvas = $('guia-signature-canvas');
    if (!canvas || registered.has(canvas)) return;
    signatureCanvas = canvas; signatureContext = canvas.getContext('2d');
    signatureContext.lineWidth = 2.5; signatureContext.lineCap = 'round'; signatureContext.strokeStyle = '#111827';
    const position = event => { const bounds = canvas.getBoundingClientRect(); return [(event.clientX - bounds.left) * canvas.width / bounds.width, (event.clientY - bounds.top) * canvas.height / bounds.height]; };
    canvas.addEventListener('pointerdown', event => { if (event.button !== 0) return; drawing = true; canvas.setPointerCapture(event.pointerId); signatureContext.beginPath(); signatureContext.moveTo(...position(event)); event.preventDefault(); });
    canvas.addEventListener('pointermove', event => { if (!drawing) return; signatureContext.lineTo(...position(event)); signatureContext.stroke(); signaturePoints++; event.preventDefault(); });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { drawing = false; });
    registered.add(canvas);
}
export function clearGuiaSignature() { signaturePoints = 0; drawing = false; signatureContext?.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height); }
export async function saveDeliverModal(event) {
    event.preventDefault();
    if (!receiveTarget) return;
    const { id, revision } = receiveTarget;
    await mutate('receive', 'guia-deliver-form', async () => {
        if (!value('gdel-nombre')) throw new Error('Indica el nombre de quien recibe.');
        if (!signatureCanvas || signaturePoints < 2) throw new Error('Registra la firma de quien recibe antes de confirmar.');
        await dbConfirmarEntrega(id, { receptor_nombre: value('gdel-nombre'), receptor_rut: value('gdel-rut'), firma_digital: signatureCanvas.toDataURL('image/png'), expected_updated_at: revision });
        receiveTarget = null; modal('guia-deliver-modal', false); refresh(); openGuiaDrawer(id); toast('Recepción y firma registradas.');
    });
}
export function openDeleteGuiaModal(id) {
    if (!canOperate()) return;
    const guia = findGuia(id);
    if (!canEditGuia(guia) || !isGuiaManager(user())) { toast('Solo supervisores y administradores pueden eliminar guías por despachar.', 'warning'); return; }
    deleteTarget = { id: guia.id, revision: guia.updated_at }; text('gdel-confirm-folio', `#${guia.folio}`); modal('guia-delete-modal', true);
}
export function closeDeleteGuiaModal() { if (!pending.has('delete')) { deleteTarget = null; modal('guia-delete-modal', false); } }
export async function confirmDeleteGuia() {
    if (!deleteTarget) return;
    const target = { ...deleteTarget };
    const guia = findGuia(target.id);
    await mutate('delete', 'guia-delete-modal', async () => {
        await dbDeleteGuia(guia.id, target.revision); deleteTarget = null; modal('guia-delete-modal', false); closeGuiaDrawer(); refresh(); toast(`Guía #${guia.folio} eliminada. Su folio queda reservado en el historial.`);
    });
}

export function openPrintRemitoModal(id) {
    const guia = findGuia(id);
    if (!guia) return;
    printTarget = guia.id;
    for (const [suffix, field] of Object.entries({ folio: 'folio', fecha: 'fecha', razon: 'razon_social', 'rut-empresa': 'rut_empresa', 'direccion-empresa': 'direccion_empresa', tel: 'telefono_empresa', correo: 'correo_empresa', emisor: 'emisor_nombre', 'rut-emisor': 'emisor_rut', domicilio: 'emisor_domicilio', destino: 'lugar_entrega', chofer: 'chofer', vehiculo: 'vehiculo', patente: 'patente', obs: 'observaciones' })) text(`remito-p-${suffix}`, guia[field] || '');
    text('remito-p-ciudad', [guia.emisor_ciudad, guia.emisor_comuna].filter(Boolean).join(' / '));
    text('remito-p-estado', `${GUIA_STATES[guia.estado]}${guia.estado === 'ANULADA' ? ` — ${guia.motivo_anulacion}` : ''}`);
    $('remito-p-items-body').innerHTML = (guia.items || []).map(item => `<tr><td>${html(item.articulo)}</td><td>${html(item.descripcion)}${item.observacion ? `<div>${html(item.observacion)}</div>` : ''}</td><td>${html(item.cantidad)} ${html(item.unidad)}</td></tr>`).join('');
    const box = $('remito-p-firma-box'); box.replaceChildren();
    if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(guia.firma_digital || '') && guia.firma_digital.length <= 1000000) {
        const image = document.createElement('img'); image.src = guia.firma_digital; image.alt = 'Firma de recepción'; image.style.maxHeight = '55px'; box.appendChild(image);
        const name = document.createElement('span'); name.textContent = `${guia.receptor_nombre} (${guia.receptor_rut || 'Sin RUT registrado'})`; box.appendChild(name);
    } else { box.textContent = guia.estado === 'ENTREGADA' ? 'Recepción sin firma digital registrada' : ''; }
    modal('modal-remito-print', true);
}
export function closePrintRemitoModal() { printTarget = null; modal('modal-remito-print', false); }
export async function printRemito() {
    const id = printTarget;
    if (!id || !canOperate()) return;
    await mutate(`print-${id}`, 'modal-remito-print', async () => {
        await dbLogGuiaImpresion(id);
        if (String(printTarget) === String(id)) window.print();
        if (activeDrawer) renderGuiaTimeline(activeDrawer);
    });
}
export function exportGuiasCSV() {
    const selected = filters();
    if (selected.start && selected.end && selected.start > selected.end) { toast('Corrige el rango de fechas antes de exportar.', 'warning'); return; }
    if (!selectGuias(dbGuias, selected).length) { toast('No hay guías para los filtros seleccionados.', 'warning'); return; }
    const csv = buildGuiasCSV(dbGuias, selected);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `Guias_Despacho_${localGuiaDate()}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('CSV generado con una fila por artículo y todos los resultados filtrados.');
}

const configFields = {
    'gcfg-razon': 'empresa_razon_social', 'gcfg-rut': 'empresa_rut', 'gcfg-telefono': 'empresa_telefono',
    'gcfg-correo': 'empresa_correo', 'gcfg-direccion': 'empresa_direccion', 'gcfg-ciudad': 'emisor_ciudad',
    'gcfg-comuna': 'emisor_comuna', 'gcfg-emisor-default': 'emisor_nombre', 'gcfg-emisor-rut': 'emisor_rut',
    'gcfg-emisor-domicilio': 'emisor_domicilio', 'gcfg-emisor-telefono': 'emisor_telefono'
};
export function openGuiasConfigModal() {
    if (!currentUser?.rut) { toast('Inicia sesión en la aplicación.', 'warning'); return; }
    if (!isGuiaManager(user())) { toast('Solo supervisores y administradores pueden configurar las guías.', 'warning'); return; }
    window.switchView('view-guias-config');
}
export async function initGuiasConfigView() {
    if (!isGuiaManager(user())) { window.switchView('view-guias'); toast('Solo supervisores y administradores pueden configurar las guías.', 'warning'); return; }
    switchGuiasConfigTab('empresa');
    await reloadGuiasConfiguration();
}
export async function reloadGuiasConfiguration() {
    if (!isGuiaManager(user())) return;
    dbGuiasStatus.settingsOnline = false;
    text('gcfg-status', 'Cargando configuración…');
    document.querySelectorAll('[data-guia-config-write]').forEach(button => { button.disabled = true; });
    await dbFetchGuiasSettings();
    Object.entries(configFields).forEach(([id, key]) => { if ($(id)) $(id).value = dbGuiasConfig[key] || ''; });
    renderConfigCatalogs(); populateGuiasCatalogosDropdowns(); updateStatus();
}
function updateConfigStatus() {
    text('gcfg-status', !dbGuiasStatus.settingsOnline
        ? 'No se pudo actualizar la configuración. Se muestra la última copia disponible.'
        : !dbGuiasStatus.schemaReady ? 'Configuración en modo consulta hasta completar la actualización del módulo.'
            : 'Configuración compartida. Los cambios se aplican a las próximas guías.');
    document.querySelectorAll('[data-guia-config-write]').forEach(button => { button.disabled = !isGuiaManager(user()) || !dbGuiasStatus.settingsOnline || !dbGuiasStatus.schemaReady; });
}
function canConfigure() {
    if (!isGuiaManager(user())) { toast('Solo supervisores y administradores pueden configurar las guías.', 'warning'); return false; }
    if (!dbGuiasStatus.schemaReady || !dbGuiasStatus.settingsOnline) { toast('Actualiza la configuración antes de guardar cambios.', 'warning'); return false; }
    return true;
}
export function closeGuiasConfigModal() { window.switchView('view-guias'); }
export function switchGuiasConfigTab(tab) {
    for (const name of ['empresa', 'catalogos']) {
        if ($(`gcfg-sec-${name}`)) $(`gcfg-sec-${name}`).style.display = name === tab ? 'block' : 'none';
        $(`tab-gcfg-${name}`)?.classList.toggle('btn-primary', name === tab);
        $(`tab-gcfg-${name}`)?.classList.toggle('btn-secondary', name !== tab);
    }
}
export async function saveGuiasConfigEmpresa(event) {
    event.preventDefault();
    if (!canConfigure()) return;
    await mutate('config', 'form-gcfg-empresa', async () => {
        const config = Object.fromEntries(Object.entries(configFields).filter(([id]) => $(id)).map(([id, key]) => [key, value(id)]));
        if (!config.empresa_razon_social || !config.empresa_rut) throw new Error('Completa razón social y RUT de la empresa.');
        await dbSaveGuiasConfig(config); toast('Parámetros guardados para las próximas guías.');
    });
}
function sortedCatalog(key) {
    return [...dbGuiasCatalogos[key]].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base', numeric: true }));
}
export function filterGuiasCatalogos() { renderConfigCatalogs(); updateConfigStatus(); }
function renderConfigCatalogs() {
    for (const [type, key, containerId] of [['vehiculo', 'vehiculos', 'gcfg-list-vehiculos'], ['chofer', 'choferes', 'gcfg-list-choferes'], ['destino', 'destinos', 'gcfg-list-destinos']]) {
        const container = $(containerId); if (!container) continue; container.replaceChildren();
        const query = normalizeGuiaText(value(`gcfg-search-${type}`));
        const list = sortedCatalog(key).filter(item => normalizeGuiaText(item.nombre).includes(query));
        text(`gcfg-count-${type}`, `${list.length} de ${dbGuiasCatalogos[key].length} registros`);
        if (!list.length) {
            const empty = document.createElement('p'); empty.className = 'guia-empty';
            empty.textContent = query ? 'No hay coincidencias con esta búsqueda.' : 'Aún no hay registros. Agrega el primero para utilizarlo en las guías.';
            container.appendChild(empty);
        }
        list.forEach(item => {
            const chip = document.createElement('div'); chip.className = 'guia-catalog-row';
            const label = document.createElement('span'); label.textContent = item.nombre; chip.appendChild(label);
            const button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-danger-outline btn-sm'; button.textContent = 'Retirar'; button.dataset.guiaConfigWrite = ''; button.setAttribute('aria-label', `Retirar ${item.nombre}`);
            button.addEventListener('click', async () => {
                if (!canConfigure()) return;
                if (!await showConfirmDialog('Retirar del catálogo', `¿Retirar «${item.nombre}»? Las guías existentes conservarán ese dato.`)) return;
                await mutate(`catalog-${item.id}`, 'gcfg-sec-catalogos', async () => { await dbDeleteGuiaCatalogo(item.id); renderConfigCatalogs(); populateGuiasCatalogosDropdowns(); toast('Elemento retirado del catálogo.'); });
            });
            chip.appendChild(button); container.appendChild(chip);
        });
    }
}
export async function addGuiasCatalogoItem(type) {
    if (!canConfigure()) return;
    const input = $(`gcfg-add-${type}-input`);
    const name = input?.value.trim();
    if (!name) { toast('Escribe el nombre que deseas agregar.', 'warning'); return; }
    await mutate(`catalog-add-${type}`, 'gcfg-sec-catalogos', async () => {
        await dbAddGuiaCatalogo(type, name); input.value = ''; if ($(`gcfg-search-${type}`)) $(`gcfg-search-${type}`).value = ''; renderConfigCatalogs(); populateGuiasCatalogosDropdowns(); toast('Elemento agregado al catálogo.');
    });
}
