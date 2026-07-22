// ==========================================================================
// Módulo de Insumos para Mejoras (Seguimiento de Recepciones)
// ==========================================================================

import { 
    dbInsumos, 
    dbInsumoMovimientos, 
    dbInsertSupplyRequest, 
    dbInsertSupplyReception,
    dbAreas,
    dbInventario,
    supabase
} from './db.js';
import { formatRut } from './auth.js';
import { showToast } from './utils.js';
import { currentUser } from './auth.js';
import { updateOutflowStockMax, removeOutflowRow, checkEPPConsumptionDeviation, populateTurnosDropdowns, setupSmartEPPSelector } from './outflow.js';

let currentEvidenceBase64 = "";
let listenersAttached = false;

export function clearEvidenceInput() {
    const fileInput = document.getElementById("new-supply-evidence");
    if (fileInput) fileInput.value = "";
    const previewContainer = document.getElementById("new-supply-evidence-preview");
    if (previewContainer) previewContainer.style.display = "none";
    const previewImg = previewContainer ? previewContainer.querySelector("img") : null;
    if (previewImg) previewImg.src = "";
    currentEvidenceBase64 = "";
}
window.clearEvidenceInput = clearEvidenceInput;

function handleEvidenceFileChange(e) {
    const file = e.target.files[0];
    if (!file) {
        clearEvidenceInput();
        return;
    }
    const reader = new FileReader();
    reader.onload = function(evt) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            
            const MAX_WIDTH = 600;
            const MAX_HEIGHT = 600;
            let width = img.width;
            let height = img.height;
            
            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            
            const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
            currentEvidenceBase64 = dataUrl;
            
            const previewContainer = document.getElementById("new-supply-evidence-preview");
            if (previewContainer) {
                previewContainer.style.display = "block";
                const previewImg = previewContainer.querySelector("img");
                if (previewImg) previewImg.src = dataUrl;
            }
        };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
}

export function openEvidenceModal(src) {
    let modal = document.getElementById("evidence-lightbox-modal");
    if (!modal) {
        modal = document.createElement("div");
        modal.id = "evidence-lightbox-modal";
        modal.className = "modal-overlay";
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 500px; text-align: center; position: relative; padding: 20px; border-radius: var(--radius-lg); background: var(--bg-secondary);">
                <button class="btn-close" onclick="document.getElementById('evidence-lightbox-modal').classList.remove('active')" style="position: absolute; right: 15px; top: 15px; font-size: 1.5rem; background: none; border: none; color: var(--text-primary); cursor: pointer;">&times;</button>
                <h3 style="margin-bottom: 15px;">Evidencia Adjunta</h3>
                <img id="evidence-lightbox-img" src="" alt="Evidencia" style="max-width: 100%; max-height: 400px; border-radius: var(--radius-md); border: 1px solid var(--border-color);">
            </div>
        `;
        document.body.appendChild(modal);
    }
    document.getElementById("evidence-lightbox-img").src = src;
    modal.classList.add("active");
}
window.openEvidenceModal = openEvidenceModal;

export function updateSuppliesStats() {
    const total = dbInsumos.length;
    let pending = 0;
    let received = 0;

    dbInsumos.forEach(ins => {
        if (ins.estado === "Recibido") {
            received++;
        } else {
            pending++;
        }
    });

    const statTotalSupplies = document.getElementById("stat-total-supplies");
    const statPendingSupplies = document.getElementById("stat-pending-supplies");
    const statReceivedSupplies = document.getElementById("stat-received-supplies");

    if (statTotalSupplies) statTotalSupplies.textContent = total;
    if (statPendingSupplies) statPendingSupplies.textContent = pending;
    if (statReceivedSupplies) statReceivedSupplies.textContent = received;
}

export function renderSuppliesTable() {
    const tbody = document.getElementById("supplies-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    if (dbInsumos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">No hay requerimientos registrados.</td></tr>`;
        return;
    }

    dbInsumos.forEach(ins => {
        let totalSolicitado = 0;
        let totalRecibido = 0;
        ins.items.forEach(it => {
            totalSolicitado += Number(it.solicitado);
            totalRecibido += Number(it.recibido);
        });

        let statusBadge = `<span class="badge badge-danger"><i class="fa-solid fa-clock"></i> Pendiente</span>`;
        if (ins.estado === "Recibido" || ins.estado === "Entregado") {
            statusBadge = `<span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Entregado</span>`;
        } else if (ins.estado === "Parcial") {
            statusBadge = `<span class="badge badge-warning"><i class="fa-solid fa-hourglass-half"></i> Parcial</span>`;
        }

        const itemsSummary = ins.items.map(it => `${it.nombre} (${it.recibido}/${it.solicitado})`).join("<br>");

        // Prioridad
        const prio = ins.prioridad || "Media";
        let prioBadge = `<span class="badge-priority-media">Media</span>`;
        if (prio === "Alta") {
            prioBadge = `<span class="badge-priority-alta">Alta</span>`;
        } else if (prio === "Baja") {
            prioBadge = `<span class="badge-priority-baja">Baja</span>`;
        }

        // SLA (Antigüedad)
        let slaBadge = "";
        if (ins.estado === "Recibido" || ins.estado === "Entregado") {
            slaBadge = `<span class="sla-badge sla-normal"><i class="fa-solid fa-check-double"></i> Resuelto</span>`;
        } else {
            const fechaSol = new Date(ins.fecha_solicitud || ins.fechaSolicitud);
            const diffTime = Math.abs(new Date() - fechaSol);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
            
            if (diffDays < 1) {
                slaBadge = `<span class="sla-badge sla-normal"><i class="fa-solid fa-clock"></i> Hoy</span>`;
            } else if (diffDays === 1) {
                slaBadge = `<span class="sla-badge sla-normal"><i class="fa-solid fa-clock"></i> 1 día</span>`;
            } else if (diffDays >= 2 && diffDays < 4) {
                slaBadge = `<span class="sla-badge sla-warning"><i class="fa-solid fa-triangle-exclamation"></i> ${diffDays} días</span>`;
            } else {
                slaBadge = `<span class="sla-badge sla-overdue"><i class="fa-solid fa-circle-exclamation"></i> Vencido (${diffDays} d)</span>`;
            }
        }

        // Evidencia
        let evidenceHtml = `<span style="font-size:0.75rem; color:var(--text-muted);">Sin foto</span>`;
        if (ins.evidencia) {
            evidenceHtml = `<img class="evidence-thumbnail" src="${ins.evidencia}" onclick="openEvidenceModal('${ins.evidencia}')" title="Ver Evidencia">`;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${ins.codigo}</strong></td>
            <td>
                <div style="font-weight:600;">${ins.trabajador || 'N/A'}</div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">RUT: ${ins.rut || 'N/A'}</div>
                <div style="font-size:0.7rem; display:inline-block; background:rgba(255,122,0,0.1); color:var(--color-primary); padding:2px 6px; border-radius:4px; font-weight:700; margin-top:4px;">${ins.turno || 'Sin Turno'}</div>
            </td>
            <td>
                <div style="font-weight:600;">${ins.mejora}</div>
                <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">Solicitado: ${new Date(ins.fecha_solicitud || ins.fechaSolicitud).toLocaleDateString('es-CL')}</div>
                <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px; font-style:italic;">Área: ${ins.proveedor || 'N/A'}</div>
            </td>
            <td style="font-size:0.8rem; line-height:1.4; color:var(--text-secondary);">${itemsSummary}</td>
            <td>${prioBadge}</td>
            <td>${slaBadge}</td>
            <td style="text-align: center;">${evidenceHtml}</td>
            <td>${statusBadge}</td>
            <td>
                <div style="display:flex; gap:6px;">
                    <button type="button" class="btn btn-secondary btn-sm receive-supply-btn" data-id="${ins.id}" ${ins.estado === "Recibido" || ins.estado === "Entregado" ? "disabled" : ""} title="Entregar EPP / Responder">
                        <i class="fa-solid fa-boxes-packing text-success"></i> Entregar
                    </button>
                    <button type="button" class="btn btn-secondary btn-sm report-supply-btn" data-id="${ins.id}" title="Generar Informe PDF para compartir">
                        <i class="fa-solid fa-file-pdf text-danger"></i> Informe
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".receive-supply-btn").forEach(button => {
        button.addEventListener("click", () => {
            openReceiveSupplyModal(button.dataset.id);
        });
    });

    tbody.querySelectorAll(".report-supply-btn").forEach(button => {
        button.addEventListener("click", () => {
            printSupplyReport(button.dataset.id);
        });
    });
}

export function filterSuppliesTable() {
    const searchQuery = document.getElementById("supplies-search").value.toLowerCase();
    const filterStatus = document.getElementById("supplies-filter-status").value;
    const rows = document.querySelectorAll("#supplies-tbody tr");

    rows.forEach(row => {
        const cells = row.getElementsByTagName("td");
        if (cells.length < 8) return; 

        const code = cells[0].textContent.toLowerCase();
        const workerInfo = cells[1].textContent.toLowerCase();
        const projectInfo = cells[2].textContent.toLowerCase();
        const statusText = cells[7].textContent.toLowerCase(); 

        const matchesSearch = code.includes(searchQuery) || workerInfo.includes(searchQuery) || projectInfo.includes(searchQuery);
        
        let matchesStatus = true;
        if (filterStatus === "Pendiente") matchesStatus = statusText.includes("pendiente");
        if (filterStatus === "Parcial") matchesStatus = statusText.includes("parcial");
        if (filterStatus === "Recibido") matchesStatus = statusText.includes("recibido") || statusText.includes("entregado");

        if (matchesSearch && matchesStatus) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}

export function openNewSupplyModal() {
    const modal = document.getElementById("new-supply-modal");
    if (modal) modal.classList.add("active");
    
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 16);
    const dateInput = document.getElementById("new-supply-date");
    if (dateInput) dateInput.value = localISOTime;

    const codeInput = document.getElementById("new-supply-code");
    if (codeInput) codeInput.value = "REQ-" + Math.floor(100 + Math.random() * 900);

    const container = document.getElementById("new-supply-items-container");
    if (container) {
        container.innerHTML = "";
        addNewSupplyItemRow();
    }

    // Populate areas
    const areaSelect = document.getElementById("new-supply-supplier");
    if (areaSelect) {
        areaSelect.innerHTML = dbAreas.map(a => `<option value="${a}">${a}</option>`).join("");
    }

    // Populate turnos
    populateTurnosDropdowns();

    // Clear photo preview
    clearEvidenceInput();

    // Bind listeners once
    if (!listenersAttached) {
        const fileInput = document.getElementById("new-supply-evidence");
        if (fileInput) {
            fileInput.addEventListener("change", handleEvidenceFileChange);
        }
        const rutInput = document.getElementById("new-supply-rut");
        if (rutInput) {
            rutInput.addEventListener("input", (e) => {
                e.target.value = formatRut(e.target.value);
            });
        }
        listenersAttached = true;
    }
}

export function closeNewSupplyModal() {
    const modal = document.getElementById("new-supply-modal");
    if (modal) modal.classList.remove("active");
    const form = document.getElementById("new-supply-form");
    if (form) form.reset();
    clearEvidenceInput();
}

export function setupSmartSupplyEPPSelector(row) {
    const container = row.querySelector(".epp-search-container");
    if (!container) return;

    const searchInput = container.querySelector(".epp-search-input");
    const nameInput = row.querySelector(".supply-item-name");
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
            dropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No se encontraron EPPs coincidentes. Escriba para crear ítem libre.</div>`;
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
    }

    function closeDropdown() {
        dropdown.classList.remove("active");
        row.classList.remove("has-active-dropdown");
    }

    function selectItem(item) {
        const itemText = `${item.codigo ? item.codigo + ' - ' : ''}${item.nombre}`;
        searchInput.value = itemText;
        nameInput.value = item.nombre;
        if (clearBtn) clearBtn.style.display = "block";
        closeDropdown();
    }

    function clearSelection() {
        searchInput.value = "";
        nameInput.value = "";
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
        openDropdown(searchInput.value);
    });

    searchInput.addEventListener("input", () => {
        nameInput.value = searchInput.value;
        if (clearBtn) clearBtn.style.display = searchInput.value ? "block" : "none";
        openDropdown(searchInput.value);
    });

    document.addEventListener("click", (e) => {
        if (!container.contains(e.target)) {
            closeDropdown();
        }
    });
}

export function addNewSupplyItemRow() {
    const container = document.getElementById("new-supply-items-container");
    if (!container) return;
    const rowId = "sup-item-" + Date.now() + Math.random().toString(36).substring(2, 5);

    const row = document.createElement("div");
    row.className = "dynamic-row";
    row.id = rowId;
    row.innerHTML = `
        <div class="form-group">
            <label>Artículo Solicitado (Filtro Inteligente)</label>
            <div class="epp-search-container">
                <div class="epp-search-input-wrapper">
                    <i class="fa-solid fa-magnifying-glass search-icon"></i>
                    <input type="text" class="epp-search-input" placeholder="🔍 Escriba código, SKU o artículo..." autocomplete="off">
                    <i class="fa-solid fa-circle-xmark clear-icon" title="Limpiar selección"></i>
                </div>
                <div class="epp-search-dropdown"></div>
            </div>
            <input type="hidden" class="supply-item-name" required>
        </div>
        <div class="form-group">
            <label>Cantidad Solicitada</label>
            <input type="number" class="supply-item-qty" min="1" value="1" placeholder="0" required>
        </div>
        <button type="button" class="btn-remove btn btn-link" data-row-id="${rowId}" title="Eliminar fila">
            <i class="fa-solid fa-trash-can text-danger"></i>
        </button>
    `;
    container.appendChild(row);

    setupSmartSupplyEPPSelector(row);

    row.querySelector(".btn-remove").addEventListener("click", () => {
        removeNewSupplyItemRow(rowId);
    });
}

export function removeNewSupplyItemRow(rowId) {
    const rows = document.querySelectorAll("#new-supply-items-container .dynamic-row");
    if (rows.length <= 1) {
        showToast("Debe solicitar al menos un artículo.", "warning");
        return;
    }
    const element = document.getElementById(rowId);
    if (element) element.remove();
}

export async function saveNewSupply(event) {
    event.preventDefault();

    const code = document.getElementById("new-supply-code").value.trim().toUpperCase();
    const project = document.getElementById("new-supply-project").value.trim(); // Motivo
    const supplier = document.getElementById("new-supply-supplier").value.trim(); // Área
    const date = document.getElementById("new-supply-date").value;
    const comments = document.getElementById("new-supply-comments").value.trim();

    const worker = document.getElementById("new-supply-worker").value.trim();
    const rut = document.getElementById("new-supply-rut").value.trim();
    const turno = document.getElementById("new-supply-turno").value;
    const priority = document.getElementById("new-supply-priority").value;

    if (dbInsumos.some(i => i.codigo === code)) {
        showToast(`El código de requerimiento "${code}" ya existe.`, "danger");
        return;
    }

    const rowElements = document.querySelectorAll("#new-supply-items-container .dynamic-row");
    const items = [];

    rowElements.forEach(row => {
        const nameInput = row.querySelector(".supply-item-name");
        const qtyInput = row.querySelector(".supply-item-qty");
        
        items.push({
            nombre: nameInput.value.trim(),
            solicitado: Number(qtyInput.value),
            recibido: 0
        });
    });

    const newReq = {
        codigo: code,
        fechaSolicitud: date,
        mejora: project,
        proveedor: supplier,
        items: items,
        estado: "Pendiente",
        comentarios: comments,
        trabajador: worker,
        rut: rut,
        turno: turno,
        prioridad: priority,
        evidencia: currentEvidenceBase64
    };

    try {
        showToast("Registrando requerimiento en Supabase...", "info");
        await dbInsertSupplyRequest(newReq);
        closeNewSupplyModal();
        renderSuppliesTable();
        updateSuppliesStats();
        showToast(`Requerimiento ${code} creado con éxito.`, "success");
    } catch (error) {
        showToast("Error al guardar requerimiento: " + error.message, "danger");
    }
}

export function openReceiveSupplyModal(id) {
    const ins = dbInsumos.find(i => i.id === id);
    if (!ins) return;

    const modalId = document.getElementById("receive-supply-id");
    const recCode = document.getElementById("lbl-rec-code");
    const recProject = document.getElementById("lbl-rec-project");
    const recSupplier = document.getElementById("lbl-rec-supplier");
    const recDate = document.getElementById("lbl-rec-date");
    const recComments = document.getElementById("receive-supply-comments");

    if (modalId) modalId.value = ins.id;
    if (recCode) recCode.textContent = ins.codigo;
    if (recProject) recProject.textContent = ins.mejora;
    if (recSupplier) recSupplier.textContent = ins.proveedor;
    if (recDate) recDate.textContent = new Date(ins.fecha_solicitud || ins.fechaSolicitud).toLocaleDateString('es-CL');
    if (recComments) recComments.value = "";

    const tbody = document.getElementById("receive-supply-items-tbody");
    if (tbody) {
        tbody.innerHTML = "";
        ins.items.forEach((it, idx) => {
            const remaining = it.solicitado - it.recibido;
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${it.nombre}</strong></td>
                <td style="text-align: center;">${it.solicitado}</td>
                <td style="text-align: center; color: var(--text-secondary);">${it.recibido}</td>
                <td style="text-align: center;">
                    <input type="number" class="receive-qty-input" data-index="${idx}" min="0" max="${remaining}" value="${remaining}" ${remaining === 0 ? "disabled" : ""}>
                </td>
                <td style="text-align: center; font-weight: 700; color: var(--color-danger);">${remaining}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    const modal = document.getElementById("receive-supply-modal");
    if (modal) modal.classList.add("active");
}

export function closeReceiveSupplyModal() {
    const modal = document.getElementById("receive-supply-modal");
    if (modal) modal.classList.remove("active");
    const form = document.getElementById("receive-supply-form");
    if (form) form.reset();
}

export async function saveReceiveSupply(event, callbackAfterSave) {
    event.preventDefault();

    const id = document.getElementById("receive-supply-id").value;
    const ins = dbInsumos.find(i => i.id === id);
    if (!ins) return;

    const inputs = document.querySelectorAll(".receive-qty-input");
    const arrivedItems = [];
    let sumArrived = 0;
    let validationError = null;

    inputs.forEach(input => {
        const idx = Number(input.dataset.index);
        const qty = Number(input.value) || 0;
        const item = ins.items[idx];
        const remaining = item.solicitado - item.recibido;

        if (qty < 0) {
            validationError = "Las cantidades recibidas no pueden ser negativas.";
            return;
        }

        if (qty > remaining) {
            validationError = `La cantidad ingresada para "${item.nombre}" supera el restante pendiente (${remaining}).`;
            return;
        }

        if (qty > 0) {
            arrivedItems.push({
                nombre: item.nombre,
                cantidad: qty
            });
            item.recibido += qty;
            sumArrived += qty;
        }
    });

    if (validationError) {
        showToast(validationError, "danger");
        return;
    }

    if (sumArrived === 0) {
        showToast("Debe ingresar al menos una unidad recibida en esta recepción.", "warning");
        return;
    }

    let totalSolicitado = 0;
    let totalRecibido = 0;
    ins.items.forEach(it => {
        totalSolicitado += it.solicitado;
        totalRecibido += it.recibido;
    });

    let newStatus = "Pendiente";
    if (totalRecibido === 0) {
        newStatus = "Pendiente";
    } else if (totalRecibido === totalSolicitado) {
        newStatus = "Recibido";
    } else {
        newStatus = "Parcial";
    }

    const receptionNotes = document.getElementById("receive-supply-comments").value.trim();
    let updatedComments = ins.comentarios;
    if (receptionNotes) {
        updatedComments = (ins.comentarios ? ins.comentarios + "\n" : "") + `[Recepción ${new Date().toLocaleDateString('es-CL')}]: ${receptionNotes}`;
    }

    const newMov = {
        fecha: new Date().toISOString(),
        codigoSolicitud: ins.codigo,
        mejora: ins.mejora,
        items: arrivedItems,
        comentarios: receptionNotes || "Recepción conforme de repuestos en bodega.",
        registrado_por: currentUser.nombre
    };

    try {
        showToast("Registrando recepción en Supabase...", "info");
        await dbInsertSupplyReception(newMov, ins.id, ins.items, newStatus, updatedComments);

        closeReceiveSupplyModal();
        renderSuppliesTable();
        updateSuppliesStats();
        
        if (callbackAfterSave) {
            callbackAfterSave();
        }
        
        showToast(`Recepción de insumos guardada con éxito en la nube.`, "success");
    } catch (error) {
        showToast("Error al guardar recepción: " + error.message, "danger");
    }
}

export function printSupplyReport(id) {
    const ins = dbInsumos.find(i => i.id === id);
    if (!ins) {
        showToast("No se encontró la solicitud de insumos especificada.", "danger");
        return;
    }

    let totalSolicitado = 0;
    let totalRecibido = 0;
    ins.items.forEach(it => {
        totalSolicitado += Number(it.solicitado);
        totalRecibido += Number(it.recibido);
    });
    const pct = totalSolicitado > 0 ? Math.round((totalRecibido / totalSolicitado) * 100) : 0;

    const movimientos = dbInsumoMovimientos.filter(m => m.codigo_solicitud === ins.codigo);
    
    const itemsRowsHTML = ins.items.map(it => {
        const pendiente = it.solicitado - it.recibido;
        let itemStatus = "";
        if (it.recibido === 0) {
            itemStatus = "<span style='color: #e63946; font-weight: bold;'>Pendiente</span>";
        } else if (it.recibido === it.solicitado) {
            itemStatus = "<span style='color: #2ec4b6; font-weight: bold;'>Recibido</span>";
        } else {
            itemStatus = "<span style='color: #ffb703; font-weight: bold;'>Parcial</span>";
        }
        return `
            <tr>
                <td><strong>${it.nombre}</strong></td>
                <td style="text-align: center;">${it.solicitado}</td>
                <td style="text-align: center;">${it.recibido}</td>
                <td style="text-align: center; font-weight: bold; ${pendiente > 0 ? 'color: #e63946;' : ''}">${pendiente}</td>
                <td style="text-align: center;">${itemStatus}</td>
            </tr>
        `;
    }).join("");

    let historySectionHTML = "";
    if (movimientos.length === 0) {
        historySectionHTML = `
            <div style="padding: 12px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; color: #6b7280; font-size: 0.9rem; text-align: center;">
                No se registran recepciones en bodega para esta solicitud todavía.
            </div>
        `;
    } else {
        const sortedMovs = [...movimientos].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        const movRows = sortedMovs.map(mov => {
            const dateStr = new Date(mov.fecha).toLocaleString('es-CL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
            const itemDetails = mov.items.map(it => `${it.cantidad}x ${it.nombre}`).join(", ");
            return `
                <div style="padding: 12px; border-bottom: 1px solid #e5e7eb; font-size: 0.85rem;">
                    <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                        <strong>Recepción: ${dateStr}</strong>
                        <span style="color: #2ec4b6; font-weight: bold;">Ingresado</span>
                    </div>
                    <div style="color: #374151;"><strong>Repuestos ingresados:</strong> ${itemDetails}</div>
                    <div style="color: #6b7280; font-style: italic; margin-top: 4px; background-color: #f3f4f6; padding: 6px 10px; border-radius: 4px;">
                        "${mov.comentarios}"
                    </div>
                </div>
            `;
        }).join("");
        historySectionHTML = `
            <div style="border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; background-color: #ffffff;">
                ${movRows}
            </div>
        `;
    }

    const nowStr = new Date().toLocaleString('es-CL');
    const requestDateStr = new Date(ins.fecha_solicitud || ins.fechaSolicitud).toLocaleString('es-CL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    let statusBadgeHTML = "";
    if (ins.estado === "Recibido") {
        statusBadgeHTML = "<span style='background-color: #2ec4b6; color: white; padding: 4px 12px; border-radius: 30px; font-weight: bold; font-size: 0.8rem;'>TOTALMENTE RECIBIDO</span>";
    } else if (ins.estado === "Parcial") {
        statusBadgeHTML = "<span style='background-color: #ffb703; color: #111827; padding: 4px 12px; border-radius: 30px; font-weight: bold; font-size: 0.8rem;'>RECEPCIÓN PARCIAL</span>";
    } else {
        statusBadgeHTML = "<span style='background-color: #e63946; color: white; padding: 4px 12px; border-radius: 30px; font-weight: bold; font-size: 0.8rem;'>PENDIENTE</span>";
    }

    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
        <html>
        <head>
            <title>Informe de Proyecto - ${ins.codigo}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 40px; color: #111827; line-height: 1.5; }
                .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #e07a5f; padding-bottom: 15px; margin-bottom: 25px; }
                h1 { font-size: 1.4rem; margin: 0; font-weight: 700; text-transform: uppercase; }
                .subtitle { font-size: 0.85rem; color: #4b5563; margin-top: 4px; }
                .meta-container { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 25px; }
                .meta-item { display: flex; font-size: 0.9rem; }
                .meta-label { font-weight: 700; color: #4b5563; min-width: 150px; }
                .section-title { font-size: 1.1rem; font-weight: 700; margin-top: 30px; margin-bottom: 15px; border-left: 4px solid #e07a5f; padding-left: 10px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 25px; }
                th { background-color: #f3f4f6; text-align: left; padding: 12px 16px; border: 1px solid #e5e7eb; font-size: 0.8rem; font-weight: bold; text-transform: uppercase; }
                td { padding: 12px 16px; border: 1px solid #e5e7eb; font-size: 0.85rem; }
                tr:nth-child(even) { background-color: #f9fafb; }
                .progress-wrapper { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
                .progress-bar { height: 8px; flex-grow: 1; background-color: #e5e7eb; border-radius: 4px; overflow: hidden; }
                .progress-fill { height: 100%; background-color: ${ins.estado === "Recibido" ? "#2ec4b6" : (ins.estado === "Parcial" ? "#ffb703" : "#e63946")}; border-radius: 4px; }
                .footer { margin-top: 50px; font-size: 0.75rem; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 15px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h1>Informe de Recepción de Insumos</h1>
                    <div class="subtitle">Faena ProCleanMG | Control y Seguimiento de Materiales</div>
                </div>
            </div>
            
            <div class="meta-container">
                <div class="meta-item"><span class="meta-label">Código Pedido:</span><span><strong>${ins.codigo}</strong></span></div>
                <div class="meta-item"><span class="meta-label">Proyecto / Mejora:</span><span>${ins.mejora}</span></div>
                <div class="meta-item"><span class="meta-label">Proveedor:</span><span>${ins.proveedor}</span></div>
                <div class="meta-item"><span class="meta-label">Fecha Solicitud:</span><span>${requestDateStr}</span></div>
                <div class="meta-item"><span class="meta-label">Estado Actual:</span><span>${statusBadgeHTML}</span></div>
                <div class="meta-item" style="flex-direction: column; align-items: flex-start; justify-content: center;">
                    <div style="display:flex; justify-content:space-between; width:100%; font-size:0.85rem; font-weight:bold;">
                        <span>Avance de Recepción:</span>
                        <span>${pct}% (${totalRecibido}/${totalSolicitado} U)</span>
                    </div>
                    <div class="progress-wrapper" style="width:100%;">
                        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;"></div></div>
                    </div>
                </div>
            </div>
            
            <div class="section-title">Detalle de Repuestos y Materiales</div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 40%;">Nombre del Insumo / Repuesto</th>
                        <th style="text-align: center; width: 15%;">Solicitado</th>
                        <th style="text-align: center; width: 15%;">Recibido</th>
                        <th style="text-align: center; width: 15%;">Pendiente</th>
                        <th style="text-align: center; width: 15%;">Estado</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsRowsHTML}
                </tbody>
            </table>
            
            <div class="section-title">Historial de Recepciones (Log de Bodega)</div>
            ${historySectionHTML}
            
            <div class="footer">
                ProCleanMG &copy; 2026. Reporte oficial generado el ${nowStr}.
            </div>
            <script>
                window.onload = function() { window.print(); window.close(); }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// Cierre de Ciclo: Vincular Requerimiento con Despacho de EPP
export function addOutflowRowWithSelection(eppId, quantity) {
    const container = document.getElementById("outflow-rows-container");
    if (!container) return;
    const rowId = "out-row-" + Date.now() + Math.random().toString(36).substring(2, 5);

    const row = document.createElement("div");
    row.className = "dynamic-row";
    row.id = rowId;
    row.innerHTML = `
        <div class="form-group">
            <label>Seleccionar EPP a Entregar (Filtro Inteligente)</label>
            <div class="epp-search-container">
                <div class="epp-search-input-wrapper">
                    <i class="fa-solid fa-magnifying-glass search-icon"></i>
                    <input type="text" class="epp-search-input" placeholder="🔍 Escriba código, nombre o categoría..." autocomplete="off">
                    <i class="fa-solid fa-circle-xmark clear-icon" title="Limpiar selección"></i>
                </div>
                <div class="epp-search-dropdown"></div>
            </div>
            <input type="hidden" class="outflow-item-select" required>
            <div class="lbl-last-delivery-info" style="margin-top: 6px; font-size: 0.78rem; display: none; font-weight: 600;"></div>
        </div>
        <div class="form-group">
            <label>Cantidad (Stock Máx: <span class="lbl-stock-max" style="font-weight:700;">-</span>)</label>
            <input type="number" class="outflow-qty-input" min="1" placeholder="0" required>
        </div>
        <button type="button" class="btn-remove btn btn-link" data-row-id="${rowId}" title="Eliminar fila">
            <i class="fa-solid fa-trash-can text-danger"></i>
        </button>
    `;
    container.appendChild(row);

    setupSmartEPPSelector(row, eppId);

    row.querySelector(".btn-remove").addEventListener("click", () => {
        removeOutflowRow(rowId);
    });

    const epp = dbInventario.find(i => i.id === eppId);
    if (epp) {
        const qtyInput = row.querySelector(".outflow-qty-input");
        const maxSpan = row.querySelector(".lbl-stock-max");
        maxSpan.textContent = epp.stock;
        qtyInput.max = epp.stock;
        qtyInput.disabled = false;
        qtyInput.value = Math.min(quantity, epp.stock);
    }

    // Trigger initial consumption warning check
    if (typeof checkEPPConsumptionDeviation === 'function') {
        setTimeout(() => {
            checkEPPConsumptionDeviation(rowId);
        }, 100);
    }
}

export function dispatchRequirementToOutflow(id) {
    const ins = dbInsumos.find(i => i.id === id);
    if (!ins) return;

    // Redirigir a pestaña de Salidas
    if (window.switchView) {
        window.switchView("view-outflow");
    }

    // Rellenar campos del colaborador
    const workerNameInput = document.getElementById("outflow-worker-name");
    const workerRutInput = document.getElementById("outflow-worker-rut");
    const workerAreaSelect = document.getElementById("outflow-worker-area");

    if (workerNameInput) workerNameInput.value = ins.trabajador || "";
    if (workerRutInput) workerRutInput.value = ins.rut || "";
    if (workerAreaSelect) {
        workerAreaSelect.value = ins.proveedor || ""; // El campo proveedor almacena el Área
    }

    // Limpiar filas de entrega existentes
    const container = document.getElementById("outflow-rows-container");
    if (container) {
        container.innerHTML = "";
    }

    // Pre-cargar artículos
    if (ins.items && ins.items.length > 0) {
        ins.items.forEach(it => {
            const matchingEPP = dbInventario.find(inv => 
                inv.nombre.toLowerCase().includes(it.nombre.toLowerCase()) ||
                it.nombre.toLowerCase().includes(inv.nombre.toLowerCase())
            );

            if (matchingEPP && matchingEPP.stock > 0) {
                addOutflowRowWithSelection(matchingEPP.id, it.solicitado);
            } else {
                if (window.addOutflowRow) {
                    window.addOutflowRow();
                }
            }
        });
    } else {
        if (window.addOutflowRow) {
            window.addOutflowRow();
        }
    }

    // Guardar ID del requerimiento activo en despacho
    window.activeDispatchRequirementId = ins.id;
    showToast(`Pre-cargados datos de ${ins.trabajador} para despachar el requerimiento ${ins.codigo}.`, "info");
}
window.dispatchRequirementToOutflow = dispatchRequirementToOutflow;

export async function resolveRequirementOnDelivery(id) {
    const ins = dbInsumos.find(i => i.id === id);
    if (!ins) return;

    // Marcar items como recibidos
    const updatedItems = ins.items.map(it => ({
        ...it,
        recibido: it.solicitado
    }));

    try {
        const { error } = await supabase.from('insumos_mejoras')
            .update({
                items: updatedItems,
                estado: "Recibido",
                comentarios: (ins.comentarios ? ins.comentarios + "\n" : "") + "Entregado y resuelto automáticamente al firmar vale de entrega de EPP."
            })
            .eq('id', id);
        
        if (error) throw error;

        // Sincronizar localmente
        const idx = dbInsumos.findIndex(i => i.id === id);
        if (idx !== -1) {
            dbInsumos[idx].items = updatedItems;
            dbInsumos[idx].estado = "Recibido";
            dbInsumos[idx].comentarios = (ins.comentarios ? ins.comentarios + "\n" : "") + "Entregado y resuelto automáticamente al firmar vale de entrega de EPP.";
        }

        window.activeDispatchRequirementId = null;
        showToast(`Requerimiento ${ins.codigo} resuelto y cerrado con éxito.`, "success");
    } catch (e) {
        console.error("Error al cerrar requerimiento:", e);
        showToast("Error al cerrar requerimiento automáticamente: " + e.message, "danger");
    }
}
window.resolveRequirementOnDelivery = resolveRequirementOnDelivery;
