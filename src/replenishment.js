// ==========================================================================
// Módulo de Solicitudes de Pedido y Abastecimiento de Bodega (Multi-Item)
// ==========================================================================

import { 
    dbSolicitudesAbastecimiento, 
    dbInventario, 
    dbInsertReplenishmentRequest, 
    dbUpdateReplenishmentStatus,
    dbDeleteReplenishment
} from './db.js';
import { showToast, showConfirmDialog } from './utils.js';
import { currentUser } from './auth.js';
import { renderInventoryTable, updateDashboardStats } from './inventory.js';

let replenishListenersAttached = false;
let selectedReplenishItems = []; // Almacena temporalmente los items de la solicitud en creación/edición
let activeVoucherOrderId = null; // Almacena el ID del pedido que se va a imprimir

export function initReplenishment() {
    if (replenishListenersAttached) return;
    
    // Vincular formulario de creación/edición
    const newForm = document.getElementById("new-replenishment-form");
    if (newForm) {
        newForm.addEventListener("submit", saveNewReplenishment);
    }

    // Vincular formulario de recepción
    const receiveForm = document.getElementById("receive-replenishment-form");
    if (receiveForm) {
        receiveForm.addEventListener("submit", saveReceiveReplenishment);
    }

    replenishListenersAttached = true;
}

// --------------------------------------------------------------------------
// Lógica de manipulación de items dentro del modal de creación/edición
// --------------------------------------------------------------------------

export function renderNewReplenishItemsTable() {
    const tbody = document.getElementById("new-replenish-items-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    if (selectedReplenishItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">
                    No se han agregado artículos a la solicitud.
                </td>
            </tr>
        `;
        return;
    }

    selectedReplenishItems.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${item.nombre}</strong></td>
            <td style="text-align: center; font-family: monospace;">${item.sku}</td>
            <td style="text-align: center; font-weight: 600;">${item.cantidad}</td>
            <td style="text-align: center;">
                <button type="button" class="btn btn-danger btn-sm" onclick="window.removeReplenishmentItemRow(${index})" title="Eliminar fila" style="padding: 4px 8px;">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

export function addReplenishmentItemRow() {
    const itemSelect = document.getElementById("new-replenish-item-select");
    const qtyInput = document.getElementById("new-replenish-item-qty");

    if (!itemSelect || !qtyInput) return;

    const eppId = itemSelect.value;
    const qty = Number(qtyInput.value);

    if (!eppId) {
        showToast("Seleccione un artículo de protección.", "warning");
        return;
    }

    if (isNaN(qty) || qty <= 0) {
        showToast("Ingrese una cantidad válida mayor a cero.", "warning");
        return;
    }

    const item = dbInventario.find(i => i.id === eppId);
    if (!item) return;

    // Verificar si ya existe en la lista para sumarle la cantidad o reemplazarla
    const existingIdx = selectedReplenishItems.findIndex(it => it.eppId === eppId);
    if (existingIdx !== -1) {
        selectedReplenishItems[existingIdx].cantidad += qty;
    } else {
        selectedReplenishItems.push({
            eppId: item.id,
            nombre: item.nombre,
            sku: item.codigo,
            cantidad: qty,
            recibido: 0
        });
    }

    // Resetear campos de selección
    itemSelect.value = "";
    qtyInput.value = "";

    renderNewReplenishItemsTable();
}

export function removeReplenishmentItemRow(index) {
    selectedReplenishItems.splice(index, 1);
    renderNewReplenishItemsTable();
}

export function populateLowStockReplenishItems() {
    let addedCount = 0;
    dbInventario.forEach(item => {
        if (item.stock <= item.stock_minimo) {
            // Verificar si ya está en la lista actual
            const exists = selectedReplenishItems.some(it => it.eppId === item.id);
            if (!exists) {
                const suggestedQty = Math.max(1, (Number(item.stock_minimo) * 2) - Number(item.stock));
                selectedReplenishItems.push({
                    eppId: item.id,
                    nombre: item.nombre,
                    sku: item.codigo,
                    cantidad: suggestedQty,
                    recibido: 0
                });
                addedCount++;
            }
        }
    });

    if (addedCount > 0) {
        showToast(`Se auto-cargaron ${addedCount} artículos críticos.`, "success");
        renderNewReplenishItemsTable();
    } else {
        showToast("No se encontraron artículos adicionales con stock crítico.", "info");
    }
}

// --------------------------------------------------------------------------
// Apertura y Guardado de Solicitudes (Creación y Edición)
// --------------------------------------------------------------------------

export function setupSmartReplenishEPPSelector() {
    const container = document.getElementById("new-replenish-search-container");
    if (!container) return;

    const searchInput = document.getElementById("new-replenish-item-search-input");
    const hiddenSelect = document.getElementById("new-replenish-item-select");
    const dropdown = document.getElementById("new-replenish-item-search-dropdown");
    const clearBtn = document.getElementById("new-replenish-item-clear-icon");

    if (!searchInput || !hiddenSelect || !dropdown) return;

    function renderDropdown(filterText = "") {
        const query = filterText.toLowerCase().trim();
        const matches = dbInventario.filter(item => {
            const codeMatch = (item.codigo || "").toLowerCase().includes(query);
            const nameMatch = (item.nombre || "").toLowerCase().includes(query);
            const catMatch = (item.categoria || "").toLowerCase().includes(query);
            return codeMatch || nameMatch || catMatch;
        });

        if (matches.length === 0) {
            dropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No se encontraron EPPs coincidentes.</div>`;
        } else {
            dropdown.innerHTML = matches.map(item => {
                const isCritical = (Number(item.stock) <= Number(item.stock_minimo));
                const badgeClass = isCritical ? "stock-badge-zero" : "stock-badge-ok";
                const badgeText = isCritical ? `Stock: ${item.stock} [CRÍTICO]` : `Stock: ${item.stock}`;
                return `
                    <div class="epp-search-option" data-id="${item.id}">
                        <div class="epp-search-option-info">
                            <span class="epp-search-option-code">${item.codigo || 'S/C'}</span>
                            <span class="epp-search-option-title">${item.nombre}</span>
                            <span class="epp-search-option-category"><i class="fa-solid fa-tag"></i> ${item.categoria || 'Sin categoría'} (${item.unidad || 'Unidades'})</span>
                        </div>
                        <span class="epp-search-option-stock ${badgeClass}">${badgeText}</span>
                    </div>
                `;
            }).join("");

            dropdown.querySelectorAll(".epp-search-option").forEach(opt => {
                opt.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const eppId = opt.dataset.id;
                    const item = dbInventario.find(i => i.id === eppId);
                    if (item) {
                        selectItem(item);
                    }
                });
            });
        }
    }

    function openDropdown(filterText = "") {
        renderDropdown(filterText);
        dropdown.classList.add("active");
    }

    function closeDropdown() {
        dropdown.classList.remove("active");
    }

    function selectItem(item) {
        hiddenSelect.value = item.id;
        searchInput.value = `${item.codigo ? item.codigo + ' - ' : ''}${item.nombre}`;
        if (clearBtn) clearBtn.style.display = "block";
        closeDropdown();
    }

    function clearSelection() {
        hiddenSelect.value = "";
        searchInput.value = "";
        if (clearBtn) clearBtn.style.display = "none";
        closeDropdown();
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            clearSelection();
        });
    }

    searchInput.addEventListener("focus", () => {
        openDropdown(searchInput.value.includes(" - ") ? "" : searchInput.value);
    });

    searchInput.addEventListener("input", () => {
        if (clearBtn) clearBtn.style.display = searchInput.value ? "block" : "none";
        openDropdown(searchInput.value);
    });

    document.addEventListener("click", (e) => {
        if (!container.contains(e.target)) {
            closeDropdown();
        }
    });
}

export function openNewReplenishmentModal(eppId = null) {
    const modal = document.getElementById("new-replenishment-modal");
    if (!modal) return;

    // Resetear formulario e items
    document.getElementById("new-replenish-id").value = "";
    document.getElementById("new-replenish-comments").value = "";
    const hiddenSelect = document.getElementById("new-replenish-item-select");
    const searchInput = document.getElementById("new-replenish-item-search-input");
    const clearBtn = document.getElementById("new-replenish-item-clear-icon");
    if (hiddenSelect) hiddenSelect.value = "";
    if (searchInput) searchInput.value = "";
    if (clearBtn) clearBtn.style.display = "none";

    selectedReplenishItems = [];
    setupSmartReplenishEPPSelector();

    // Si se abrió desde un botón de acción directa en el catálogo de EPP
    if (eppId) {
        const item = dbInventario.find(i => i.id === eppId);
        if (item) {
            const suggestedQty = Math.max(1, (Number(item.stock_minimo) * 2) - Number(item.stock));
            selectedReplenishItems.push({
                eppId: item.id,
                nombre: item.nombre,
                sku: item.codigo,
                cantidad: suggestedQty,
                recibido: 0
            });
        }
    }

    renderNewReplenishItemsTable();
    modal.classList.add("active");
}

export function openEditReplenishmentModal(id) {
    const req = dbSolicitudesAbastecimiento.find(r => r.id === id);
    if (!req) return;

    if (req.estado !== "Solicitado") {
        showToast("Solo se pueden editar pedidos que aún se encuentran en estado 'Solicitado'.", "warning");
        return;
    }

    const modal = document.getElementById("new-replenishment-modal");
    if (!modal) return;

    const hiddenSelect = document.getElementById("new-replenish-item-select");
    const searchInput = document.getElementById("new-replenish-item-search-input");
    const clearBtn = document.getElementById("new-replenish-item-clear-icon");
    if (hiddenSelect) hiddenSelect.value = "";
    if (searchInput) searchInput.value = "";
    if (clearBtn) clearBtn.style.display = "none";
    setupSmartReplenishEPPSelector();

    // Asignar ID, comentarios y clonar los items correspondientes
    document.getElementById("new-replenish-id").value = id;
    document.getElementById("new-replenish-comments").value = req.comentarios || "";
    
    // Si la orden antigua no tenía array de items (migración), crearlo en base a los datos existentes
    if (req.items && Array.isArray(req.items)) {
        selectedReplenishItems = JSON.parse(JSON.stringify(req.items));
    } else {
        selectedReplenishItems = [{
            eppId: req.epp_id,
            nombre: req.nombre_epp,
            sku: req.sku,
            cantidad: req.cantidad_solicitada,
            recibido: req.cantidad_recibida || 0
        }];
    }

    renderNewReplenishItemsTable();
    modal.classList.add("active");
}

export function closeNewReplenishmentModal() {
    const modal = document.getElementById("new-replenishment-modal");
    if (modal) modal.classList.remove("active");
}

export async function saveNewReplenishment(event) {
    event.preventDefault();

    if (selectedReplenishItems.length === 0) {
        showToast("Debe agregar al menos un artículo al pedido.", "warning");
        return;
    }

    const id = document.getElementById("new-replenish-id").value;
    const comments = document.getElementById("new-replenish-comments").value;
    const isEdit = id && id.length > 0;

    let orderCode;
    let orderDate;
    let registeredBy;

    if (isEdit) {
        const oldReq = dbSolicitudesAbastecimiento.find(r => r.id === id);
        orderCode = oldReq.codigo;
        orderDate = oldReq.fecha;
        registeredBy = oldReq.registrado_por;
    } else {
        // Generar correlativo secuencial
        const orderNumber = 1001 + dbSolicitudesAbastecimiento.length;
        orderCode = `PED-${orderNumber}`;
        orderDate = new Date().toISOString();
        registeredBy = currentUser ? currentUser.nombre : "Operador";
    }

    const payload = {
        id: isEdit ? id : "REP-TEMP-" + Date.now(),
        codigo: orderCode,
        fecha: orderDate,
        items: selectedReplenishItems,
        estado: "Solicitado",
        comentarios: comments,
        registrado_por: registeredBy
    };

    try {
        showToast("Registrando solicitud de pedido...", "info");
        await dbInsertReplenishmentRequest(payload);
        closeNewReplenishmentModal();
        renderReplenishmentsTable();
        updateReplenishmentStats();
        showToast(isEdit ? "Pedido modificado correctamente." : "Pedido de abastecimiento guardado.", "success");
    } catch (e) {
        console.error(e);
        showToast("Error al guardar la solicitud.", "danger");
    }
}

// --------------------------------------------------------------------------
// Tablas, Filtros y Estadísticas Generales
// --------------------------------------------------------------------------

export function updateReplenishmentStats() {
    let totalCount = 0;
    let transitCount = 0;
    let receivedCount = 0;

    dbSolicitudesAbastecimiento.forEach(req => {
        if (req.estado === "Solicitado") {
            totalCount++;
        } else if (req.estado === "Aprobado") {
            transitCount++;
        } else if (req.estado === "Recibido") {
            receivedCount++;
        }
    });

    const repStatTotal = document.getElementById("rep-stat-total");
    const repStatTransit = document.getElementById("rep-stat-transit");
    const repStatReceived = document.getElementById("rep-stat-received");

    if (repStatTotal) repStatTotal.textContent = totalCount;
    if (repStatTransit) repStatTransit.textContent = transitCount;
    if (repStatReceived) repStatReceived.textContent = receivedCount;
}

let replenishmentsCurrentPage = 1;
let replenishmentsPageSize = 15;
let replenishmentsSortField = "codigo";
let replenishmentsSortDirection = "asc";
let filteredReplenishmentsList = [];

export function handleReplenishmentsSort(field) {
    if (replenishmentsSortField === field) {
        replenishmentsSortDirection = replenishmentsSortDirection === "asc" ? "desc" : "asc";
    } else {
        replenishmentsSortField = field;
        replenishmentsSortDirection = "asc";
    }

    const headers = document.querySelectorAll("#table-replenishments th.sortable");
    headers.forEach(h => {
        h.classList.remove("active");
        const icon = h.querySelector("i");
        if (icon) icon.className = "fa-solid fa-sort";
        if (h.getAttribute("data-sort") === replenishmentsSortField) {
            h.classList.add("active");
            if (icon) {
                icon.className = replenishmentsSortDirection === "asc" ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
            }
        }
    });

    renderReplenishmentsTable();
}
window.handleReplenishmentsSort = handleReplenishmentsSort;

export function renderReplenishmentsTable() {
    const tbody = document.getElementById("replenishments-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    const searchInput = document.getElementById("replenish-search");
    const statusSelect = document.getElementById("replenish-filter-status");

    const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const filterStatus = statusSelect ? statusSelect.value : "";

    filteredReplenishmentsList = dbSolicitudesAbastecimiento.filter(req => {
        const matchesStatus = filterStatus === "" || req.estado === filterStatus;
        const matchesSearch = searchQuery === "" || 
            (req.codigo && req.codigo.toLowerCase().includes(searchQuery)) ||
            (req.sku && req.sku.toLowerCase().includes(searchQuery)) ||
            (req.nombre_epp && req.nombre_epp.toLowerCase().includes(searchQuery)) ||
            (req.comentarios && req.comentarios.toLowerCase().includes(searchQuery));
        return matchesStatus && matchesSearch;
    });

    if (filteredReplenishmentsList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding:20px;">No hay pedidos que coincidan con los filtros.</td></tr>`;
        renderReplenishmentsPagination();
        return;
    }

    filteredReplenishmentsList.sort((a, b) => {
        let valA = "";
        let valB = "";

        if (replenishmentsSortField === "eppNombre") {
            valA = (a.items && a.items[0]) ? a.items[0].nombre : (a.nombre_epp || "");
            valB = (b.items && b.items[0]) ? b.items[0].nombre : (b.nombre_epp || "");
        } else if (replenishmentsSortField === "cantidadSolicitada") {
            valA = Number(a.cantidad_solicitada || 0);
            valB = Number(b.cantidad_solicitada || 0);
        } else if (replenishmentsSortField === "cantidadRecibida") {
            valA = Number(a.cantidad_recibida || 0);
            valB = Number(b.cantidad_recibida || 0);
        } else if (replenishmentsSortField === "fecha") {
            valA = new Date(a.fecha || 0).getTime();
            valB = new Date(b.fecha || 0).getTime();
        } else {
            valA = a[replenishmentsSortField] || "";
            valB = b[replenishmentsSortField] || "";
        }

        if (typeof valA === "string") valA = valA.toLowerCase();
        if (typeof valB === "string") valB = valB.toLowerCase();

        if (valA < valB) return replenishmentsSortDirection === "asc" ? -1 : 1;
        if (valA > valB) return replenishmentsSortDirection === "asc" ? 1 : -1;
        return 0;
    });

    const totalItems = filteredReplenishmentsList.length;
    const totalPages = Math.ceil(totalItems / replenishmentsPageSize) || 1;
    if (replenishmentsCurrentPage > totalPages) replenishmentsCurrentPage = totalPages;

    const startIndex = (replenishmentsCurrentPage - 1) * replenishmentsPageSize;
    const endIndex = Math.min(startIndex + replenishmentsPageSize, totalItems);
    const pageItems = filteredReplenishmentsList.slice(startIndex, endIndex);

    pageItems.forEach(req => {
        let statusBadge = "";
        let actionBtn = "";

        const canManage = currentUser && (currentUser.rol === "Administrador" || currentUser.rol === "Supervisor");
        
        let itemsSummary = "";
        if (req.items && Array.isArray(req.items)) {
            itemsSummary = req.items.map(it => `${it.nombre} (x${it.cantidad})`).join(", ");
        } else {
            itemsSummary = `${req.nombre_epp} (x${req.cantidad_solicitada})`;
        }

        const dateStr = req.fecha ? new Date(req.fecha).toLocaleDateString() : "-";

        if (req.estado === "Solicitado") {
            statusBadge = `<span class="badge" style="background: rgba(255, 122, 0, 0.1); color: var(--color-primary);"><i class="fa-solid fa-clock"></i> Solicitado</span>`;
            
            actionBtn = `
                <div style="display:flex; gap:6px;">
                    <button class="btn btn-secondary btn-sm" onclick="window.openEditReplenishmentModal('${req.id}')" title="Editar pedido">
                        <i class="fa-solid fa-pen-to-square text-primary"></i> Editar
                    </button>
                    ${canManage ? `
                    <button class="btn btn-primary btn-sm" onclick="window.transitionReplenishmentStatus('${req.id}', 'Aprobado')" title="Aprobar Pedido">
                        <i class="fa-solid fa-circle-check"></i> Aprobar
                    </button>` : ""}
                </div>
            `;
        } else if (req.estado === "Aprobado") {
            statusBadge = `<span class="badge" style="background: rgba(30, 144, 255, 0.15); color: #1e90ff;"><i class="fa-solid fa-circle-check"></i> Aprobado</span>`;
            
            actionBtn = `
                <button class="btn btn-success btn-sm" onclick="window.openReceiveReplenishmentModal('${req.id}')" title="Recibir en Bodega">
                    <i class="fa-solid fa-box-open"></i> Recibir
                </button>
            `;
        } else if (req.estado === "Recibido") {
            statusBadge = `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Recibido (En Stock)</span>`;
            actionBtn = `<span style="font-size: 0.8rem; color: var(--color-success); font-weight:600;"><i class="fa-solid fa-check-double"></i> Stock Ingresado</span>`;
        }

        const printBtn = `
            <button class="btn btn-secondary btn-sm" onclick="window.openReplenishmentVoucherModal('${req.id}')" title="Imprimir Solicitud PDF" style="margin-left:6px; padding: 4px 8px;">
                <i class="fa-solid fa-file-pdf" style="color: #e63946;"></i> PDF
            </button>
        `;

        const deleteBtn = canManage ? `
            <button class="btn btn-danger-outline btn-sm" onclick="window.handleDeleteReplenishment('${req.id}')" title="Eliminar Solicitud" style="margin-left:6px; padding: 4px 8px;">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        ` : "";

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${req.codigo}</strong></td>
            <td>${dateStr}</td>
            <td>
                <div style="font-weight:600; max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${itemsSummary}">${itemsSummary}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted); font-family: monospace;">Autor: ${req.registrado_por}</div>
            </td>
            <td style="text-align: center; font-weight: 600;">${req.cantidad_solicitada}</td>
            <td style="text-align: center; font-weight: 600; color: ${req.cantidad_recibida > 0 ? 'var(--color-success)' : 'inherit'}">${req.cantidad_recibida || 0}</td>
            <td>${statusBadge}</td>
            <td style="font-size: 0.85rem; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${req.comentarios || ''}">${req.comentarios || "-"}</td>
            <td>
                <div style="display:flex; align-items:center;">
                    ${actionBtn}
                    ${printBtn}
                    ${deleteBtn}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    renderReplenishmentsPagination();
}

function renderReplenishmentsPagination() {
    const container = document.getElementById("replenishments-pagination");
    if (!container) return;

    const totalItems = filteredReplenishmentsList.length;
    const totalPages = Math.ceil(totalItems / replenishmentsPageSize) || 1;
    const startItemIndex = totalItems === 0 ? 0 : (replenishmentsCurrentPage - 1) * replenishmentsPageSize + 1;
    const endItemIndex = Math.min(replenishmentsCurrentPage * replenishmentsPageSize, totalItems);

    container.innerHTML = `
        <div class="pagination-info">
            Mostrando <strong>${startItemIndex}</strong> - <strong>${endItemIndex}</strong> de <strong>${totalItems}</strong> órdenes
        </div>
        <div class="pagination-controls">
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeReplenishmentsPage(${replenishmentsCurrentPage - 1})" ${replenishmentsCurrentPage === 1 ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span style="font-size:0.85rem; font-weight:600; margin:0 8px;">Pág. ${replenishmentsCurrentPage} de ${totalPages}</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeReplenishmentsPage(${replenishmentsCurrentPage + 1})" ${replenishmentsCurrentPage === totalPages ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
        <div class="pagination-page-size">
            <span>Mostrar</span>
            <select onchange="changeReplenishmentsPageSize(this.value)">
                <option value="10" ${replenishmentsPageSize === 10 ? 'selected' : ''}>10</option>
                <option value="15" ${replenishmentsPageSize === 15 ? 'selected' : ''}>15</option>
                <option value="25" ${replenishmentsPageSize === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${replenishmentsPageSize === 50 ? 'selected' : ''}>50</option>
            </select>
        </div>
    `;
}

export function changeReplenishmentsPage(page) {
    replenishmentsCurrentPage = page;
    renderReplenishmentsTable();
}
window.changeReplenishmentsPage = changeReplenishmentsPage;

export function changeReplenishmentsPageSize(size) {
    replenishmentsPageSize = Number(size);
    replenishmentsCurrentPage = 1;
    renderReplenishmentsTable();
}
window.changeReplenishmentsPageSize = changeReplenishmentsPageSize;

export function filterReplenishmentsTable() {
    replenishmentsCurrentPage = 1;
    renderReplenishmentsTable();
}
window.filterReplenishmentsTable = filterReplenishmentsTable;

export async function handleDeleteReplenishment(id) {
    if (!currentUser || (currentUser.rol !== "Administrador" && currentUser.rol !== "Supervisor")) {
        showToast("Acceso denegado: Solo Administradores y Supervisores pueden eliminar solicitudes.", "danger");
        return;
    }

    const req = dbSolicitudesAbastecimiento.find(r => r.id === id);
    const reqCode = req ? (req.codigo || id) : id;

    const confirmDel = await showConfirmDialog(
        "Eliminar Solicitud de Compra",
        `¿Está seguro de eliminar permanentemente la solicitud "${reqCode}"? Esta acción no se puede deshacer.`
    );
    if (!confirmDel) return;

    try {
        showToast("Eliminando solicitud...", "info");
        await dbDeleteReplenishment(id);
        renderReplenishmentsTable();
        updateReplenishmentStats();
        showToast(`Solicitud "${reqCode}" eliminada correctamente.`, "success");
    } catch (e) {
        console.error("Error al eliminar solicitud:", e);
        showToast("Error al intentar eliminar la solicitud de compra.", "danger");
    }
}

// --------------------------------------------------------------------------
// Recepción física de los items
// --------------------------------------------------------------------------

export function openReceiveReplenishmentModal(repId) {
    const modal = document.getElementById("receive-replenishment-modal");
    if (!modal) return;

    const req = dbSolicitudesAbastecimiento.find(r => r.id === repId);
    if (!req) return;

    document.getElementById("receive-replenish-id").value = repId;
    document.getElementById("lbl-rep-rec-code").textContent = req.codigo;
    document.getElementById("lbl-rep-rec-date").textContent = new Date(req.fecha).toLocaleDateString();
    document.getElementById("lbl-rep-rec-user").textContent = req.registrado_por;

    const tbody = document.getElementById("receive-replenish-items-tbody");
    if (tbody) {
        tbody.innerHTML = "";
        
        const itemsList = req.items && Array.isArray(req.items) ? req.items : [{
            eppId: req.epp_id,
            nombre: req.nombre_epp,
            sku: req.sku,
            cantidad: req.cantidad_solicitada,
            recibido: req.cantidad_recibida || 0
        }];

        itemsList.forEach((item, index) => {
            const pendingQty = Math.max(0, Number(item.cantidad) - Number(item.recibido || 0));
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <div style="font-weight:600;">${item.nombre}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">SKU: ${item.sku}</div>
                </td>
                <td style="text-align: center; font-weight:600;">
                    ${item.recibido} / ${item.cantidad}
                </td>
                <td style="text-align: center;">
                    <input type="number" class="receive-item-qty-input" data-index="${index}" min="0" max="${pendingQty}" value="${pendingQty}" style="width: 80px; text-align: center; height: 36px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    const commentsInput = document.getElementById("receive-replenish-comments");
    if (commentsInput) {
        commentsInput.value = "";
    }

    modal.classList.add("active");
}

export function closeReceiveReplenishmentModal() {
    const modal = document.getElementById("receive-replenishment-modal");
    if (modal) modal.classList.remove("active");
}

export async function saveReceiveReplenishment(event) {
    event.preventDefault();

    const id = document.getElementById("receive-replenish-id").value;
    const req = dbSolicitudesAbastecimiento.find(r => r.id === id);
    if (!req) return;

    const itemsList = req.items && Array.isArray(req.items) ? JSON.parse(JSON.stringify(req.items)) : [{
        eppId: req.epp_id,
        nombre: req.nombre_epp,
        sku: req.sku,
        cantidad: req.cantidad_solicitada,
        recibido: req.cantidad_recibida || 0
    }];

    const qtyInputs = document.querySelectorAll(".receive-item-qty-input");
    let hasValidReceipt = false;
    let anyErrors = false;

    qtyInputs.forEach(input => {
        const idx = Number(input.dataset.index);
        const qtyReceived = Number(input.value);

        if (isNaN(qtyReceived) || qtyReceived < 0) {
            anyErrors = true;
            return;
        }

        const pending = itemsList[idx].cantidad - itemsList[idx].recibido;
        if (qtyReceived > pending) {
            anyErrors = true;
            showToast(`La cantidad ingresada supera el saldo pendiente de ${itemsList[idx].nombre}.`, "danger");
            return;
        }

        if (qtyReceived > 0) {
            itemsList[idx].recibido = Number(itemsList[idx].recibido || 0) + qtyReceived;
            itemsList[idx].recibido_ahora = qtyReceived; // Indicador temporal de incremento real
            hasValidReceipt = true;
        } else {
            itemsList[idx].recibido_ahora = 0;
        }
    });

    if (anyErrors) return;

    if (!hasValidReceipt) {
        showToast("Debe ingresar una cantidad a recibir mayor a cero en al menos un artículo.", "warning");
        return;
    }

    const comments = document.getElementById("receive-replenish-comments").value;

    // Verificar si todos los items se completaron
    const isCompleted = itemsList.every(it => Number(it.recibido) >= Number(it.cantidad));
    const nextStatus = isCompleted ? "Recibido" : "Aprobado"; // Si falta por recibir queda Aprobado

    try {
        showToast("Procesando recepción de EPP...", "info");
        await dbUpdateReplenishmentStatus(id, nextStatus, itemsList, comments);
        
        closeReceiveReplenishmentModal();
        renderReplenishmentsTable();
        updateReplenishmentStats();
        
        renderInventoryTable();
        updateDashboardStats();

        showToast("Artículos ingresados y stock actualizado en bodega.", "success");
    } catch (e) {
        console.error(e);
        showToast("Error al registrar la recepción.", "danger");
    }
}

export async function transitionReplenishmentStatus(id, status) {
    try {
        showToast(`Cambiando estado a ${status}...`, "info");
        await dbUpdateReplenishmentStatus(id, status);
        renderReplenishmentsTable();
        updateReplenishmentStats();
        showToast(`Orden actualizada a ${status}.`, "success");
    } catch (e) {
        console.error(e);
        showToast("Error al actualizar la orden.", "danger");
    }
}

// --------------------------------------------------------------------------
// Lógica de Impresión / PDF del Pedido
// --------------------------------------------------------------------------

export function openReplenishmentVoucherModal(id) {
    const req = dbSolicitudesAbastecimiento.find(r => r.id === id);
    if (!req) return;

    activeVoucherOrderId = id;

    // Llenar cabecera e info
    document.getElementById("rep-v-meta-id").textContent = `ID: ${req.codigo}`;
    document.getElementById("rep-v-date").textContent = req.fecha ? new Date(req.fecha).toLocaleString() : "-";
    document.getElementById("rep-v-user").textContent = req.registrado_por;
    document.getElementById("rep-v-status").textContent = req.estado.toUpperCase();
    document.getElementById("rep-v-comments").textContent = req.comentarios || "Sin observaciones.";

    // Llenar tabla
    const tbody = document.getElementById("rep-v-table-tbody");
    if (tbody) {
        tbody.innerHTML = "";
        
        const itemsList = req.items && Array.isArray(req.items) ? req.items : [{
            eppId: req.epp_id,
            nombre: req.nombre_epp,
            sku: req.sku,
            cantidad: req.cantidad_solicitada,
            recibido: req.cantidad_recibida || 0
        }];

        itemsList.forEach(item => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${item.sku}</strong></td>
                <td>${item.nombre}</td>
                <td style="text-align: center; font-weight: 600;">${item.cantidad}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    const modal = document.getElementById("replenishment-voucher-modal");
    if (modal) modal.classList.add("active");
}

export function closeReplenishmentVoucherModal() {
    const modal = document.getElementById("replenishment-voucher-modal");
    if (modal) modal.classList.remove("active");
    activeVoucherOrderId = null;
}

export function printReplenishmentVoucher() {
    const printArea = document.getElementById("replenishment-voucher-print-area");
    if (!printArea) return;

    const bodyClass = document.body.className;
    document.body.classList.add("printing-voucher-active");

    const printContainer = document.createElement("div");
    printContainer.id = "print-invoice-container-temp";
    printContainer.style.position = "absolute";
    printContainer.style.left = "0";
    printContainer.style.top = "0";
    printContainer.style.width = "100%";
    printContainer.style.background = "#fff";
    printContainer.style.color = "#000";
    printContainer.style.zIndex = "9999999";
    printContainer.innerHTML = printArea.innerHTML;

    const titles = printContainer.querySelectorAll(".voucher-section-title");
    titles.forEach(t => {
        t.style.background = "#e2e8f0";
        t.style.color = "#000";
    });
    
    document.body.appendChild(printContainer);
    
    window.print();
    
    document.body.removeChild(printContainer);
    document.body.classList.remove("printing-voucher-active");
}

// Exponer funciones globales
window.openNewReplenishmentModal = openNewReplenishmentModal;
window.openEditReplenishmentModal = openEditReplenishmentModal;
window.closeNewReplenishmentModal = closeNewReplenishmentModal;
window.addReplenishmentItemRow = addReplenishmentItemRow;
window.removeReplenishmentItemRow = removeReplenishmentItemRow;
window.populateLowStockReplenishItems = populateLowStockReplenishItems;
window.openReceiveReplenishmentModal = openReceiveReplenishmentModal;
window.closeReceiveReplenishmentModal = closeReceiveReplenishmentModal;
window.filterReplenishmentsTable = filterReplenishmentsTable;
window.transitionReplenishmentStatus = transitionReplenishmentStatus;
window.openReplenishmentVoucherModal = openReplenishmentVoucherModal;
window.closeReplenishmentVoucherModal = closeReplenishmentVoucherModal;
window.printReplenishmentVoucher = printReplenishmentVoucher;
window.handleDeleteReplenishment = handleDeleteReplenishment;
