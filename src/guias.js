// ==========================================================================
// Módulo de Guías de Despacho (src/guias.js) - ProCleanMG
// Control Integral de Remitos de Carga, Transporte y Recepción Conforme
// ==========================================================================

import {
    dbGuias,
    dbGuiasCatalogos,
    dbFetchGuias,
    dbInsertGuia,
    dbUpdateGuia,
    dbDeleteGuia,
    dbChangeGuiaEstado,
    dbConfirmarEntrega,
    dbLogGuiaImpresion,
    dbAddGuiaCatalogo,
    dbDeleteGuiaCatalogo
} from './db.js';

import { showToast } from './utils.js';
import { currentUser } from './auth.js';

// Estado local del módulo
let currentFilter = 'ALL';
let currentSearch = '';
let guiasCurrentPage = 1;
let guiasPageSize = 15;
let filteredGuias = [];

let activeGuiaId = null;
let activeDeleteId = null;
let activeDeleteFolio = null;
let activeDeliverId = null;
let activeAnularId = null;
let activeAnularFolio = null;

let sigCanvas = null;
let sigCtx = null;
let isSigning = false;
let wizardItemCount = 0;
let editItemCount = 0;

// Inicialización de la vista
export async function initGuiasView() {
    await dbFetchGuias();
    populateGuiasCatalogosDropdowns();
    updateGuiasDashboardStats();
    renderGuiasTable();
    initSignaturePad();
}

// --------------------------------------------------------------------------
// 1. Estadísticas y KPIs del Dashboard
// --------------------------------------------------------------------------
export function updateGuiasDashboardStats() {
    const total = dbGuias.length;
    const pendientes = dbGuias.filter(g => g.estado === 'PENDIENTE').length;
    const enTransito = dbGuias.filter(g => g.estado === 'EN_TRANSITO').length;
    const entregadas = dbGuias.filter(g => g.estado === 'ENTREGADA').length;
    const anuladas = dbGuias.filter(g => g.estado === 'ANULADA').length;

    const maxFolio = dbGuias.length > 0 ? Math.max(...dbGuias.map(g => Number(g.folio) || 0)) : 0;
    const proximoFolio = maxFolio + 1;

    const elTotal = document.getElementById('stat-guias-total');
    const elPend = document.getElementById('stat-guias-pendientes');
    const elTrans = document.getElementById('stat-guias-transito');
    const elEntr = document.getElementById('stat-guias-entregadas');
    const elProx = document.getElementById('stat-guias-proximo');

    if (elTotal) elTotal.textContent = total;
    if (elPend) elPend.textContent = pendientes;
    if (elTrans) elTrans.textContent = enTransito;
    if (elEntr) elEntr.textContent = entregadas;
    if (elProx) elProx.textContent = `#${proximoFolio}`;
}

// --------------------------------------------------------------------------
// 2. Tabla, Filtros y Paginación
// --------------------------------------------------------------------------
export function renderGuiasTable() {
    const tbody = document.getElementById('guias-table-body');
    const countLabel = document.getElementById('guias-count-label');
    if (!tbody) return;

    // Filtrar por estado y buscador
    filteredGuias = dbGuias.filter(g => {
        const matchesEstado = currentFilter === 'ALL' || g.estado === currentFilter;
        if (!matchesEstado) return false;

        if (!currentSearch) return true;
        const q = currentSearch.toLowerCase();
        const folioStr = String(g.folio || '');
        const destinoStr = (g.lugar_entrega || '').toLowerCase();
        const choferStr = (g.chofer || '').toLowerCase();
        const vehiculoStr = (g.vehiculo || '').toLowerCase();
        const receptorStr = (g.receptor_nombre || '').toLowerCase();
        const itemsStr = (g.items || []).map(i => i.descripcion || '').join(' ').toLowerCase();

        return folioStr.includes(q) || destinoStr.includes(q) || choferStr.includes(q) ||
               vehiculoStr.includes(q) || receptorStr.includes(q) || itemsStr.includes(q);
    });

    if (countLabel) {
        countLabel.textContent = `Mostrando ${filteredGuias.length} de ${dbGuias.length} guías registradas`;
    }

    if (filteredGuias.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="text-center py-5 text-muted" style="padding: 40px; font-size: 0.9rem;">
                    <i class="fa-solid fa-folder-open" style="font-size: 2rem; margin-bottom: 12px; display: block; opacity: 0.5;"></i>
                    No se encontraron guías de despacho con los criterios seleccionados.
                </td>
            </tr>
        `;
        renderGuiasPagination();
        return;
    }

    const startIndex = (guiasCurrentPage - 1) * guiasPageSize;
    const paginated = filteredGuias.slice(startIndex, startIndex + guiasPageSize);

    tbody.innerHTML = paginated.map(g => {
        let badgeClass = 'badge-warning';
        let badgeLabel = 'Por Despachar';
        let stateDot = 'background: #ffb703;';

        if (g.estado === 'EN_TRANSITO') {
            badgeClass = 'badge-info';
            badgeLabel = 'En Ruta';
            stateDot = 'background: #06b6d4;';
        } else if (g.estado === 'ENTREGADA') {
            badgeClass = 'badge-success';
            badgeLabel = 'Entregada Conforme';
            stateDot = 'background: #2ec4b6;';
        } else if (g.estado === 'ANULADA') {
            badgeClass = 'badge-danger';
            badgeLabel = 'Anulada';
            stateDot = 'background: #e63946;';
        }

        const itemsResumen = (g.items || []).map(i => `${i.cantidad} ${i.unidad || 'UN'} ${i.descripcion}`).join(' • ') || '1x Carga general';
        const itemsCount = (g.items || []).length;

        return `
            <tr class="clickable-row" onclick="openGuiaDrawer(${g.id})" style="cursor: pointer;">
                <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="width: 8px; height: 8px; border-radius: 50%; ${stateDot}"></span>
                        <strong style="font-family: var(--font-secondary); font-size: 0.95rem; color: var(--color-primary);">#${g.folio}</strong>
                    </div>
                </td>
                <td style="font-size: 0.85rem; font-family: monospace;">${g.fecha || '-'}</td>
                <td>
                    <div style="font-weight: 600; color: var(--text-primary); font-size: 0.88rem;">${g.lugar_entrega || 'Sin destino'}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${g.emisor_nombre || 'ProCleanMG'}</div>
                </td>
                <td>
                    <div style="font-weight: 500; font-size: 0.85rem; color: var(--text-primary);">${g.chofer || 'Chofer de Turno'}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${g.vehiculo || 'Camioneta'} ${g.patente ? '• ' + g.patente : ''}</div>
                </td>
                <td style="max-width: 260px;">
                    <div style="font-size: 0.82rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${itemsResumen}">${itemsResumen}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">${itemsCount} producto(s)</div>
                </td>
                <td>
                    <span class="badge ${badgeClass}" style="font-size: 0.75rem; padding: 4px 10px; border-radius: 20px;">
                        ${badgeLabel}
                    </span>
                </td>
                <td style="text-align: right;" onclick="event.stopPropagation();">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
                        <!-- Ver / Timeline -->
                        <button type="button" class="btn btn-secondary btn-sm" onclick="openGuiaDrawer(${g.id})" title="Ver Detalles y Auditoría">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                        <!-- Imprimir Remito -->
                        <button type="button" class="btn btn-secondary btn-sm" onclick="openPrintRemitoModal(${g.id})" title="Imprimir Remito Oficial ProClean">
                            <i class="fa-solid fa-print" style="color: var(--color-primary);"></i>
                        </button>
                        <!-- Editar -->
                        <button type="button" class="btn btn-secondary btn-sm" onclick="openEditGuiaModal(${g.id})" title="Editar Guía">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                        <!-- Entregar / Firma -->
                        ${g.estado !== 'ENTREGADA' && g.estado !== 'ANULADA' ? `
                            <button type="button" class="btn btn-success btn-sm" onclick="openDeliverModal(${g.id}, ${g.folio})" title="Registrar Entrega Conforme">
                                <i class="fa-solid fa-signature"></i>
                            </button>
                        ` : ''}
                        <!-- Eliminar -->
                        <button type="button" class="btn btn-secondary btn-sm" onclick="openDeleteGuiaModal(${g.id}, ${g.folio})" title="Eliminar Guía" style="color: var(--color-danger);">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    renderGuiasPagination();
}

function renderGuiasPagination() {
    const container = document.getElementById('guias-pagination');
    if (!container) return;

    const total = filteredGuias.length;
    const totalPages = Math.ceil(total / guiasPageSize) || 1;

    if (guiasCurrentPage > totalPages) guiasCurrentPage = totalPages;

    const startIdx = total === 0 ? 0 : (guiasCurrentPage - 1) * guiasPageSize + 1;
    const endIdx = Math.min(guiasCurrentPage * guiasPageSize, total);

    container.innerHTML = `
        <div class="pagination-info" style="font-size: 0.85rem; color: var(--text-secondary);">
            Mostrando <strong>${startIdx}</strong> - <strong>${endIdx}</strong> de <strong>${total}</strong> guías
        </div>
        <div class="pagination-controls" style="display: flex; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeGuiasPage(${guiasCurrentPage - 1})" ${guiasCurrentPage === 1 ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span style="font-size: 0.85rem; font-weight: 600;">Pág. ${guiasCurrentPage} de ${totalPages}</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeGuiasPage(${guiasCurrentPage + 1})" ${guiasCurrentPage === totalPages ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
        <div class="pagination-page-size" style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem;">
            <span>Mostrar</span>
            <select class="filter-select" onchange="changeGuiasPageSize(this.value)" style="padding: 4px 8px; border-radius: 6px;">
                <option value="10" ${guiasPageSize === 10 ? 'selected' : ''}>10</option>
                <option value="15" ${guiasPageSize === 15 ? 'selected' : ''}>15</option>
                <option value="25" ${guiasPageSize === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${guiasPageSize === 50 ? 'selected' : ''}>50</option>
            </select>
        </div>
    `;
}

export function changeGuiasPage(page) {
    if (page < 1) return;
    guiasCurrentPage = page;
    renderGuiasTable();
}

export function changeGuiasPageSize(size) {
    guiasPageSize = Number(size) || 15;
    guiasCurrentPage = 1;
    renderGuiasTable();
}

export function filterGuiasByState(state) {
    currentFilter = state;
    document.querySelectorAll('.guia-filter-btn').forEach(btn => {
        btn.classList.remove('active', 'btn-primary');
        btn.classList.add('btn-secondary');
    });

    const activeBtn = document.getElementById(`guia-filter-${state.toLowerCase()}`);
    if (activeBtn) {
        activeBtn.classList.remove('btn-secondary');
        activeBtn.classList.add('active', 'btn-primary');
    }

    guiasCurrentPage = 1;
    renderGuiasTable();
}

let searchDebounceTimeout = null;
export function handleGuiasSearch(val) {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
        currentSearch = val.trim();
        guiasCurrentPage = 1;
        renderGuiasTable();
    }, 250);
}

// --------------------------------------------------------------------------
// 3. Wizard: Emisión de Nueva Guía
// --------------------------------------------------------------------------
export function openNewGuiaModal() {
    const modal = document.getElementById('guia-wizard-modal');
    if (!modal) return;

    // Calcular próximo folio
    const maxFolio = dbGuias.length > 0 ? Math.max(...dbGuias.map(g => Number(g.folio) || 0)) : 0;
    const nextFolio = maxFolio + 1;

    const fInput = document.getElementById('gw-folio');
    if (fInput) fInput.value = nextFolio;

    const fechaInput = document.getElementById('gw-fecha');
    if (fechaInput) fechaInput.value = new Date().toISOString().split('T')[0];

    const horaInput = document.getElementById('gw-hora');
    if (horaInput) horaInput.value = new Date().toTimeString().slice(0, 5);

    const destinoInput = document.getElementById('gw-destino');
    if (destinoInput) destinoInput.value = '';

    const obsInput = document.getElementById('gw-observaciones');
    if (obsInput) obsInput.value = '';

    const userDisplay = currentUser?.nombre || currentUser?.username || 'Operador de Turno';
    const emisorInput = document.getElementById('gw-emisor');
    if (emisorInput) emisorInput.value = userDisplay;

    // Resetear items
    const container = document.getElementById('gw-items-container');
    if (container) container.innerHTML = '';
    wizardItemCount = 0;
    addWizardItemRow();

    populateGuiasCatalogosDropdowns();
    renderDestinosChips();

    modal.classList.add('active');
}

export function closeNewGuiaModal() {
    const modal = document.getElementById('guia-wizard-modal');
    if (modal) modal.classList.remove('active');
}

export function addWizardItemRow(art = '', desc = '', cant = 1, unid = 'UN') {
    wizardItemCount++;
    const container = document.getElementById('gw-items-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'form-row gw-item-row';
    row.id = `gw-item-row-${wizardItemCount}`;
    row.style.cssText = 'display: grid; grid-template-columns: 2fr 100px 100px 40px; gap: 8px; align-items: center; margin-bottom: 8px;';
    row.innerHTML = `
        <input type="text" class="gw-item-desc" placeholder="Descripción del repuesto, insumo o carga..." value="${desc}" required style="width: 100%;">
        <input type="number" class="gw-item-cant" value="${cant}" min="0.1" step="any" required style="width: 100%; text-align: center; font-family: monospace; font-weight: bold;">
        <select class="gw-item-unid" style="width: 100%;">
            <option value="UN" ${unid === 'UN' ? 'selected' : ''}>UN</option>
            <option value="GL" ${unid === 'GL' ? 'selected' : ''}>GL</option>
            <option value="CJ" ${unid === 'CJ' ? 'selected' : ''}>CJ</option>
            <option value="LT" ${unid === 'LT' ? 'selected' : ''}>LT</option>
            <option value="KG" ${unid === 'KG' ? 'selected' : ''}>KG</option>
            <option value="PAR" ${unid === 'PAR' ? 'selected' : ''}>PAR</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm" onclick="removeWizardItemRow('gw-item-row-${wizardItemCount}')" style="color: var(--color-danger); padding: 6px;" title="Eliminar fila">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;
    container.appendChild(row);
}

export function removeWizardItemRow(rowId) {
    const container = document.getElementById('gw-items-container');
    if (container && container.children.length > 1) {
        document.getElementById(rowId)?.remove();
    } else {
        showToast("La guía debe tener al menos un ítem o producto.", "warning");
    }
}

export function selectDestinoQuick(name) {
    const input = document.getElementById('gw-destino');
    if (input) input.value = name;
}

export async function saveNewGuia(event) {
    event.preventDefault();

    const destino = document.getElementById('gw-destino')?.value.trim();
    if (!destino) {
        showToast("Debe indicar el lugar de entrega o destino.", "warning");
        return;
    }

    const rows = document.querySelectorAll('.gw-item-row');
    const items = [];
    rows.forEach((r, idx) => {
        const desc = r.querySelector('.gw-item-desc')?.value.trim();
        const cant = parseFloat(r.querySelector('.gw-item-cant')?.value) || 1;
        const unid = r.querySelector('.gw-item-unid')?.value || 'UN';
        if (desc) {
            items.push({ articulo: String(idx + 1), descripcion: desc, cantidad: cant, unid, unidad: unid });
        }
    });

    if (items.length === 0) {
        showToast("Ingrese al menos un producto o repuesto en la carga.", "warning");
        return;
    }

    const folioVal = parseInt(document.getElementById('gw-folio')?.value) || null;
    const vehiculo = document.getElementById('gw-vehiculo')?.value || 'Maxus T60';
    const chofer = document.getElementById('gw-chofer')?.value.trim() || 'Chofer de Turno';
    const patente = document.getElementById('gw-patente')?.value.trim() || '';
    const observaciones = document.getElementById('gw-observaciones')?.value.trim() || '';
    const emisor = currentUser?.nombre || currentUser?.username || 'Marco Andrade';

    const guiaData = {
        folio: folioVal,
        fecha: document.getElementById('gw-fecha')?.value || new Date().toISOString().split('T')[0],
        hora: document.getElementById('gw-hora')?.value || '09:00',
        lugar_entrega: destino,
        vehiculo,
        patente,
        chofer,
        observaciones,
        emisor_nombre: emisor,
        estado: 'PENDIENTE'
    };

    try {
        const nueva = await dbInsertGuia(guiaData, items, emisor);
        closeNewGuiaModal();
        updateGuiasDashboardStats();
        renderGuiasTable();
        showToast(`¡Guía Folio #${nueva.folio} emitida correctamente!`, "success");
        openPrintRemitoModal(nueva.id);
    } catch (e) {
        console.error("Error emitiendo guía:", e);
        showToast("Error al emitir la guía de despacho.", "danger");
    }
}

// --------------------------------------------------------------------------
// 4. Drawer Lateral: Detalles, Historial & Timeline
// --------------------------------------------------------------------------
export function openGuiaDrawer(id) {
    const guia = dbGuias.find(g => g.id === id);
    if (!guia) return;

    activeGuiaId = id;
    const drawer = document.getElementById('guia-drawer');
    const overlay = document.getElementById('guia-drawer-overlay');
    if (!drawer || !overlay) return;

    document.getElementById('gd-folio-badge').textContent = `#${guia.folio}`;
    document.getElementById('gd-fecha-label').textContent = `${guia.fecha} • ${guia.hora || '09:00'}`;

    const badge = document.getElementById('gd-estado-badge');
    badge.className = 'badge';
    if (guia.estado === 'ENTREGADA') {
        badge.classList.add('badge-success');
        badge.textContent = 'Entregada Conforme';
    } else if (guia.estado === 'EN_TRANSITO') {
        badge.classList.add('badge-info');
        badge.textContent = 'En Ruta';
    } else if (guia.estado === 'ANULADA') {
        badge.classList.add('badge-danger');
        badge.textContent = 'Anulada';
    } else {
        badge.classList.add('badge-warning');
        badge.textContent = 'Por Despachar';
    }

    document.getElementById('gd-destino').textContent = guia.lugar_entrega || '-';
    document.getElementById('gd-chofer').textContent = guia.chofer || '-';
    document.getElementById('gd-vehiculo').textContent = `${guia.vehiculo || 'Camioneta'} ${guia.patente ? '• ' + guia.patente : ''}`;
    document.getElementById('gd-emisor').textContent = `${guia.emisor_nombre || 'ProCleanMG'}`;
    document.getElementById('gd-obs').textContent = guia.observaciones || 'Sin observaciones.';

    // Recepción conforme card
    const cardRec = document.getElementById('gd-recepcion-card');
    if (guia.estado === 'ENTREGADA' && guia.receptor_nombre) {
        cardRec.style.display = 'block';
        document.getElementById('gd-receptor-nombre').textContent = guia.receptor_nombre;
        document.getElementById('gd-receptor-rut').textContent = guia.receptor_rut || 'Sin RUT registrado';
        document.getElementById('gd-receptor-fecha').textContent = guia.receptor_fecha || guia.updated_at || '-';

        const firmaImg = document.getElementById('gd-firma-img');
        const firmaContainer = document.getElementById('gd-firma-container');
        if (guia.firma_digital) {
            firmaImg.src = guia.firma_digital;
            firmaContainer.style.display = 'block';
        } else {
            firmaContainer.style.display = 'none';
        }
    } else {
        cardRec.style.display = 'none';
    }

    // Lista de ítems
    const itemsList = document.getElementById('gd-items-list');
    document.getElementById('gd-items-count').textContent = `${(guia.items || []).length} producto(s)`;
    itemsList.innerHTML = (guia.items || []).map(it => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg-tertiary); border-radius: var(--radius-sm); margin-bottom: 6px; border: 1px solid var(--border-color);">
            <div style="font-weight: 500; font-size: 0.85rem; color: var(--text-primary);">${it.descripcion}</div>
            <div style="font-weight: 700; font-family: monospace; color: var(--color-primary);">${it.cantidad} ${it.unidad || 'UN'}</div>
        </div>
    `).join('');

    // Acciones dinámicas según estado
    const actionsBox = document.getElementById('gd-actions-container');
    actionsBox.innerHTML = `
        <button type="button" class="btn btn-secondary btn-sm" onclick="openPrintRemitoModal(${guia.id})" style="flex: 1;">
            <i class="fa-solid fa-print"></i> Imprimir Remito
        </button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="openEditGuiaModal(${guia.id})" style="flex: 1;">
            <i class="fa-solid fa-pen-to-square"></i> Editar
        </button>
    `;

    if (guia.estado === 'PENDIENTE') {
        actionsBox.innerHTML += `
            <button type="button" class="btn btn-primary btn-sm" onclick="cambiarEstadoDirecto(${guia.id}, 'EN_TRANSITO')" style="width: 100%; margin-top: 8px;">
                <i class="fa-solid fa-truck-fast"></i> Iniciar Ruta (En Tránsito)
            </button>
        `;
    } else if (guia.estado === 'EN_TRANSITO') {
        actionsBox.innerHTML += `
            <button type="button" class="btn btn-success btn-sm" onclick="openDeliverModal(${guia.id}, ${guia.folio})" style="width: 100%; margin-top: 8px;">
                <i class="fa-solid fa-signature"></i> Registrar Entrega Conforme
            </button>
        `;
    }

    drawer.classList.add('active');
    overlay.classList.add('active');
}

export function closeGuiaDrawer() {
    const drawer = document.getElementById('guia-drawer');
    const overlay = document.getElementById('guia-drawer-overlay');
    if (drawer) drawer.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

export async function cambiarEstadoDirecto(id, estado) {
    const user = currentUser?.nombre || currentUser?.username || 'Operador';
    await dbChangeGuiaEstado(id, estado, user);
    updateGuiasDashboardStats();
    renderGuiasTable();
    openGuiaDrawer(id);
    showToast(`Estado actualizado a: ${estado}`, "info");
}

// --------------------------------------------------------------------------
// 5. Modal: Editar Guía Completa
// --------------------------------------------------------------------------
export function openEditGuiaModal(id) {
    const guia = dbGuias.find(g => g.id === id);
    if (!guia) return;

    activeGuiaId = id;
    const modal = document.getElementById('guia-edit-modal');
    if (!modal) return;

    document.getElementById('ge-id').value = guia.id;
    document.getElementById('ge-folio').value = guia.folio;
    document.getElementById('ge-fecha').value = guia.fecha;
    document.getElementById('ge-hora').value = guia.hora || '09:00';
    document.getElementById('ge-estado').value = guia.estado || 'PENDIENTE';
    document.getElementById('ge-destino').value = guia.lugar_entrega || '';
    document.getElementById('ge-chofer').value = guia.chofer || '';
    document.getElementById('ge-vehiculo').value = guia.vehiculo || '';
    document.getElementById('ge-patente').value = guia.patente || '';
    document.getElementById('ge-observaciones').value = guia.observaciones || '';

    // Render items en edición
    const container = document.getElementById('ge-items-container');
    container.innerHTML = '';
    editItemCount = 0;
    (guia.items || []).forEach(it => {
        addEditItemRow(it.articulo, it.descripcion, it.cantidad, it.unidad);
    });
    if ((guia.items || []).length === 0) {
        addEditItemRow('1', 'Insumos operativos', 1, 'UN');
    }

    modal.classList.add('active');
}

export function closeEditGuiaModal() {
    const modal = document.getElementById('guia-edit-modal');
    if (modal) modal.classList.remove('active');
}

export function addEditItemRow(art = '', desc = '', cant = 1, unid = 'UN') {
    editItemCount++;
    const container = document.getElementById('ge-items-container');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'form-row ge-item-row';
    row.id = `ge-item-row-${editItemCount}`;
    row.style.cssText = 'display: grid; grid-template-columns: 2fr 100px 100px 40px; gap: 8px; align-items: center; margin-bottom: 8px;';
    row.innerHTML = `
        <input type="text" class="ge-item-desc" value="${desc}" placeholder="Descripción..." required style="width: 100%;">
        <input type="number" class="ge-item-cant" value="${cant}" min="0.1" step="any" required style="width: 100%; text-align: center; font-family: monospace; font-weight: bold;">
        <select class="ge-item-unid" style="width: 100%;">
            <option value="UN" ${unid === 'UN' ? 'selected' : ''}>UN</option>
            <option value="GL" ${unid === 'GL' ? 'selected' : ''}>GL</option>
            <option value="CJ" ${unid === 'CJ' ? 'selected' : ''}>CJ</option>
            <option value="LT" ${unid === 'LT' ? 'selected' : ''}>LT</option>
            <option value="KG" ${unid === 'KG' ? 'selected' : ''}>KG</option>
            <option value="PAR" ${unid === 'PAR' ? 'selected' : ''}>PAR</option>
        </select>
        <button type="button" class="btn btn-secondary btn-sm" onclick="document.getElementById('ge-item-row-${editItemCount}').remove()" style="color: var(--color-danger); padding: 6px;">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;
    container.appendChild(row);
}

export async function saveEditGuia(event) {
    event.preventDefault();
    if (!activeGuiaId) return;

    const rows = document.querySelectorAll('.ge-item-row');
    const items = [];
    rows.forEach((r, idx) => {
        const desc = r.querySelector('.ge-item-desc')?.value.trim();
        const cant = parseFloat(r.querySelector('.ge-item-cant')?.value) || 1;
        const unid = r.querySelector('.ge-item-unid')?.value || 'UN';
        if (desc) {
            items.push({ articulo: String(idx + 1), descripcion: desc, cantidad: cant, unid, unidad: unid });
        }
    });

    const updatePayload = {
        folio: parseInt(document.getElementById('ge-folio').value),
        fecha: document.getElementById('ge-fecha').value,
        hora: document.getElementById('ge-hora').value,
        estado: document.getElementById('ge-estado').value,
        lugar_entrega: document.getElementById('ge-destino').value.trim(),
        chofer: document.getElementById('ge-chofer').value.trim(),
        vehiculo: document.getElementById('ge-vehiculo').value.trim(),
        patente: document.getElementById('ge-patente').value.trim(),
        observaciones: document.getElementById('ge-observaciones').value.trim()
    };

    const user = currentUser?.nombre || currentUser?.username || 'Operador';

    try {
        await dbUpdateGuia(activeGuiaId, updatePayload, items, user);
        closeEditGuiaModal();
        updateGuiasDashboardStats();
        renderGuiasTable();
        if (activeGuiaId) openGuiaDrawer(activeGuiaId);
        showToast("Guía guardada exitosamente.", "success");
    } catch (e) {
        console.error(e);
        showToast("Error al guardar cambios.", "danger");
    }
}

// --------------------------------------------------------------------------
// 6. Modal: Registrar Entrega Conforme con Firma Digital
// --------------------------------------------------------------------------
export function openDeliverModal(id, folio) {
    activeDeliverId = id;
    const modal = document.getElementById('guia-deliver-modal');
    if (!modal) return;

    document.getElementById('gdel-folio-badge').textContent = `#${folio}`;
    document.getElementById('gdel-nombre').value = '';
    document.getElementById('gdel-rut').value = '';
    clearGuiaSignature();

    modal.classList.add('active');
}

export function closeDeliverModal() {
    const modal = document.getElementById('guia-deliver-modal');
    if (modal) modal.classList.remove('active');
    activeDeliverId = null;
}

export function initSignaturePad() {
    sigCanvas = document.getElementById('guia-signature-canvas');
    if (!sigCanvas) return;

    sigCtx = sigCanvas.getContext('2d');
    sigCtx.lineWidth = 2.5;
    sigCtx.lineCap = 'round';
    sigCtx.strokeStyle = '#0f172a';

    function getPos(e) {
        const rect = sigCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * (sigCanvas.width / rect.width),
            y: (clientY - rect.top) * (sigCanvas.height / rect.height)
        };
    }

    function startDraw(e) {
        isSigning = true;
        const pos = getPos(e);
        sigCtx.beginPath();
        sigCtx.moveTo(pos.x, pos.y);
        e.preventDefault();
    }

    function moveDraw(e) {
        if (!isSigning) return;
        const pos = getPos(e);
        sigCtx.lineTo(pos.x, pos.y);
        sigCtx.stroke();
        e.preventDefault();
    }

    function stopDraw() { isSigning = false; }

    sigCanvas.addEventListener('mousedown', startDraw);
    sigCanvas.addEventListener('mousemove', moveDraw);
    window.addEventListener('mouseup', stopDraw);

    sigCanvas.addEventListener('touchstart', startDraw, { passive: false });
    sigCanvas.addEventListener('touchmove', moveDraw, { passive: false });
    window.addEventListener('touchend', stopDraw);
}

export function clearGuiaSignature() {
    if (sigCtx && sigCanvas) {
        sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    }
}

export async function saveDeliverModal(event) {
    event.preventDefault();
    if (!activeDeliverId) return;

    const nombre = document.getElementById('gdel-nombre')?.value.trim();
    if (!nombre) {
        showToast("El nombre del receptor es obligatorio.", "warning");
        return;
    }

    const rut = document.getElementById('gdel-rut')?.value.trim() || '';
    const firmaDigital = sigCanvas ? sigCanvas.toDataURL('image/png') : null;
    const user = currentUser?.nombre || currentUser?.username || 'Chofer';

    try {
        await dbConfirmarEntrega(activeDeliverId, {
            receptor_nombre: nombre,
            receptor_rut: rut,
            firma_digital: firmaDigital
        }, user);

        closeDeliverModal();
        updateGuiasDashboardStats();
        renderGuiasTable();
        openGuiaDrawer(activeDeliverId);
        showToast("¡Recepción Conforme registrada exitosamente!", "success");
    } catch (e) {
        console.error(e);
        showToast("Error al registrar la entrega.", "danger");
    }
}

// --------------------------------------------------------------------------
// 7. Modal: Eliminar Guía
// --------------------------------------------------------------------------
export function openDeleteGuiaModal(id, folio) {
    activeDeleteId = id;
    activeDeleteFolio = folio;
    const modal = document.getElementById('guia-delete-modal');
    if (!modal) return;

    document.getElementById('gdel-confirm-folio').textContent = `#${folio}`;
    modal.classList.add('active');
}

export function closeDeleteGuiaModal() {
    const modal = document.getElementById('guia-delete-modal');
    if (modal) modal.classList.remove('active');
    activeDeleteId = null;
    activeDeleteFolio = null;
}

export async function confirmDeleteGuia() {
    if (!activeDeleteId) return;
    const user = currentUser?.nombre || currentUser?.username || 'Operador';
    try {
        await dbDeleteGuia(activeDeleteId, activeDeleteFolio, user);
        closeDeleteGuiaModal();
        closeGuiaDrawer();
        updateGuiasDashboardStats();
        renderGuiasTable();
        showToast(`Guía #${activeDeleteFolio} eliminada permanentemente.`, "info");
    } catch (e) {
        console.error(e);
        showToast("Error al eliminar la guía.", "danger");
    }
}

// --------------------------------------------------------------------------
// 8. Impresión Oficial de Remito (Carta / PDF)
// --------------------------------------------------------------------------
export function openPrintRemitoModal(id) {
    const guia = dbGuias.find(g => g.id === id);
    if (!guia) return;

    const modal = document.getElementById('modal-remito-print');
    if (!modal) return;

    document.getElementById('remito-p-folio').textContent = guia.folio;
    document.getElementById('remito-p-fecha').textContent = guia.fecha;
    document.getElementById('remito-p-razon').textContent = guia.razon_social || 'ProCleanMG SpA';
    document.getElementById('remito-p-tel').textContent = guia.telefono_empresa || '934068272';
    document.getElementById('remito-p-correo').textContent = guia.correo_empresa || 'mandrade@procleanmg.cl';

    document.getElementById('remito-p-emisor').textContent = guia.emisor_nombre || 'Marco Andrade';
    document.getElementById('remito-p-rut-emisor').textContent = guia.emisor_rut || '76801700-K';
    document.getElementById('remito-p-domicilio').textContent = guia.emisor_domicilio || 'Av. Iquique 3115';
    document.getElementById('remito-p-ciudad').textContent = `${guia.emisor_ciudad || 'Antofagasta'} / ${guia.emisor_comuna || 'Antofagasta'}`;

    document.getElementById('remito-p-destino').textContent = guia.lugar_entrega || '-';
    document.getElementById('remito-p-chofer').textContent = guia.chofer || 'Chofer de Turno';
    document.getElementById('remito-p-vehiculo').textContent = guia.vehiculo || 'Maxus T60';
    document.getElementById('remito-p-patente').textContent = guia.patente || '-';
    document.getElementById('remito-p-obs').textContent = guia.observaciones || 'Sin observaciones.';

    // Items
    const tbody = document.getElementById('remito-p-items-body');
    tbody.innerHTML = (guia.items || []).map((it, idx) => `
        <tr style="border-bottom: 1px solid #cbd5e1;">
            <td style="padding: 8px 12px; font-family: monospace; font-weight: 700; color: #1e293b;">${it.articulo || String(idx + 1)}</td>
            <td style="padding: 8px 12px; color: #0f172a; font-weight: 500;">${it.descripcion}</td>
            <td style="padding: 8px 12px; text-align: right; font-family: monospace; font-weight: 800; color: #0f172a;">${it.cantidad} ${it.unidad || 'UN'}</td>
        </tr>
    `).join('');

    // Firma digital si aplica
    const firmaBox = document.getElementById('remito-p-firma-box');
    if (guia.firma_digital) {
        firmaBox.innerHTML = `
            <img src="${guia.firma_digital}" alt="Firma Conforme" style="max-height: 50px; width: auto; object-fit: contain; margin-bottom: 4px;">
            <span style="font-size: 0.72rem; color: #475569; display: block; font-weight: 600;">${guia.receptor_nombre} (${guia.receptor_rut || 'RUT Conforme'})</span>
        `;
    } else {
        firmaBox.innerHTML = `
            <div style="height: 40px;"></div>
            <span style="font-size: 0.75rem; font-weight: 800; color: #1e293b; letter-spacing: 0.08em;">FIRMA Y SELLO DE RECEPCIÓN</span>
        `;
    }

    modal.classList.add('active');

    // Registrar en auditoría
    const user = currentUser?.nombre || currentUser?.username || 'Operador';
    dbLogGuiaImpresion(guia.id, guia.folio, user);
}

export function closePrintRemitoModal() {
    const modal = document.getElementById('modal-remito-print');
    if (modal) modal.classList.remove('active');
}

export function printRemito() {
    window.print();
}

// --------------------------------------------------------------------------
// 9. Exportación a CSV / Excel con Formato ProClean
// --------------------------------------------------------------------------
export function exportGuiasCSV() {
    const list = filteredGuias.length > 0 ? filteredGuias : dbGuias;
    if (!list || list.length === 0) {
        showToast("No hay guías para exportar.", "warning");
        return;
    }

    const headers = [
        "Folio N°",
        "Fecha",
        "Hora",
        "Estado",
        "Lugar de Entrega (Destino)",
        "Chofer",
        "Vehículo",
        "Patente",
        "Emisor Responsable",
        "Receptor Carga",
        "RUT Receptor",
        "Fecha Entrega",
        "Detalle de Carga / Productos",
        "Observaciones"
    ];

    const BOM = "\uFEFF";
    let csvRows = [headers.map(h => `"${h}"`).join(";")];

    list.forEach(g => {
        const itemsStr = (g.items || []).map(i => `${i.cantidad} ${i.unidad || 'UN'} ${i.descripcion}`).join(" // ");
        const row = [
            g.folio,
            g.fecha,
            g.hora || '09:00',
            g.estado,
            (g.lugar_entrega || '').replace(/"/g, '""'),
            (g.chofer || '').replace(/"/g, '""'),
            (g.vehiculo || '').replace(/"/g, '""'),
            (g.patente || '').replace(/"/g, '""'),
            (g.emisor_nombre || '').replace(/"/g, '""'),
            (g.receptor_nombre || '').replace(/"/g, '""'),
            (g.receptor_rut || '').replace(/"/g, '""'),
            (g.receptor_fecha || '').replace(/"/g, '""'),
            itemsStr.replace(/"/g, '""'),
            (g.observaciones || '').replace(/"/g, '""')
        ];
        csvRows.push(row.map(c => `"${c}"`).join(";"));
    });

    const csvContent = BOM + csvRows.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Reporte_Guias_Despacho_ProClean_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Reporte descargado correctamente en formato Excel (CSV).", "success");
}

// --------------------------------------------------------------------------
// 10. Catálogos y Sugerencias de Flota
// --------------------------------------------------------------------------
function populateGuiasCatalogosDropdowns() {
    const vSelect = document.getElementById('gw-vehiculo');
    if (vSelect && dbGuiasCatalogos.vehiculos) {
        vSelect.innerHTML = dbGuiasCatalogos.vehiculos.map(v => `
            <option value="${v.nombre}">${v.nombre}</option>
        `).join('');
    }

    const cSelect = document.getElementById('gw-chofer');
    const dl = document.getElementById('gw-choferes-list');
    if (dl && dbGuiasCatalogos.choferes) {
        dl.innerHTML = dbGuiasCatalogos.choferes.map(c => `
            <option value="${c.nombre}">
        `).join('');
    }
}

function renderDestinosChips() {
    const container = document.getElementById('gw-destinos-chips');
    if (!container || !dbGuiasCatalogos.destinos) return;

    container.innerHTML = dbGuiasCatalogos.destinos.slice(0, 8).map(d => `
        <button type="button" class="btn btn-secondary btn-sm" onclick="selectDestinoQuick('${d.nombre}')" style="font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; margin-right: 4px; margin-bottom: 4px;">
            ${d.nombre}
        </button>
    `).join('');
}
