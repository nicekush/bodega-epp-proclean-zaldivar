// ==========================================================================
// Módulo de Inventario de Stock y Categorías
// ==========================================================================

import { 
    dbInventario, 
    dbCategorias, 
    dbInsertEPP, 
    dbUpdateEPPStock, 
    dbUpdateEPPData,
    dbDeleteEPP,
    dbInsertCategory, 
    dbDeleteCategory,
    dbInsertAjusteStock
} from './db.js';
import { showToast, showConfirmDialog, debounce } from './utils.js';
import { currentUser } from './auth.js';

export function updateDashboardStats() {
    const totalItems = dbInventario.length;
    let totalStock = 0;
    let lowStockCount = 0;

    dbInventario.forEach(item => {
        totalStock += Number(item.stock);
        if (item.stock === 0 || item.stock <= item.stock_minimo) {
            lowStockCount++;
        }
    });

    const statTotalItems = document.getElementById("stat-total-items");
    const statTotalStock = document.getElementById("stat-total-stock");
    const statLowStock = document.getElementById("stat-low-stock");

    if (statTotalItems) statTotalItems.textContent = totalItems;
    if (statTotalStock) statTotalStock.textContent = totalStock;
    if (statLowStock) statLowStock.textContent = lowStockCount;

    const lowStockIcon = document.getElementById("stat-low-stock-icon");
    if (lowStockIcon) {
        if (lowStockCount > 0) {
            lowStockIcon.style.color = "var(--color-danger)";
            lowStockIcon.style.backgroundColor = "rgba(230, 57, 70, 0.12)";
        } else {
            lowStockIcon.style.color = "var(--color-warning)";
            lowStockIcon.style.backgroundColor = "rgba(255, 183, 3, 0.08)";
        }
    }
}

let inventoryCurrentPage = 1;
let inventoryPageSize = 15;
let filteredInventory = [];
let sortField = "codigo";
let sortDirection = "asc";

function removeAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function handleInventorySort(field) {
    if (sortField === field) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
        sortField = field;
        sortDirection = "asc";
    }

    const headers = document.querySelectorAll("#table-inventory th.sortable");
    headers.forEach(h => {
        h.classList.remove("active");
        const icon = h.querySelector("i");
        if (icon) {
            icon.className = "fa-solid fa-sort";
        }
        if (h.getAttribute("data-sort") === sortField) {
            h.classList.add("active");
            if (icon) {
                icon.className = sortDirection === "asc" ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
            }
        }
    });

    renderInventoryTable();
}

function applyInventoryFilters() {
    const searchInput = document.getElementById("inventory-search");
    const categorySelect = document.getElementById("inventory-filter-category");
    
    const searchQuery = searchInput ? removeAccents(searchInput.value.toLowerCase().trim()) : "";
    const filterCat = categorySelect ? categorySelect.value : "";
    
    const searchWords = searchQuery.split(/\s+/).filter(w => w.length > 0);

    filteredInventory = dbInventario.filter(item => {
        const itemCode = removeAccents(item.codigo.toLowerCase());
        const itemName = removeAccents(item.nombre.toLowerCase());
        const itemCat = removeAccents(item.categoria ? item.categoria.toLowerCase() : "");

        const matchesCategory = filterCat === "" || item.categoria === filterCat;
        const matchesSearch = searchWords.every(word => {
            return itemCode.includes(word) || itemName.includes(word) || itemCat.includes(word);
        });

        return matchesCategory && matchesSearch;
    });

    filteredInventory.sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];

        if (typeof valA === "string") valA = removeAccents(valA.toLowerCase());
        if (typeof valB === "string") valB = removeAccents(valB.toLowerCase());

        if (valA < valB) return sortDirection === "asc" ? -1 : 1;
        if (valA > valB) return sortDirection === "asc" ? 1 : -1;
        return 0;
    });
}

let smartInventorySearchInitialized = false;

export function setupSmartInventorySearch() {
    const container = document.getElementById("inventory-search-container");
    if (!container || smartInventorySearchInitialized) return;

    const searchInput = document.getElementById("inventory-search");
    const dropdown = document.getElementById("inventory-search-dropdown");
    const clearBtn = document.getElementById("inventory-clear-icon");

    if (!searchInput || !dropdown) return;

    smartInventorySearchInitialized = true;

    function renderDropdown(filterText = "") {
        const query = removeAccents(filterText.toLowerCase().trim());
        const searchWords = query.split(/\s+/).filter(w => w.length > 0);

        if (searchWords.length === 0) {
            dropdown.innerHTML = "";
            dropdown.classList.remove("active");
            return;
        }

        const matches = dbInventario.filter(item => {
            const code = removeAccents((item.codigo || "").toLowerCase());
            const name = removeAccents((item.nombre || "").toLowerCase());
            const cat = removeAccents((item.categoria || "").toLowerCase());
            return searchWords.every(w => code.includes(w) || name.includes(w) || cat.includes(w));
        }).slice(0, 8);

        if (matches.length === 0) {
            dropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No se encontraron EPPs coincidentes.</div>`;
        } else {
            dropdown.innerHTML = matches.map(item => {
                const isZero = item.stock <= 0;
                const isLow = item.stock <= item.stock_minimo;
                let badgeClass = "stock-badge-ok";
                let badgeText = `Stock: ${item.stock} ${item.unidad}`;

                if (isZero) {
                    badgeClass = "stock-badge-zero";
                    badgeText = "Sin Stock";
                } else if (isLow) {
                    badgeClass = "stock-badge-warning";
                    badgeText = `Crítico: ${item.stock}`;
                }

                return `
                    <div class="epp-search-option" data-id="${item.id}" data-code="${item.codigo}" data-name="${item.nombre}">
                        <div class="epp-search-option-info">
                            <span class="epp-search-option-code">${item.codigo || 'S/C'}</span>
                            <span class="epp-search-option-title">${item.nombre}</span>
                            <span class="epp-search-option-category"><i class="fa-solid fa-tag"></i> ${item.categoria || 'Sin categoría'}</span>
                        </div>
                        <span class="epp-search-option-stock ${badgeClass}">${badgeText}</span>
                    </div>
                `;
            }).join("");

            dropdown.querySelectorAll(".epp-search-option").forEach(opt => {
                opt.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const code = opt.dataset.code;
                    const name = opt.dataset.name;
                    searchInput.value = code ? `${code} - ${name}` : name;
                    if (clearBtn) clearBtn.style.display = "block";
                    dropdown.classList.remove("active");
                    filterInventoryTable();
                });
            });
        }

        dropdown.classList.add("active");
    }

    const debouncedSearch = debounce((val) => {
        renderDropdown(val);
        filterInventoryTable();
    }, 150);

    searchInput.addEventListener("input", (e) => {
        const val = e.target.value;
        if (clearBtn) clearBtn.style.display = val ? "block" : "none";
        debouncedSearch(val);
    });

    searchInput.addEventListener("focus", () => {
        if (searchInput.value.trim().length > 0) {
            renderDropdown(searchInput.value);
        }
    });

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            searchInput.value = "";
            clearBtn.style.display = "none";
            dropdown.innerHTML = "";
            dropdown.classList.remove("active");
            filterInventoryTable();
            searchInput.focus();
        });
    }

    document.addEventListener("click", (e) => {
        if (!container.contains(e.target)) {
            dropdown.classList.remove("active");
        }
    });
}
window.setupSmartInventorySearch = setupSmartInventorySearch;

export function renderInventoryTable() {
    setupSmartInventorySearch();
    applyInventoryFilters();
    
    const tbody = document.getElementById("inventory-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (filteredInventory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted);">No hay stock que coincida con los filtros.</td></tr>`;
        renderInventoryPagination();
        return;
    }

    const totalItems = filteredInventory.length;
    const totalPages = Math.ceil(totalItems / inventoryPageSize);
    if (inventoryCurrentPage > totalPages) inventoryCurrentPage = Math.max(1, totalPages);

    const startIndex = (inventoryCurrentPage - 1) * inventoryPageSize;
    const endIndex = Math.min(startIndex + inventoryPageSize, totalItems);
    const pageItems = filteredInventory.slice(startIndex, endIndex);

    pageItems.forEach(item => {
        let statusBadge = "";
        let pct = (item.stock / (item.stock_minimo * 2)) * 100;
        if (pct > 100) pct = 100;
        if (pct < 0) pct = 0;

        let progressBarColor = "var(--color-success)";
        if (item.stock === 0) {
            statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-circle-xmark"></i> Sin Stock</span>`;
            progressBarColor = "var(--color-danger)";
        } else if (item.stock <= item.stock_minimo) {
            statusBadge = `<span class="badge badge-warning"><i class="fa-solid fa-circle-exclamation"></i> Crítico</span>`;
            progressBarColor = "var(--color-warning)";
        } else {
            statusBadge = `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Disponible</span>`;
        }

        const canEditEPP = currentUser && (currentUser.rol === "Administrador" || currentUser.rol === "Supervisor");

        const actionBtn = canEditEPP 
            ? `<div style="display: flex; gap: 8px; align-items: center;">
                <button class="btn btn-secondary btn-sm edit-stock-btn" data-id="${item.id}" title="Ajuste Rápido de Stock">
                    <i class="fa-solid fa-pen-to-square"></i> Stock
                </button>
                <button class="btn btn-primary btn-sm edit-epp-details-btn" data-id="${item.id}" title="Editar Detalle de EPP (Ficha)">
                    <i class="fa-solid fa-file-pen"></i> Editar
                </button>
               </div>`
            : `<div style="display: flex; gap: 8px; align-items: center;">
                <button class="btn btn-secondary btn-sm edit-stock-btn" data-id="${item.id}" title="Ajuste Rápido de Stock">
                    <i class="fa-solid fa-pen-to-square"></i> Stock
                </button>
               </div>`;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${item.codigo}</strong></td>
            <td>${item.nombre}</td>
            <td><span class="badge badge-info">${item.categoria}</span></td>
            <td>${item.stock_minimo} ${item.unidad}</td>
            <td>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <div style="display:flex; justify-content:space-between; font-weight:600; font-size:0.85rem; gap:12px;">
                        <span>${item.stock}</span>
                        <span style="color:var(--text-muted); font-size:0.75rem;">${item.unidad}</span>
                    </div>
                    <div style="height:6px; width:100%; background:rgba(255,255,255,0.05); border-radius:3px; overflow:hidden;">
                        <div style="width:${pct}%; height:100%; background:${progressBarColor}; border-radius:3px;"></div>
                    </div>
                </div>
            </td>
            <td>${statusBadge}</td>
            <td>${actionBtn}</td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".edit-stock-btn").forEach(button => {
        button.addEventListener("click", () => {
            editEPPStock(button.dataset.id);
        });
    });

    tbody.querySelectorAll(".edit-epp-details-btn").forEach(button => {
        button.addEventListener("click", () => {
            openEditEPPModal(button.dataset.id);
        });
    });

    renderInventoryPagination();
}

export function openAdjustStockModal(id) {
    const item = dbInventario.find(i => i.id === id);
    if (!item) return;

    const modal = document.getElementById("adjust-stock-modal");
    const input = document.getElementById("adjust-stock-value");
    const label = document.getElementById("adjust-stock-label");
    const idInput = document.getElementById("adjust-stock-id");

    if (label) label.innerHTML = `Ajuste rápido de inventario para <strong>${item.nombre}</strong> (${item.unidad}):`;
    if (idInput) idInput.value = id;
    if (input) {
        input.value = item.stock;
        input.focus();
    }

    if (modal) modal.classList.add("active");
}

export function closeAdjustStockModal() {
    const modal = document.getElementById("adjust-stock-modal");
    if (modal) modal.classList.remove("active");
}

export async function saveAdjustStock(event) {
    event.preventDefault();
    const id = document.getElementById("adjust-stock-id").value;
    const type = document.getElementById("adjust-stock-type")?.value || "Set";
    const amountVal = Number(document.getElementById("adjust-stock-value").value);
    const reason = document.getElementById("adjust-stock-reason")?.value || "Conteo de Inventario Físico";
    const notes = document.getElementById("adjust-stock-notes")?.value.trim() || "";

    const item = dbInventario.find(i => i.id === id);
    if (!item) {
        showToast("No se encontró el EPP a ajustar.", "danger");
        return;
    }

    if (isNaN(amountVal) || amountVal < 0) {
        showToast("Cantidad ingresada no válida.", "danger");
        return;
    }

    const previousStock = Number(item.stock) || 0;
    let newStock = previousStock;
    let tipoOperacion = "Fijación (=)";

    if (type === "Set") {
        newStock = amountVal;
        tipoOperacion = "Fijación (=)";
    } else if (type === "Add") {
        newStock = previousStock + amountVal;
        tipoOperacion = "Agregar (+)";
    } else if (type === "Subtract") {
        newStock = Math.max(0, previousStock - amountVal);
        tipoOperacion = "Descontar (-)";
    }

    try {
        showToast("Actualizando stock y guardando auditoría...", "info");
        await dbUpdateEPPStock(id, newStock);

        // Guardar registro de auditoría de ajuste
        await dbInsertAjusteStock({
            epp_id: item.id,
            epp_codigo: item.codigo,
            epp_nombre: item.nombre,
            stock_anterior: previousStock,
            stock_nuevo: newStock,
            tipo_operacion: tipoOperacion,
            cantidad_ajuste: amountVal,
            motivo: reason,
            notas: notes,
            usuario: currentUser ? currentUser.nombre : "Operador"
        });

        closeAdjustStockModal();
        renderInventoryTable();
        updateDashboardStats();
        if (window.renderStockAuditTable) window.renderStockAuditTable();
        showToast(`Stock ajustado correctamente de ${previousStock} a ${newStock} ${item.unidad || 'u.'}.`, "success");
    } catch (error) {
        showToast("Error al actualizar el stock: " + error.message, "danger");
    }
}

export function editEPPStock(id) {
    openAdjustStockModal(id);
}

export function openEditEPPModal(id) {
    const item = dbInventario.find(i => i.id === id);
    if (!item) return;

    const modal = document.getElementById("edit-epp-modal");
    const idInput = document.getElementById("edit-epp-id");
    const codeInput = document.getElementById("edit-epp-code");
    const nameInput = document.getElementById("edit-epp-name");
    const categorySelect = document.getElementById("edit-epp-category");
    const minStockInput = document.getElementById("edit-epp-min-stock");
    const unitInput = document.getElementById("edit-epp-unit");

    if (idInput) idInput.value = id;
    if (codeInput) codeInput.value = item.codigo;
    if (nameInput) nameInput.value = item.nombre;
    if (minStockInput) minStockInput.value = item.stock_minimo;
    if (unitInput) unitInput.value = item.unidad;

    const durationInput = document.getElementById("edit-epp-duration");
    if (durationInput) durationInput.value = (item.duracion_meses !== undefined && item.duracion_meses !== null) ? item.duracion_meses : 6;
 
    const controlTypeSelect = document.getElementById("edit-epp-control-type");
    if (controlTypeSelect) controlTypeSelect.value = item.tipo_control || "Consumo";
 
    const deadlineGroup = document.getElementById("edit-epp-deadline-group");
    const deadlineSelect = document.getElementById("edit-epp-return-deadline");
    if (deadlineGroup && deadlineSelect) {
        if (item.tipo_control === "Préstamo") {
            deadlineGroup.style.display = "block";
            deadlineSelect.value = item.plazo_retorno || "12h";
        } else {
            deadlineGroup.style.display = "none";
        }
    }
 
    if (categorySelect) {
        categorySelect.innerHTML = "";
        dbCategorias.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            if (cat === item.categoria) opt.selected = true;
            categorySelect.appendChild(opt);
        });
    }

    const deleteBtn = document.getElementById("btn-delete-epp-action");
    if (deleteBtn) {
        const cleanDeleteBtn = deleteBtn.cloneNode(true);
        deleteBtn.replaceWith(cleanDeleteBtn);
        cleanDeleteBtn.addEventListener("click", () => {
            deleteEPP(id, item.nombre);
        });
    }

    if (modal) modal.classList.add("active");
}

export function closeEditEPPModal() {
    const modal = document.getElementById("edit-epp-modal");
    if (modal) modal.classList.remove("active");
}

export async function saveEditEPP(event) {
    event.preventDefault();
    const id = document.getElementById("edit-epp-id").value;
    const name = document.getElementById("edit-epp-name").value.trim();
    const cat = document.getElementById("edit-epp-category").value;
    const minStock = Number(document.getElementById("edit-epp-min-stock").value);
    const unit = document.getElementById("edit-epp-unit").value.trim();
    const duration = Number(document.getElementById("edit-epp-duration").value || 6);
    const controlType = document.getElementById("edit-epp-control-type")?.value || "Consumo";
    const plazoRetorno = controlType === "Préstamo" ? (document.getElementById("edit-epp-return-deadline")?.value || "12h") : "12h";
 
    try {
        showToast("Actualizando ficha de EPP...", "info");
        await dbUpdateEPPData(id, {
            nombre: name,
            categoria: cat,
            stock_minimo: minStock,
            unidad: unit,
            duracion_meses: duration,
            tipo_control: controlType,
            plazo_retorno: plazoRetorno
        });
        closeEditEPPModal();
        renderInventoryTable();
        updateDashboardStats();
        showToast(`Ficha de EPP actualizada correctamente.`, "success");
    } catch (error) {
        showToast("Error al guardar cambios de EPP: " + error.message, "danger");
    }
}

export async function deleteEPP(id, nombre) {
    const confirmDelete = await showConfirmDialog(
        "Eliminar EPP",
        `¿Está seguro de que desea eliminar permanentemente "${nombre}" de la bodega? Esta acción no se puede deshacer y puede afectar historiales asociados.`
    );
    if (!confirmDelete) return;

    try {
        showToast("Eliminando EPP del catálogo...", "info");
        await dbDeleteEPP(id);
        closeEditEPPModal();
        renderInventoryTable();
        updateDashboardStats();
        showToast(`EPP "${nombre}" eliminado correctamente de la bodega.`, "success");
    } catch (error) {
        showToast("Error al eliminar el EPP: " + error.message, "danger");
    }
}

function renderInventoryPagination() {
    const container = document.getElementById("inventory-pagination");
    if (!container) return;

    const totalItems = filteredInventory.length;
    const totalPages = Math.ceil(totalItems / inventoryPageSize) || 1;

    if (inventoryCurrentPage > totalPages) {
        inventoryCurrentPage = totalPages;
    }

    const startItemIndex = totalItems === 0 ? 0 : (inventoryCurrentPage - 1) * inventoryPageSize + 1;
    const endItemIndex = Math.min(inventoryCurrentPage * inventoryPageSize, totalItems);

    container.innerHTML = `
        <div class="pagination-info">
            Mostrando <strong>${startItemIndex}</strong> - <strong>${endItemIndex}</strong> de <strong>${totalItems}</strong> EPPs
        </div>
        <div class="pagination-controls">
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeInventoryPage(${inventoryCurrentPage - 1})" ${inventoryCurrentPage === 1 ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span style="font-size:0.85rem; font-weight:600; margin:0 8px;">Pág. ${inventoryCurrentPage} de ${totalPages}</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeInventoryPage(${inventoryCurrentPage + 1})" ${inventoryCurrentPage === totalPages ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
        <div class="pagination-page-size">
            <span>Mostrar</span>
            <select onchange="changeInventoryPageSize(this.value)">
                <option value="10" ${inventoryPageSize === 10 ? 'selected' : ''}>10</option>
                <option value="15" ${inventoryPageSize === 15 ? 'selected' : ''}>15</option>
                <option value="25" ${inventoryPageSize === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${inventoryPageSize === 50 ? 'selected' : ''}>50</option>
            </select>
        </div>
    `;
}

export function changeInventoryPage(page) {
    inventoryCurrentPage = page;
    renderInventoryTable();
}

export function changeInventoryPageSize(size) {
    inventoryPageSize = Number(size);
    inventoryCurrentPage = 1;
    renderInventoryTable();
}

export function filterInventoryTable() {
    inventoryCurrentPage = 1;
    renderInventoryTable();
}

export function openNewEPPModal() {
    const modal = document.getElementById("new-epp-modal");
    if (modal) modal.classList.add("active");
    const codeInput = document.getElementById("new-epp-code");
    if (codeInput) codeInput.value = "EPP-" + Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function closeNewEPPModal() {
    const modal = document.getElementById("new-epp-modal");
    if (modal) modal.classList.remove("active");
    const form = document.getElementById("new-epp-form");
    if (form) form.reset();
}

export async function saveNewEPP(event, callbackAfterSave) {
    event.preventDefault();
    const code = document.getElementById("new-epp-code").value.trim().toUpperCase();
    const name = document.getElementById("new-epp-name").value.trim();
    const cat = document.getElementById("new-epp-category").value;
    const minStock = Number(document.getElementById("new-epp-min-stock").value);
    const unit = document.getElementById("new-epp-unit").value.trim();
    const duration = Number(document.getElementById("new-epp-duration").value || 6);
    const controlType = document.getElementById("new-epp-control-type")?.value || "Consumo";
    const plazoRetorno = controlType === "Préstamo" ? (document.getElementById("new-epp-return-deadline")?.value || "12h") : "12h";
 
    if (dbInventario.some(item => item.codigo === code)) {
        showToast(`El código de EPP "${code}" ya existe en el inventario.`, "danger");
        return;
    }
 
    const newItem = {
        codigo: code,
        nombre: name,
        categoria: cat,
        stock: 0,
        stockMinimo: minStock,
        unidad: unit,
        duracion_meses: duration,
        tipo_control: controlType,
        plazo_retorno: plazoRetorno
    };

    try {
        showToast("Guardando EPP en Supabase...", "info");
        await dbInsertEPP(newItem);
        closeNewEPPModal();
        renderInventoryTable();
        updateDashboardStats();
        if (callbackAfterSave) callbackAfterSave();
        showToast(`EPP "${name}" creado con éxito en Supabase.`, "success");
    } catch (error) {
        showToast("Error al guardar el EPP: " + error.message, "danger");
    }
}



export function populateCategoryDropdowns() {
    const filterSelect = document.getElementById("inventory-filter-category");
    const newSelect = document.getElementById("new-epp-category");
    
    if (!filterSelect || !newSelect) return;

    const currentFilterVal = filterSelect.value;
    const currentNewVal = newSelect.value;

    filterSelect.innerHTML = `<option value="">Todas las Categorías</option>`;
    dbCategorias.forEach(cat => {
        filterSelect.innerHTML += `<option value="${cat}">${cat}</option>`;
    });

    newSelect.innerHTML = `<option value="" disabled selected>Seleccione...</option>`;
    dbCategorias.forEach(cat => {
        newSelect.innerHTML += `<option value="${cat}">${cat}</option>`;
    });

    filterSelect.value = currentFilterVal;
    if (dbCategorias.includes(currentNewVal)) {
        newSelect.value = currentNewVal;
    }
}

export function openCategoryModal() {
    const modal = document.getElementById("category-modal");
    if (modal) modal.classList.add("active");
    renderCategoryList();
}

export function closeCategoryModal() {
    const modal = document.getElementById("category-modal");
    if (modal) modal.classList.remove("active");
    const form = document.getElementById("add-category-form");
    if (form) form.reset();
}

export function renderCategoryList() {
    const list = document.getElementById("category-list");
    if (!list) return;

    list.innerHTML = "";
    if (dbCategorias.length === 0) {
        list.innerHTML = `<li style="padding: 16px; text-align:center; color: var(--text-muted); font-size: 0.9rem;">No hay categorías registradas.</li>`;
        return;
    }

    dbCategorias.forEach(cat => {
        const li = document.createElement("li");
        li.className = "category-item";
        li.innerHTML = `
            <span>${cat}</span>
            <button type="button" class="btn-delete-cat btn btn-sm btn-link" data-cat="${cat}" title="Eliminar Categoría">
                <i class="fa-solid fa-trash-can text-danger"></i>
            </button>
        `;
        list.appendChild(li);
    });

    list.querySelectorAll(".btn-delete-cat").forEach(button => {
        button.addEventListener("click", () => {
            deleteCategory(button.dataset.cat);
        });
    });
}

export async function saveNewCategory(event) {
    event.preventDefault();
    const input = document.getElementById("new-category-name");
    const catName = input.value.trim();

    if (!catName) return;

    if (dbCategorias.some(c => c.toLowerCase() === catName.toLowerCase())) {
        showToast(`La categoría "${catName}" ya existe.`, "danger");
        return;
    }

    try {
        showToast("Creando categoría...", "info");
        await dbInsertCategory(catName);
        input.value = "";
        renderCategoryList();
        populateCategoryDropdowns();
        showToast(`Categoría "${catName}" añadida correctamente en la nube.`, "success");
    } catch (error) {
        showToast("Error al guardar la categoría: " + error.message, "danger");
    }
}

export async function deleteCategory(catName) {
    const inUse = dbInventario.some(item => item.categoria === catName);
    if (inUse) {
        showToast(`No se puede eliminar "${catName}" porque está asignada a uno o más EPPs en el catálogo.`, "danger");
        return;
    }

    const confirmDel = await showConfirmDialog(
        "Eliminar Categoría",
        `¿Está seguro de eliminar la categoría "${catName}"?`
    );
    if (!confirmDel) return;

    try {
        showToast("Eliminando categoría...", "info");
        await dbDeleteCategory(catName);
        renderCategoryList();
        populateCategoryDropdowns();
        showToast(`Categoría "${catName}" eliminada en la nube.`, "success");
    } catch (error) {
        showToast("Error al eliminar la categoría: " + error.message, "danger");
    }
}

export function exportStockCSV() {
    if (dbInventario.length === 0) {
        showToast("No hay items en el inventario para exportar.", "warning");
        return;
    }

    const BOM = "\uFEFF";
    let csvRows = ["Código;Nombre EPP;Categoría;Stock Actual;Unidad;Stock Mínimo;Estado"];

    dbInventario.forEach(item => {
        let estado = "Disponible";
        if (item.stock === 0) {
            estado = "SIN STOCK";
        } else if (item.stock <= item.stock_minimo) {
            estado = "CRÍTICO";
        }
        
        const row = [
            `"${(item.codigo || '').replace(/"/g, '""')}"`,
            `"${(item.nombre || '').replace(/"/g, '""')}"`,
            `"${(item.categoria || '').replace(/"/g, '""')}"`,
            item.stock,
            `"${item.unidad || "Unidades"}"`,
            item.stock_minimo,
            `"${estado}"`
        ];
        csvRows.push(row.join(";"));
    });

    const csvString = BOM + csvRows.join("\r\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `reporte_inventario_bodega_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Reporte de stock actual exportado correctamente a Excel (CSV UTF-8).", "success");
}

export function printStockReport() {
    const printWindow = window.open("", "_blank");
    
    let rowsHTML = dbInventario.map(item => `
        <tr>
            <td><strong>${item.codigo}</strong></td>
            <td>${item.nombre}</td>
            <td>${item.categoria}</td>
            <td style="text-align:right;">${item.stock}</td>
            <td>${item.unidad}</td>
            <td style="text-align:right;">${item.stock_minimo}</td>
            <td>${item.stock <= item.stock_minimo ? (item.stock === 0 ? "SIN STOCK" : "STOCK CRÍTICO") : "DISPONIBLE"}</td>
        </tr>
    `).join("");

    const nowStr = new Date().toLocaleString('es-CL');

    printWindow.document.write(`
        <html>
        <head>
            <title>Reporte de Stock de EPP - ProCleanMG</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; color: #111827; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111827; padding-bottom: 10px; margin-bottom: 20px; }
                h1 { font-size: 1.5rem; margin: 0; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                th { background-color: #f3f4f6; text-align: left; padding: 8px; border: 1px solid #d1d5db; font-size: 0.85rem; }
                td { padding: 8px; border: 1px solid #d1d5db; font-size: 0.85rem; }
                tr:nth-child(even) { background-color: #f9fafb; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h1>REPORTE DE INVENTARIO DISPONIBLE (BODEGA)</h1>
                    <div style="font-size: 0.8rem; margin-top: 4px; color: #4b5563;">Generado el: ${nowStr}</div>
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Código</th>
                        <th>Nombre del EPP</th>
                        <th>Categoría</th>
                        <th style="text-align:right;">Stock</th>
                        <th>Unidad</th>
                        <th style="text-align:right;">Stock Mín.</th>
                        <th>Estado</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHTML}
                </tbody>
            </table>
            <script>
                window.onload = function() { window.print(); window.close(); }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}
