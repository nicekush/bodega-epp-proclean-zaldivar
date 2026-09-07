// ==========================================================================
// Módulo de Entregas (Salidas) y Acta de Firma
// ==========================================================================

import { 
    dbInventario, 
    dbSalidas, 
    dbAreas, 
    dbAreasFull,
    dbTurnos,
    dbInsertOutflow, 
    dbInsertArea, 
    dbDeleteArea,
    dbInsertTurno,
    dbDeleteTurno
} from './db.js';
import { showToast } from './utils.js';
import { currentUser, formatRut, validateRutModulo11, cleanRut, matchesRut } from './auth.js';

let isDrawing = false;
let lastX = 0;
let lastY = 0;
let canvas = null;
let ctx = null;
let listenersAttached = false;

export function initSignatureCanvas() {
    canvas = document.getElementById("outflow-sig-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");

    resizeCanvas();

    if (listenersAttached) return;

    // Mouse drawing listeners
    canvas.addEventListener("mousedown", (e) => {
        isDrawing = true;
        [lastX, lastY] = getCoordinates(e);
    });
    canvas.addEventListener("mousemove", (e) => {
        if (!isDrawing) return;
        draw(e);
    });
    canvas.addEventListener("mouseup", () => isDrawing = false);
    canvas.addEventListener("mouseleave", () => isDrawing = false);

    // Touch drawing listeners
    canvas.addEventListener("touchstart", (e) => {
        if (e.target === canvas) {
            e.preventDefault();
        }
        isDrawing = true;
        const touch = e.touches[0];
        [lastX, lastY] = getCoordinates(touch);
    }, { passive: false });

    canvas.addEventListener("touchmove", (e) => {
        if (e.target === canvas) {
            e.preventDefault();
        }
        if (!isDrawing) return;
        const touch = e.touches[0];
        draw(touch);
    }, { passive: false });

    canvas.addEventListener("touchend", () => isDrawing = false);

    window.addEventListener("resize", () => {
        resizeCanvas();
    });

    listenersAttached = true;
}

function resizeCanvas() {
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
        let tempImage = null;
        if (!isCanvasBlank()) {
            tempImage = canvas.toDataURL();
        }

        canvas.width = Math.round(rect.width) || 480;
        canvas.height = Math.round(rect.height) || 150;

        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        if (tempImage) {
            const img = new Image();
            img.onload = () => {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = tempImage;
        }
    }
}

function getCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    return [
        e.clientX - rect.left,
        e.clientY - rect.top
    ];
}

function draw(e) {
    if (!isDrawing || !ctx) return;
    const [x, y] = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(x, y);
    ctx.stroke();
    [lastX, lastY] = [x, y];
}

export function clearSignatureCanvas() {
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function isCanvasBlank() {
    if (!canvas) return true;
    const blank = document.createElement('canvas');
    blank.width = canvas.width;
    blank.height = canvas.height;
    return canvas.toDataURL() === blank.toDataURL();
}

export function autofillWorkerDetails() {
    const rutInput = document.getElementById("outflow-worker-rut");
    if (!rutInput) return;
    const rut = rutInput.value.trim();

    const nameInput = document.getElementById("outflow-worker-name");
    const areaSelect = document.getElementById("outflow-worker-area");
    const turnoSelect = document.getElementById("outflow-worker-turno");

    if (!rut || rut.length < 5) {
        if (nameInput) nameInput.disabled = false;
        if (areaSelect) areaSelect.disabled = false;
        if (turnoSelect) turnoSelect.disabled = false;
        return;
    }

    // Buscar entregas previas para este RUT (normalizado)
    const cleanR = cleanRut(rut);
    const previousSalidas = dbSalidas.filter(s => cleanRut(s.rut) === cleanR || s.rut === rut);
    if (previousSalidas.length === 0) {
        if (nameInput) nameInput.disabled = false;
        if (areaSelect) areaSelect.disabled = false;
        if (turnoSelect) turnoSelect.disabled = false;
        return;
    }

    // Obtener la más reciente
    previousSalidas.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const recent = previousSalidas[0];

    // Autocompletar nombre, área y turno
    if (nameInput) {
        nameInput.value = recent.trabajador || "";
        nameInput.disabled = true;
    }
    if (areaSelect) {
        areaSelect.value = recent.area || "";
        areaSelect.disabled = false;
    }
    if (turnoSelect) {
        turnoSelect.value = recent.turno || "";
        turnoSelect.disabled = false;
    }
}

export function setupOutflowForm() {
    const container = document.getElementById("outflow-rows-container");
    if (!container) return;
    container.innerHTML = "";
    addOutflowRow();
    
    // Habilitar y limpiar los campos de colaborador
    const nameInput = document.getElementById("outflow-worker-name");
    const areaSelect = document.getElementById("outflow-worker-area");
    const turnoSelect = document.getElementById("outflow-worker-turno");
    if (nameInput) {
        nameInput.disabled = false;
        nameInput.value = "";
    }
    if (areaSelect) {
        areaSelect.disabled = false;
        areaSelect.value = "";
    }
    if (turnoSelect) {
        turnoSelect.disabled = false;
        turnoSelect.value = "";
    }

    // Initialize/configure signature canvas
    initSignatureCanvas();

    // Registrar validador de desviaciones ante cambios de RUT
    const rutInput = document.getElementById("outflow-worker-rut");
    if (rutInput) {
        rutInput.removeEventListener("input", checkAllRowsConsumptionDeviation);
        rutInput.addEventListener("input", checkAllRowsConsumptionDeviation);
        
        rutInput.removeEventListener("blur", autofillWorkerDetails);
        rutInput.addEventListener("blur", autofillWorkerDetails);
        
        rutInput.removeEventListener("input", autofillWorkerDetails);
        rutInput.addEventListener("input", autofillWorkerDetails);
    }
}

export function setupSmartEPPSelector(row, initialEppId = "") {
    const container = row.querySelector(".epp-search-container");
    if (!container) return;

    const searchInput = container.querySelector(".epp-search-input");
    const hiddenSelect = row.querySelector(".outflow-item-select");
    const dropdown = container.querySelector(".epp-search-dropdown");
    const clearBtn = container.querySelector(".clear-icon");
    const rowId = row.id;

    const validItems = dbInventario.filter(item => item.tipo_control !== 'Préstamo');

    function renderDropdown(filterText = "") {
        const query = filterText.toLowerCase().trim();
        const matches = validItems.filter(item => {
            const codeMatch = (item.codigo || "").toLowerCase().includes(query);
            const nameMatch = (item.nombre || "").toLowerCase().includes(query);
            const catMatch = (item.categoria || "").toLowerCase().includes(query);
            return codeMatch || nameMatch || catMatch;
        });

        if (matches.length === 0) {
            dropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No se encontraron EPPs coincidentes.</div>`;
        } else {
            dropdown.innerHTML = matches.map(item => {
                const isZero = item.stock <= 0;
                const badgeClass = isZero ? "stock-badge-zero" : "stock-badge-ok";
                const badgeText = isZero ? "Sin Stock" : `Stock: ${item.stock}`;
                return `
                    <div class="epp-search-option ${isZero ? 'disabled' : ''}" data-id="${item.id}">
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
        searchInput.value = `${item.codigo ? item.codigo + ' - ' : ''}${item.nombre} (Stock: ${item.stock})`;
        if (clearBtn) clearBtn.style.display = "block";
        closeDropdown();

        updateOutflowStockMax(rowId);
        checkEPPConsumptionDeviation(rowId);
        checkSelectedCategories();
    }

    function clearSelection() {
        hiddenSelect.value = "";
        searchInput.value = "";
        if (clearBtn) clearBtn.style.display = "none";
        closeDropdown();
        
        updateOutflowStockMax(rowId);
        checkEPPConsumptionDeviation(rowId);
        checkSelectedCategories();
    }

    if (clearBtn) {
        clearBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            clearSelection();
        });
    }

    searchInput.addEventListener("focus", () => {
        openDropdown(searchInput.value.includes(" (Stock:") ? "" : searchInput.value);
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

    if (initialEppId) {
        const initItem = dbInventario.find(i => i.id === initialEppId);
        if (initItem) {
            selectItem(initItem);
        }
    }
}

export function addOutflowRow() {
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
            <input type="number" class="outflow-qty-input" min="1" placeholder="0" required disabled>
        </div>
        <button type="button" class="btn-remove btn btn-link" data-row-id="${rowId}" title="Eliminar fila">
            <i class="fa-solid fa-trash-can text-danger"></i>
        </button>
    `;
    container.appendChild(row);

    setupSmartEPPSelector(row);

    row.querySelector(".btn-remove").addEventListener("click", () => {
        removeOutflowRow(rowId);
    });
}
 
export function checkSelectedCategories() {
    const clothesContainer = document.getElementById("outflow-clothes-container");
    if (!clothesContainer) return;
    
    let hasClothes = false;
    const selects = document.querySelectorAll(".outflow-item-select");
    selects.forEach(select => {
        const eppId = select.value;
        const epp = dbInventario.find(i => i.id === eppId);
        if (epp && epp.categoria && (epp.categoria.toLowerCase().includes("ropa") || epp.categoria.toLowerCase().includes("vestuario"))) {
            hasClothes = true;
        }
    });
 
    clothesContainer.style.display = hasClothes ? "block" : "none";
}

export function updateOutflowStockMax(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const select = row.querySelector(".outflow-item-select");
    const qtyInput = row.querySelector(".outflow-qty-input");
    const lblMax = row.querySelector(".lbl-stock-max");

    const eppId = select.value;
    const item = dbInventario.find(i => i.id === eppId);

    if (item) {
        qtyInput.disabled = false;
        qtyInput.max = item.stock;
        qtyInput.value = "1";
        lblMax.textContent = item.stock;
    } else {
        qtyInput.disabled = true;
        lblMax.textContent = "-";
    }
}

export function removeOutflowRow(rowId) {
    const rows = document.querySelectorAll("#outflow-rows-container .dynamic-row");
    if (rows.length <= 1) {
        showToast("Debe entregar al menos un EPP al colaborador.", "warning");
        return;
    }
    const element = document.getElementById(rowId);
    if (element) {
        element.remove();
        checkSelectedCategories();
    }
}
 
export function resetOutflowForm() {
    const form = document.getElementById("outflow-form");
    if (form) form.reset();
    clearSignatureCanvas();
    const clothesContainer = document.getElementById("outflow-clothes-container");
    if (clothesContainer) clothesContainer.style.display = "none";
    setupOutflowForm();
}

let isSavingOutflow = false;

export async function saveOutflowAndPrint(event, callbackAfterSave) {
    event.preventDefault();

    const workerName = document.getElementById("outflow-worker-name").value.trim();
    const workerRut = document.getElementById("outflow-worker-rut").value.trim();
    const workerArea = document.getElementById("outflow-worker-area").value;
    const workerTurno = document.getElementById("outflow-worker-turno")?.value || "";
    
    // Validación Módulo 11 de RUT
    if (workerRut && !validateRutModulo11(workerRut)) {
        showToast(`El RUT ingresado (${workerRut}) no es un RUT chileno válido. Verifique el dígito verificador.`, "danger");
        const rutEl = document.getElementById("outflow-worker-rut");
        if (rutEl) {
            rutEl.style.borderColor = "var(--color-danger)";
            rutEl.focus();
        }
        return;
    } else {
        const rutEl = document.getElementById("outflow-worker-rut");
        if (rutEl) rutEl.style.borderColor = "var(--border-color)";
    }

    const now = new Date();
    const dateStr = now.toISOString();

    const rowElements = document.querySelectorAll("#outflow-rows-container .dynamic-row");
    const items = [];
    let validationError = null;

    const selectedIds = [];
    rowElements.forEach(row => {
        const select = row.querySelector(".outflow-item-select");
        const qtyInput = row.querySelector(".outflow-qty-input");
        
        const eppId = select.value;
        const cantidad = Number(qtyInput.value);
        
        if (!eppId) {
            validationError = "Debe seleccionar un EPP en cada fila.";
            return;
        }
        if (!cantidad || cantidad <= 0) {
            validationError = "Debe ingresar una cantidad mayor a cero en cada fila.";
            return;
        }

        const eppDef = dbInventario.find(i => i.id === eppId);
        if (!eppDef) {
            validationError = "El EPP seleccionado ya no se encuentra en el catálogo.";
            return;
        }
        if (cantidad > eppDef.stock) {
            validationError = `Stock insuficiente para ${eppDef.nombre}. Stock real disponible: ${eppDef.stock} ${eppDef.unidad || 'u.'}.`;
            updateOutflowStockMax();
            return;
        }

        if (selectedIds.includes(eppId)) {
            validationError = "Ha seleccionado el mismo EPP en varias filas. Agrúpelas en una sola.";
            return;
        }
        selectedIds.push(eppId);

        items.push({ eppId, cantidad });
    });

    if (validationError) {
        showToast(validationError, "danger");
        return;
    }

    if (items.length === 0) {
        showToast("Debe agregar al menos un EPP para realizar la entrega.", "warning");
        return;
    }
 
    const outflowComments = document.getElementById("outflow-comments")?.value.trim() || "";
    const outflowMotivo = document.getElementById("outflow-motivo")?.value || "Normal";
    const outflowTalla = document.getElementById("outflow-talla")?.value.trim() || "";
    const outflowRazonRopa = document.getElementById("outflow-razon-ropa")?.value || "";

    let signatureVal = "Firma Física en Acta Impresa";
    if (!isCanvasBlank()) {
        signatureVal = canvas.toDataURL("image/png");
    }
 
    const newOutflow = {
        trabajador: workerName,
        rut: workerRut,
        area: workerArea,
        turno: workerTurno,
        fecha: dateStr,
        items: items,
        firma: signatureVal,
        registrado_por: currentUser.nombre,
        comentarios: outflowComments,
        motivo_entrega: outflowMotivo,
        talla_ropa: outflowTalla,
        razon_cambio_ropa: outflowRazonRopa
    };

    if (isSavingOutflow) {
        showToast("Procesando la entrega de EPP, por favor espere...", "warning");
        return;
    }

    const submitBtn = event.target ? event.target.querySelector('button[type="submit"]') : null;
    const originalBtnHTML = submitBtn ? submitBtn.innerHTML : "";
 
    try {
        isSavingOutflow = true;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Registrando...`;
        }

        showToast("Registrando acta en Supabase...", "info");
        const registeredOutflow = await dbInsertOutflow(newOutflow);
        showToast(`Entrega a ${workerName} registrada con éxito.`, "success");
 
        resetOutflowForm();
 
        if (callbackAfterSave) {
            callbackAfterSave(registeredOutflow);
        }
    } catch (error) {
        showToast("Error al registrar la entrega: " + error.message, "danger");
    } finally {
        isSavingOutflow = false;
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHTML;
        }
    }
}

export function showVoucherDetailsById(id) {
    const outflow = dbSalidas.find(s => s.id === id);
    if (outflow) {
        showVoucherDetails(outflow);
    } else {
        showToast("No se encontró el registro de entrega especificado.", "danger");
    }
}

let currentActiveOutflowForPrint = null;

export function showVoucherDetails(outflow) {
    currentActiveOutflowForPrint = outflow;
    const metaId = document.getElementById("v-meta-id");
    const workerName = document.getElementById("v-worker-name");
    const workerRut = document.getElementById("v-worker-rut");
    const workerArea = document.getElementById("v-worker-area");
    const workerTurno = document.getElementById("v-worker-turno");
    const vDate = document.getElementById("v-date");
    const signatureName = document.getElementById("v-signature-name");
    const physicalRut = document.getElementById("v-signature-physical-rut");
    const supervisorNameEl = document.getElementById("v-supervisor-name");

    const formattedRut = formatRut(outflow.rut || "");

    if (metaId) metaId.textContent = `ID: ACTA-${outflow.id.split("-")[1] || outflow.id}`;
    if (workerName) workerName.textContent = outflow.trabajador;
    if (workerRut) workerRut.textContent = formattedRut;
    if (workerArea) workerArea.textContent = outflow.area;
    if (workerTurno) workerTurno.textContent = outflow.turno || "No especificado";
    if (physicalRut) physicalRut.textContent = `RUT: ${formattedRut}`;

    const supervisorName = outflow.registrado_por || (currentUser ? currentUser.nombre : "Bodeguero");
    if (supervisorNameEl) supervisorNameEl.textContent = supervisorName;

    const localDate = new Date(outflow.fecha);
    const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
    if (vDate) vDate.textContent = localDate.toLocaleDateString('es-CL', options);

    const tbody = document.getElementById("v-table-tbody");
    if (tbody) {
        tbody.innerHTML = "";
        outflow.items.forEach(it => {
            const epp = dbInventario.find(i => i.id === it.eppId) || { nombre: "EPP Desconocido", codigo: "???", categoria: "N/A", unidad: "Unidades" };
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${epp.codigo}</strong></td>
                <td>${epp.nombre}</td>
                <td>${epp.categoria}</td>
                <td style="text-align:center; font-weight:700;">${it.cantidad}</td>
                <td>${epp.unidad}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    const sigImg = document.getElementById("v-signature-img");
    const physicalSig = document.getElementById("v-signature-physical");
    let stampText = document.getElementById("v-signature-stamp-text");
    
    if (sigImg) {
        if (outflow.firma && outflow.firma.startsWith("data:")) {
            sigImg.src = outflow.firma;
            sigImg.style.display = "block";
            if (physicalSig) physicalSig.style.display = "none";
            if (stampText) stampText.style.display = "none";
        } else if (outflow.firma === "Firma Física en Acta Impresa") {
            sigImg.style.display = "none";
            if (physicalSig) physicalSig.style.display = "block";
            if (stampText) stampText.style.display = "none";
        } else {
            sigImg.style.display = "none";
            if (physicalSig) physicalSig.style.display = "none";
            if (!stampText) {
                stampText = document.createElement("div");
                stampText.id = "v-signature-stamp-text";
                stampText.style.fontSize = "0.75rem";
                stampText.style.fontWeight = "bold";
                stampText.style.color = "var(--color-success)";
                stampText.style.border = "1.5px dashed var(--color-success)";
                stampText.style.padding = "6px 12px";
                stampText.style.borderRadius = "4px";
                stampText.style.textTransform = "uppercase";
                stampText.style.display = "inline-block";
                stampText.style.margin = "10px 0";
                sigImg.parentNode.appendChild(stampText);
            }
            stampText.textContent = outflow.firma || "Firmado vía QR en Celular";
            stampText.style.display = "inline-block";
        }
    }

    if (signatureName) signatureName.textContent = `Firma de ${outflow.trabajador}`;

    const modal = document.getElementById("voucher-modal");
    if (modal) {
        modal.classList.add("active");
        modal.scrollTop = 0;
        const modalBody = modal.querySelector(".modal-body");
        if (modalBody) modalBody.scrollTop = 0;
    }
}

export function closeVoucherModal() {
    const modal = document.getElementById("voucher-modal");
    if (modal) modal.classList.remove("active");
}

export function printVoucher() {
    const originalTitle = document.title;

    const modal = document.getElementById("voucher-modal");
    if (modal) {
        modal.scrollTop = 0;
        const modalBody = modal.querySelector(".modal-body");
        if (modalBody) modalBody.scrollTop = 0;
    }

    if (currentActiveOutflowForPrint) {
        const rawName = (currentActiveOutflowForPrint.trabajador || "Trabajador").trim();
        const parts = rawName.split(/\s+/);
        let apellido = "";
        let nombre = "";

        if (parts.length >= 2) {
            apellido = parts[parts.length - 1];
            nombre = parts.slice(0, -1).join("_");
        } else {
            apellido = parts[0] || "Trabajador";
            nombre = "";
        }

        const dateObj = currentActiveOutflowForPrint.fecha ? new Date(currentActiveOutflowForPrint.fecha) : new Date();
        const day = String(dateObj.getDate()).padStart(2, '0');
        const month = String(dateObj.getMonth() + 1).padStart(2, '0');
        const year = dateObj.getFullYear();
        const dateStr = `${day}-${month}-${year}`;

        const cleanApellido = apellido.replace(/[^a-zA-Z0-9_-]/g, "");
        const cleanNombre = nombre.replace(/[^a-zA-Z0-9_-]/g, "");

        const filename = cleanNombre ? `${cleanApellido}_${cleanNombre}_${dateStr}_ActaEPP` : `${cleanApellido}_${dateStr}_ActaEPP`;
        document.title = filename;
    }

    window.print();

    setTimeout(() => {
        document.title = originalTitle;
    }, 500);
}

// Gestión de Áreas
export function populateAreasDropdown() {
    const areaSelect = document.getElementById("outflow-worker-area");
    if (!areaSelect) return;

    const selectedVal = areaSelect.value;
    areaSelect.innerHTML = `<option value="" disabled ${!selectedVal ? "selected" : ""}>Seleccione área...</option>`;

    dbAreas.forEach(area => {
        const option = document.createElement("option");
        option.value = area;
        option.textContent = area;
        if (area === selectedVal) {
            option.selected = true;
        }
        areaSelect.appendChild(option);
    });
}

export function openAreasModal() {
    const modal = document.getElementById("areas-modal");
    if (modal) modal.classList.add("active");
    renderAreasList();
}

export function closeAreasModal() {
    const modal = document.getElementById("areas-modal");
    if (modal) modal.classList.remove("active");
    const form = document.getElementById("add-area-form");
    if (form) form.reset();
}

export function renderAreasList() {
    const list = document.getElementById("areas-list");
    if (!list) return;

    list.innerHTML = "";
    if (dbAreas.length === 0) {
        list.innerHTML = `<li style="padding: 16px; text-align:center; color: var(--text-muted); font-size: 0.9rem;">No hay áreas de trabajo registradas.</li>`;
        return;
    }

    dbAreas.forEach(area => {
        const li = document.createElement("li");
        li.className = "area-item";
        li.innerHTML = `
            <span>${area}</span>
            <button type="button" class="btn-delete-area btn btn-sm btn-link" data-area="${area}" title="Eliminar Área">
                <i class="fa-solid fa-trash-can text-danger"></i>
            </button>
        `;
        list.appendChild(li);
    });

    list.querySelectorAll(".btn-delete-area").forEach(button => {
        button.addEventListener("click", () => {
            deleteArea(button.dataset.area);
        });
    });
}

export async function saveNewArea(event) {
    event.preventDefault();
    const input = document.getElementById("new-area-name");
    const areaName = input.value.trim();

    if (!areaName) return;

    if (dbAreas.some(a => a.toLowerCase() === areaName.toLowerCase())) {
        showToast(`El área "${areaName}" ya existe.`, "danger");
        return;
    }

    try {
        showToast("Creando área...", "info");
        await dbInsertArea(areaName);
        input.value = "";
        renderAreasList();
        populateAreasDropdown();
        showToast(`Área "${areaName}" añadida correctamente en la nube.`, "success");
    } catch (error) {
        showToast("Error al guardar el área: " + error.message, "danger");
    }
}

export async function deleteArea(areaName) {
    const inUse = dbSalidas.some(outflow => outflow.area === areaName);
    if (inUse) {
        showToast(`No se puede eliminar "${areaName}" porque está asignada a entregas registradas en el historial.`, "danger");
        return;
    }

    if (confirm(`¿Está seguro de eliminar el área "${areaName}"?`)) {
        try {
            showToast("Eliminando área...", "info");
            await dbDeleteArea(areaName);
            renderAreasList();
            populateAreasDropdown();
            showToast(`Área "${areaName}" eliminada en la nube.`, "success");
        } catch (error) {
            showToast("Error al eliminar el área: " + error.message, "danger");
        }
    }
}

export function checkEPPConsumptionDeviation(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;

    const select = row.querySelector(".outflow-item-select");
    const infoDiv = row.querySelector(".lbl-last-delivery-info");
    if (!select || !infoDiv) return;

    const eppId = select.value;
    const rutInput = document.getElementById("outflow-worker-rut");
    const rut = rutInput ? rutInput.value.trim() : "";

    if (!eppId || !rut || rut.length < 5) {
        infoDiv.style.display = "none";
        return;
    }

    // Buscar entregas del colaborador para este EPP específico (RUT normalizado)
    const cleanR = cleanRut(rut);
    const matchingDeliveries = dbSalidas.filter(s => 
        (cleanRut(s.rut) === cleanR || s.rut === rut) && s.items.some(it => it.eppId === eppId)
    );

    if (matchingDeliveries.length === 0) {
        infoDiv.style.display = "block";
        infoDiv.style.color = "var(--color-success)";
        infoDiv.innerHTML = `<i class="fa-solid fa-circle-check"></i> Primera entrega de este EPP para el colaborador.`;
        return;
    }

    // Ordenar cronológicamente descendiente
    matchingDeliveries.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    const lastDelivery = matchingDeliveries[0];
    const lastDate = new Date(lastDelivery.fecha);
    const diffTime = Math.abs(new Date() - lastDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // Obtener duración esperada del catálogo (por defecto 6 meses)
    const epp = dbInventario.find(i => i.id === eppId);
    const lifespanMonths = (epp && epp.duracion_meses !== undefined && epp.duracion_meses !== null) ? Number(epp.duracion_meses) : 6;
    const lifespanDays = lifespanMonths * 30;

    let alertColor = "var(--color-success)";
    let alertIcon = `<i class="fa-solid fa-circle-check"></i>`;
    let statusText = "Consumo Correcto";

    if (diffDays < lifespanDays * 0.5) {
        alertColor = "var(--color-danger)";
        alertIcon = `<i class="fa-solid fa-triangle-exclamation"></i>`;
        statusText = `Desviación Crítica (Frecuencia de cambio alta)`;
    } else if (diffDays < lifespanDays * 0.85) {
        alertColor = "var(--color-warning)";
        alertIcon = `<i class="fa-solid fa-circle-exclamation"></i>`;
        statusText = `Alerta: Consumo prematuro`;
    }

    infoDiv.style.display = "block";
    infoDiv.style.color = alertColor;
    infoDiv.innerHTML = `${alertIcon} Última entrega: ${lastDate.toLocaleDateString('es-CL')} (Hace ${diffDays} días). Esperado: ${lifespanDays} días.<br>${statusText}`;
}

export function checkAllRowsConsumptionDeviation() {
    const rows = document.querySelectorAll("#outflow-rows-container .dynamic-row");
    rows.forEach(row => {
        checkEPPConsumptionDeviation(row.id);
    });
}

// Gestión de Turnos
export function populateTurnosDropdowns() {
    const turnoSelect = document.getElementById("new-supply-turno");
    const workerTurnoSelect = document.getElementById("outflow-worker-turno");

    if (turnoSelect) {
        const selectedVal = turnoSelect.value;
        turnoSelect.innerHTML = `<option value="" disabled ${!selectedVal ? "selected" : ""}>Seleccione turno...</option>`;
        dbTurnos.forEach(turno => {
            const option = document.createElement("option");
            option.value = turno;
            option.textContent = turno;
            if (turno === selectedVal) option.selected = true;
            turnoSelect.appendChild(option);
        });
    }

    if (workerTurnoSelect) {
        const selectedVal = workerTurnoSelect.value;
        workerTurnoSelect.innerHTML = `<option value="" disabled ${!selectedVal ? "selected" : ""}>Seleccione turno...</option>`;
        dbTurnos.forEach(turno => {
            const option = document.createElement("option");
            option.value = turno;
            option.textContent = turno;
            if (turno === selectedVal) option.selected = true;
            workerTurnoSelect.appendChild(option);
        });
    }
}

export function openTurnosModal() {
    const modal = document.getElementById("turnos-modal");
    if (modal) modal.classList.add("active");
    renderTurnosList();
}

export function closeTurnosModal() {
    const modal = document.getElementById("turnos-modal");
    if (modal) modal.classList.remove("active");
    const form = document.getElementById("add-turno-form");
    if (form) form.reset();
}

export function renderTurnosList() {
    const list = document.getElementById("turnos-list");
    if (!list) return;

    list.innerHTML = "";
    if (dbTurnos.length === 0) {
        list.innerHTML = `<li style="padding: 16px; text-align:center; color: var(--text-muted); font-size: 0.9rem;">No hay turnos registrados.</li>`;
        return;
    }

    dbTurnos.forEach(turno => {
        const li = document.createElement("li");
        li.className = "area-item"; // Reutilizar estilos de item
        li.innerHTML = `
            <span>${turno}</span>
            <button type="button" class="btn-delete-turno btn btn-sm btn-link" data-turno="${turno}" title="Eliminar Turno">
                <i class="fa-solid fa-trash-can text-danger"></i>
            </button>
        `;
        list.appendChild(li);
    });

    list.querySelectorAll(".btn-delete-turno").forEach(button => {
        button.addEventListener("click", () => {
            deleteTurno(button.dataset.turno);
        });
    });
}

export async function saveNewTurno(event) {
    event.preventDefault();
    const nameInput = document.getElementById("new-turno-name");
    if (!nameInput) return;
    const name = nameInput.value.trim();

    if (dbTurnos.some(t => t.toLowerCase() === name.toLowerCase())) {
        showToast(`El turno "${name}" ya existe.`, "warning");
        return;
    }

    try {
        showToast("Guardando turno en la nube...", "info");
        await dbInsertTurno(name);
        nameInput.value = "";
        renderTurnosList();
        populateTurnosDropdowns();
        showToast(`Turno "${name}" añadido con éxito.`, "success");
    } catch (e) {
        showToast("Error al guardar el turno: " + e.message, "danger");
    }
}

export async function deleteTurno(turnoName) {
    if (confirm(`¿Está seguro de eliminar el turno "${turnoName}"?`)) {
        try {
            showToast("Eliminando turno...", "info");
            await dbDeleteTurno(turnoName);
            renderTurnosList();
            populateTurnosDropdowns();
            showToast(`Turno "${turnoName}" eliminado con éxito.`, "success");
        } catch (e) {
            showToast("Error al eliminar el turno: " + e.message, "danger");
        }
    }
}
 
export function toggleOutflowMotivoFields(motivo) {
    const commentsInput = document.getElementById("outflow-comments");
    if (commentsInput) {
        commentsInput.required = false;
        if (motivo === "Desgaste" || motivo === "Pérdida") {
            commentsInput.placeholder = "Observaciones o detalles sobre el desgaste/pérdida (opcional)...";
        } else {
            commentsInput.placeholder = "Observaciones o notas adicionales de la entrega (opcional)...";
        }
    }
}
window.toggleOutflowMotivoFields = toggleOutflowMotivoFields;
 
export function cargarKitPorArea() {
    const areaName = document.getElementById("outflow-worker-area")?.value;
    if (!areaName) {
        showToast("Seleccione un área de trabajo primero.", "warning");
        return;
    }
 
    const areaObj = dbAreasFull.find(a => a.nombre === areaName);
    if (!areaObj || !areaObj.kit || areaObj.kit.length === 0) {
        showToast(`No hay un kit estándar configurado para el área "${areaName}". Puede configurarlo en el panel de Configuración.`, "info");
        return;
    }
 
    const container = document.getElementById("outflow-rows-container");
    if (container) container.innerHTML = "";
 
    areaObj.kit.forEach(item => {
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
                <input type="number" class="outflow-qty-input" min="1" value="${item.cantidad}" placeholder="0" required>
            </div>
            <button type="button" class="btn-remove btn btn-link" data-row-id="${rowId}" title="Eliminar fila">
                <i class="fa-solid fa-trash-can text-danger"></i>
            </button>
        `;
        container.appendChild(row);

        setupSmartEPPSelector(row, item.eppId);

        row.querySelector(".btn-remove").addEventListener("click", () => {
            removeOutflowRow(rowId);
        });

        checkEPPConsumptionDeviation(rowId);
    });
 
    checkSelectedCategories();
    showToast(`Kit de "${areaName}" cargado en el formulario.`, "success");
}
window.cargarKitPorArea = cargarKitPorArea;
 
window.showVoucherDetailsById = showVoucherDetailsById;
