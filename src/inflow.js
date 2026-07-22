// ==========================================================================
// Módulo de Ingresos por Factura (Entradas)
// ==========================================================================

import { dbInventario, dbIngresos, dbInsertInflow } from './db.js';
import { showToast, setCurrentDates } from './utils.js';
import { currentUser } from './auth.js';

export function setupInflowForm() {
    const container = document.getElementById("inflow-rows-container");
    if (!container) return;
    container.innerHTML = "";
    addInflowRow();
}

export function setupSmartInflowEPPSelector(row) {
    const container = row.querySelector(".epp-search-container");
    if (!container) return;

    const searchInput = container.querySelector(".epp-search-input");
    const hiddenSelect = row.querySelector(".inflow-item-select");
    const dropdown = container.querySelector(".epp-search-dropdown");
    const clearBtn = container.querySelector(".clear-icon");

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
                const badgeClass = item.stock <= 0 ? "stock-badge-zero" : "stock-badge-ok";
                const badgeText = item.stock <= 0 ? "Sin Stock" : `Stock Actual: ${item.stock}`;
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
        row.classList.add("has-active-dropdown");
        const parentCard = row.closest('.card');
        if (parentCard) parentCard.classList.add("has-active-dropdown");
    }

    function closeDropdown() {
        dropdown.classList.remove("active");
        row.classList.remove("has-active-dropdown");
        const parentCard = row.closest('.card');
        if (parentCard) parentCard.classList.remove("has-active-dropdown");
    }

    function selectItem(item) {
        hiddenSelect.value = item.id;
        searchInput.value = `${item.codigo ? item.codigo + ' - ' : ''}${item.nombre} (${item.unidad || 'Unidades'})`;
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
        openDropdown(searchInput.value.includes(" (") ? "" : searchInput.value);
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

export function addInflowRow() {
    const container = document.getElementById("inflow-rows-container");
    if (!container) return;
    const rowId = "in-row-" + Date.now() + Math.random().toString(36).substring(2, 5);

    const row = document.createElement("div");
    row.className = "dynamic-row";
    row.id = rowId;
    row.innerHTML = `
        <div class="form-group">
            <label>Seleccionar Equipo de Protección (Filtro Inteligente)</label>
            <div class="epp-search-container">
                <div class="epp-search-input-wrapper">
                    <i class="fa-solid fa-magnifying-glass search-icon"></i>
                    <input type="text" class="epp-search-input" placeholder="🔍 Escriba código, nombre o categoría..." autocomplete="off">
                    <i class="fa-solid fa-circle-xmark clear-icon" title="Limpiar selección"></i>
                </div>
                <div class="epp-search-dropdown"></div>
            </div>
            <input type="hidden" class="inflow-item-select" required>
        </div>
        <div class="form-group">
            <label>Cantidad a Ingresar</label>
            <input type="number" class="inflow-qty-input" min="1" placeholder="0" required>
        </div>
        <button type="button" class="btn-remove btn btn-link" data-row-id="${rowId}" title="Eliminar fila">
            <i class="fa-solid fa-trash-can text-danger"></i>
        </button>
    `;
    container.appendChild(row);

    setupSmartInflowEPPSelector(row);

    row.querySelector(".btn-remove").addEventListener("click", () => {
        removeInflowRow(rowId);
    });
}

export function removeInflowRow(rowId) {
    const rows = document.querySelectorAll("#inflow-rows-container .dynamic-row");
    if (rows.length <= 1) {
        showToast("Debe registrar al menos un EPP en la guía.", "warning");
        return;
    }
    const element = document.getElementById(rowId);
    if (element) element.remove();
}

export function resetInflowForm() {
    const form = document.getElementById("inflow-form");
    if (form) form.reset();
    const supplierInput = document.getElementById("inflow-supplier");
    if (supplierInput) supplierInput.value = "ProCleanMG";
    setupInflowForm();
    setCurrentDates();
}

export async function saveInflow(event, switchViewCallback) {
    event.preventDefault();

    const docNum = document.getElementById("inflow-doc-number").value.trim().toUpperCase();
    const supplier = document.getElementById("inflow-supplier").value.trim();
    const date = document.getElementById("inflow-date").value;
    const comments = document.getElementById("inflow-comments").value.trim();

    const rowElements = document.querySelectorAll("#inflow-rows-container .dynamic-row");
    const items = [];

    const selectedIds = [];
    let duplicateFound = false;

    rowElements.forEach(row => {
        const select = row.querySelector(".inflow-item-select");
        const qtyInput = row.querySelector(".inflow-qty-input");
        const eppId = select.value;
        const cantidad = Number(qtyInput.value);

        if (selectedIds.includes(eppId)) {
            duplicateFound = true;
        }
        selectedIds.push(eppId);

        items.push({ eppId, cantidad });
    });

    if (duplicateFound) {
        showToast("Ha ingresado el mismo EPP en varias filas del formulario. Agrúpelas en una sola.", "danger");
        return;
    }

    const newInflow = {
        factura: docNum,
        proveedor: supplier,
        fecha: date,
        items: items,
        comentarios: comments,
        registrado_por: currentUser.nombre
    };

    try {
        showToast("Registrando guía en Supabase...", "info");
        await dbInsertInflow(newInflow);
        
        showToast(`Guía ${docNum} registrada con éxito. Stock ingresado en Supabase.`, "success");
        
        resetInflowForm();
        if (switchViewCallback) switchViewCallback("view-inventory");
    } catch (error) {
        showToast("Error al registrar guía: " + error.message, "danger");
    }
}
