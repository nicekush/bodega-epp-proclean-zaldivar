// ==========================================================================
// Módulo de Préstamos y Devoluciones de Equipos (loans.js)
// ==========================================================================

import { 
    dbInventario, 
    dbEquiposSeriales, 
    dbPrestamos, 
    dbInsertPrestamo, 
    dbRetornarPrestamo, 
    dbUpdateEquipoEstado,
    dbSalidas
} from './db.js';
import { showToast } from './utils.js';
import { currentUser } from './auth.js';
import { isEquipmentFitForLoan, getCalibrationStatus } from './calibration.js';

let canvas = null;
let ctx = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let listenersAttached = false;

export function initLoans() {
    canvas = document.getElementById("loan-signature-pad");
    if (canvas) {
        ctx = canvas.getContext("2d");
        setupCanvasListeners();
    }
    
    populateLoanProductSelect();
    setupNightShiftDefault();
    renderLoansTable();
    updateLoanStats();
}

function setupCanvasListeners() {
    if (listenersAttached) return;
    
    // Mouse listeners
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

    // Touch listeners
    canvas.addEventListener("touchstart", (e) => {
        if (e.target === canvas) e.preventDefault();
        isDrawing = true;
        const touch = e.touches[0];
        [lastX, lastY] = getCoordinates(touch);
    }, { passive: false });

    canvas.addEventListener("touchmove", (e) => {
        if (e.target === canvas) e.preventDefault();
        if (!isDrawing) return;
        const touch = e.touches[0];
        draw(touch);
    }, { passive: false });

    canvas.addEventListener("touchend", () => isDrawing = false);
    listenersAttached = true;
}

function getCoordinates(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX || e.touches?.[0]?.clientX;
    const clientY = e.clientY || e.touches?.[0]?.clientY;
    return [
        (clientX - rect.left) * (canvas.width / rect.width),
        (clientY - rect.top) * (canvas.height / rect.height)
    ];
}

function draw(e) {
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    const [x, y] = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = "var(--slate-800, #0f172a)";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.stroke();
    [lastX, lastY] = [x, y];
}

export function clearLoanSignature() {
    if (!ctx || !canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
window.clearLoanSignature = clearLoanSignature;

function isCanvasBlank() {
    if (!canvas) return true;
    const buffer = new Uint32Array(ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer);
    return !buffer.some(color => color !== 0);
}

// Autocomplete RUT en Préstamos
export function onLoanRutInput(val) {
    const suggContainer = document.getElementById("loan-rut-suggestions");
    if (!suggContainer) return;
    suggContainer.innerHTML = "";
    
    if (!val || val.length < 3) {
        suggContainer.style.display = "none";
        return;
    }

    // Buscar en salidas previas (trabajadores existentes)
    const uniqueWorkers = [];
    const seen = new Set();
    dbSalidas.forEach(s => {
        if (s.rut && s.trabajador && !seen.has(s.rut)) {
            seen.add(s.rut);
            uniqueWorkers.push({ rut: s.rut, nombre: s.trabajador, area: s.area, turno: s.turno });
        }
    });

    const matches = uniqueWorkers.filter(w => 
        w.rut.toLowerCase().includes(val.toLowerCase()) || 
        w.nombre.toLowerCase().includes(val.toLowerCase())
    ).slice(0, 5);

    if (matches.length === 0) {
        suggContainer.style.display = "none";
        return;
    }

    matches.forEach(w => {
        const div = document.createElement("div");
        div.className = "suggestion-item";
        div.style.padding = "8px 12px";
        div.style.cursor = "pointer";
        div.style.borderBottom = "1px solid var(--border-color)";
        div.innerHTML = `<strong>${w.nombre}</strong> <span style="font-size:0.75rem; color:var(--text-muted);">(${w.rut})</span>`;
        div.addEventListener("click", () => {
            document.getElementById("loan-rut").value = w.rut;
            document.getElementById("loan-worker-name").value = w.nombre;
            document.getElementById("loan-area").value = w.area || "Sin Área";
            document.getElementById("loan-turno").value = w.turno || "Sin Turno";
            suggContainer.style.display = "none";
            checkActiveLoansWarning(w.rut);
        });
        suggContainer.appendChild(div);
    });
    suggContainer.style.display = "block";
}
window.onLoanRutInput = onLoanRutInput;

// Alerta de préstamos activos
function checkActiveLoansWarning(rut) {
    const active = dbPrestamos.filter(p => p.trabajador_rut === rut && p.fecha_retorno === null);
    if (active.length > 0) {
        const itemNames = active.map(p => p.items.map(it => it.nombre + (it.numero_serie ? ` [${it.numero_serie}]` : "")).join(", ")).join("; ");
        showToast(`Alerta: Este colaborador tiene préstamos sin devolver: ${itemNames}`, "warning");
    }
}

export function setupSmartLoanProductSelector() {
    const container = document.getElementById("loan-product-search-container");
    if (!container) return;

    const searchInput = document.getElementById("loan-product-search-input");
    const hiddenSelect = document.getElementById("loan-product-select");
    const dropdown = document.getElementById("loan-product-search-dropdown");
    const clearBtn = document.getElementById("loan-product-clear-icon");

    if (!searchInput || !hiddenSelect || !dropdown) return;

    // Productos filtrados por tipo_control === 'Préstamo'
    const loanProducts = dbInventario.filter(p => p.tipo_control === 'Préstamo');

    function renderDropdown(filterText = "") {
        const query = filterText.toLowerCase().trim();
        const matches = loanProducts.filter(item => {
            const codeMatch = (item.codigo || "").toLowerCase().includes(query);
            const nameMatch = (item.nombre || "").toLowerCase().includes(query);
            const catMatch = (item.categoria || "").toLowerCase().includes(query);
            return codeMatch || nameMatch || catMatch;
        });

        if (matches.length === 0) {
            dropdown.innerHTML = `<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">No hay equipos en préstamo coincidentes.</div>`;
        } else {
            dropdown.innerHTML = matches.map(item => {
                const badgeClass = item.stock <= 0 ? "stock-badge-zero" : "stock-badge-ok";
                const badgeText = item.stock <= 0 ? "Sin Stock" : `Disponible: ${item.stock}`;
                return `
                    <div class="epp-search-option" data-id="${item.id}">
                        <div class="epp-search-option-info">
                            <span class="epp-search-option-code">${item.codigo || 'S/C'}</span>
                            <span class="epp-search-option-title">${item.nombre}</span>
                            <span class="epp-search-option-category"><i class="fa-solid fa-toolbox"></i> ${item.categoria || 'Equipo/Herramienta'}</span>
                        </div>
                        <span class="epp-search-option-stock ${badgeClass}">${badgeText}</span>
                    </div>
                `;
            }).join("");

            dropdown.querySelectorAll(".epp-search-option").forEach(opt => {
                opt.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const productId = opt.dataset.id;
                    const item = loanProducts.find(i => i.id === productId);
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
        const parentCard = container.closest('.card');
        if (parentCard) parentCard.classList.add("has-active-dropdown");
    }

    function closeDropdown() {
        dropdown.classList.remove("active");
        const parentCard = container.closest('.card');
        if (parentCard) parentCard.classList.remove("has-active-dropdown");
    }

    function selectItem(item) {
        hiddenSelect.value = item.id;
        searchInput.value = `${item.codigo ? item.codigo + ' - ' : ''}${item.nombre}`;
        if (clearBtn) clearBtn.style.display = "block";
        closeDropdown();
        onLoanProductSelectChange(item.id);
    }

    function clearSelection() {
        hiddenSelect.value = "";
        searchInput.value = "";
        if (clearBtn) clearBtn.style.display = "none";
        closeDropdown();
        onLoanProductSelectChange("");
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

// Cargar selectores de productos tipo préstamo
export function populateLoanProductSelect() {
    setupSmartLoanProductSelector();
    const hiddenSelect = document.getElementById("loan-product-select");
    const searchInput = document.getElementById("loan-product-search-input");
    const clearBtn = document.getElementById("loan-product-clear-icon");
    if (hiddenSelect) hiddenSelect.value = "";
    if (searchInput) searchInput.value = "";
    if (clearBtn) clearBtn.style.display = "none";
    const serialGroup = document.getElementById("loan-serial-group");
    if (serialGroup) serialGroup.style.display = "none";
}

export function onLoanProductSelectChange(productId) {
    const serialGroup = document.getElementById("loan-serial-group");
    const serialSelect = document.getElementById("loan-serial-select");
    if (!serialGroup || !serialSelect) return;

    // Buscar si este producto tiene números de serie
    const serials = dbEquiposSeriales.filter(s => s.producto_id === productId && s.estado === 'Disponible');
    
    if (serials.length > 0) {
        serialSelect.innerHTML = serials.map(s => {
            const { faenaOk, proveedorOk } = getCalibrationStatus(s.numero_serie);
            const calibText = (faenaOk && proveedorOk) ? "Calibrado" : "Calibración Vencida";
            const disabledAttr = (faenaOk && proveedorOk) ? "" : "disabled";
            return `<option value="${s.numero_serie}" ${disabledAttr}>${s.numero_serie} (${calibText})</option>`;
        }).join("");
        serialGroup.style.display = "block";
    } else {
        serialSelect.innerHTML = "";
        serialGroup.style.display = "none";
    }
}
window.onLoanProductSelectChange = onLoanProductSelectChange;

// Guardar Préstamo
export async function handleCreateLoan(e) {
    e.preventDefault();
    
    const rut = document.getElementById("loan-rut").value.trim();
    const nombre = document.getElementById("loan-worker-name").value.trim();
    const area = document.getElementById("loan-area").value.trim();
    const turno = document.getElementById("loan-turno").value.trim();
    const productId = document.getElementById("loan-product-select").value;
    const serialSelect = document.getElementById("loan-serial-select");
    const serial = serialSelect && serialSelect.offsetParent !== null ? serialSelect.value : null;

    if (!rut || !productId) {
        showToast("Complete los campos obligatorios.", "error");
        return;
    }

    if (isCanvasBlank()) {
        showToast("Se requiere la firma del colaborador.", "error");
        return;
    }

    // Si requiere serial y no hay seleccionado
    if (serialSelect && serialSelect.offsetParent !== null && !serial) {
        showToast("No hay número de serie disponible o calibrado seleccionado.", "error");
        return;
    }

    // Verificar calibración si corresponde
    if (serial) {
        const { faenaOk, proveedorOk, errorFaena, errorProveedor } = getCalibrationStatus(serial);
        if (!faenaOk || !proveedorOk) {
            showToast(`No se puede prestar: calibración vencida. ${errorFaena || errorProveedor}`, "error");
            return;
        }
    }

    const itemObj = dbInventario.find(p => p.id === productId);
    const signatureBase64 = canvas.toDataURL("image/png");

    const payload = {
        trabajador_rut: rut,
        trabajador_nombre: nombre || "Colaborador Nuevo",
        area: area || "Sin Área",
        turno: turno || "Sin Turno",
        firma_salida: signatureBase64,
        fecha_salida: new Date().toISOString(),
        items: [{
            eppId: productId,
            nombre: itemObj.nombre,
            numero_serie: serial
        }]
    };

    try {
        await dbInsertPrestamo(payload);
        showToast("Préstamo registrado exitosamente.", "success");
        
        // Limpiar form
        document.getElementById("loan-form").reset();
        clearLoanSignature();
        document.getElementById("loan-serial-group").style.display = "none";
        
        // Recargar
        renderLoansTable();
        updateLoanStats();
    } catch (err) {
        console.error(err);
        showToast("Fallo al guardar el préstamo.", "error");
    }
}
window.handleCreateLoan = handleCreateLoan;

// Retorno de Préstamos
export async function returnLoan(loanId, estado, observaciones) {
    const payload = {
        fecha_retorno: new Date().toISOString(),
        recibido_por_rut: currentUser?.rut || "N/A",
        recibido_por_nombre: currentUser?.nombre || "Sistema",
        estado_retorno: estado,
        observaciones_retorno: observaciones || ""
    };

    try {
        await dbRetornarPrestamo(loanId, payload);
        showToast(`Equipo retornado como: ${estado}`, "success");
        renderLoansTable();
        updateLoanStats();
    } catch (err) {
        console.error(err);
        showToast("Error al procesar el retorno.", "error");
    }
}
window.returnLoan = returnLoan;

// Popup para Devolución Rápida
export function openReturnDialog(loanId) {
    let overlay = document.getElementById("return-dialog-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "return-dialog-overlay";
        overlay.className = "modal-overlay";
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 400px; padding: 20px;">
                <h3 style="margin-bottom:12px;">Registrar Devolución</h3>
                <div class="form-group">
                    <label for="return-state">Estado del Equipo</label>
                    <select id="return-state" class="filter-select" style="width:100%;">
                        <option value="Operativo">Operativo (Vuelve a Stock)</option>
                        <option value="Dañado">Dañado / En Reparación</option>
                    </select>
                </div>
                <div class="form-group" style="margin-top:12px;">
                    <label for="return-obs">Observaciones</label>
                    <input type="text" id="return-obs" placeholder="Ej. Pantalla sucia, batería baja..." style="width:100%;">
                </div>
                <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:10px;">
                    <button class="btn btn-secondary" onclick="document.getElementById('return-dialog-overlay').classList.remove('active')">Cancelar</button>
                    <button class="btn btn-primary" id="btn-confirm-return">Confirmar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    
    document.getElementById("return-obs").value = "";
    document.getElementById("return-state").value = "Operativo";
    
    const confirmBtn = document.getElementById("btn-confirm-return");
    confirmBtn.onclick = function() {
        const state = document.getElementById("return-state").value;
        const obs = document.getElementById("return-obs").value;
        overlay.classList.remove("active");
        returnLoan(loanId, state, obs);
    };
    
    overlay.classList.add("active");
}
window.openReturnDialog = openReturnDialog;

// Renderizar tabla
export function renderLoansTable() {
    const tbody = document.getElementById("loans-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    const activeLoans = dbPrestamos.filter(p => p.fecha_retorno === null);
    
    if (activeLoans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No hay préstamos activos en faena.</td></tr>`;
        return;
    }

    activeLoans.forEach(p => {
        const itemText = p.items.map(it => `${it.nombre} ${it.numero_serie ? `[${it.numero_serie}]` : ""}`).join("<br>");
        const fSalida = new Date(p.fecha_salida);
        const diffHrs = Math.floor((new Date() - fSalida) / (1000 * 60 * 60));
        
        let isOverdue = false;
        let limitText = "Fin de Jornada (12 hrs)";
        let isWarning = false;
 
        const firstItem = p.items[0];
        const eppDef = dbInventario.find(i => i.id === firstItem?.eppId);
        const plazo = eppDef?.plazo_retorno || "12h";
 
        if (plazo === "7d") {
            limitText = "Fin de Turno (7 días)";
            const diffDays = Math.floor(diffHrs / 24);
            if (diffDays >= 7) {
                isOverdue = true;
            } else if (diffDays >= 6) {
                isWarning = true;
            }
        } else {
            if (diffHrs >= 12) {
                isOverdue = true;
            } else if (diffHrs >= 10) {
                isWarning = true;
            }
        }
 
        let ageBadge = `<span class="badge badge-success"><i class="fa-solid fa-clock"></i> ${diffHrs} hrs</span>`;
        if (isOverdue) {
            ageBadge = `<span class="badge badge-danger"><i class="fa-solid fa-circle-exclamation"></i> Atrasado (> ${limitText})</span>`;
        } else if (isWarning) {
            ageBadge = `<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Por vencer</span>`;
        }

        const tr = document.createElement("tr");
        tr.dataset.loanId = p.id;
        tr.innerHTML = `
            <td>
                <div style="font-weight:600;">${p.trabajador_nombre}</div>
                <div style="font-size:0.75rem; color:var(--text-muted);">RUT: ${p.trabajador_rut}</div>
            </td>
            <td>
                <div>${p.area}</div>
                <div style="font-size:0.75rem; font-weight:700; color:var(--color-primary);">${p.turno}</div>
            </td>
            <td style="font-size:0.82rem; font-weight:600;">${itemText}</td>
            <td style="font-size:0.8rem;">${fSalida.toLocaleTimeString('es-CL')} <br> ${fSalida.toLocaleDateString('es-CL')}</td>
            <td>${ageBadge}</td>
            <td style="text-align: center;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="openReturnDialog('${p.id}')">
                    <i class="fa-solid fa-rotate-left"></i> Devolver
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Filtrar tabla
export function filterLoansTable() {
    const q = document.getElementById("loan-search").value.toLowerCase();
    const filterNight = document.getElementById("loan-filter-night").checked;
    const rows = document.querySelectorAll("#loans-tbody tr");
    
    rows.forEach(tr => {
        const loanId = tr.dataset.loanId;
        if (!loanId) return;
        const p = dbPrestamos.find(l => l.id === loanId);
        if (!p) return;
        
        let matchText = p.trabajador_nombre.toLowerCase().includes(q) || 
                        p.trabajador_rut.toLowerCase().includes(q) ||
                        p.items.some(it => it.numero_serie && it.numero_serie.toLowerCase().includes(q));
        
        let matchNight = true;
        if (filterNight) {
            // El turno noche puede ser literal por el campo 'turno'
            matchNight = p.turno.toLowerCase().includes("noche") || p.turno === "Turno B"; // Asumiendo B como noche o noche explícito
        }

        if (matchText && matchNight) {
            tr.style.display = "";
        } else {
            tr.style.display = "none";
        }
    });
}
window.filterLoansTable = filterLoansTable;

// Configurar Turno Noche por defecto según hora
function setupNightShiftDefault() {
    const hr = new Date().getHours();
    const chk = document.getElementById("loan-filter-night");
    if (chk) {
        // Noche entre 20:00 (8 PM) y 08:00 (8 AM)
        if (hr >= 20 || hr < 8) {
            chk.checked = true;
        } else {
            chk.checked = false;
        }
    }
}

// Actualizar contadores del dashboard
export function updateLoanStats() {
    const statActive = document.getElementById("loan-stat-active");
    const statOverdue = document.getElementById("loan-stat-overdue");
    const statReturned = document.getElementById("loan-stat-returned");
    
    if (!statActive || !statOverdue || !statReturned) return;

    const activeLoans = dbPrestamos.filter(p => p.fecha_retorno === null);
    statActive.textContent = activeLoans.length;

    // Calcular atrasados
    const overdueCount = activeLoans.filter(p => {
        const diffHrs = (new Date() - new Date(p.fecha_salida)) / (1000 * 60 * 60);
        const firstItem = p.items[0];
        const eppDef = dbInventario.find(i => i.id === firstItem?.eppId);
        const plazo = eppDef?.plazo_retorno || "12h";
        
        if (plazo === "7d") {
            return diffHrs >= 168; // 7 días = 168 horas
        }
        return diffHrs >= 12;
    }).length;
    statOverdue.textContent = overdueCount;

    // Devueltos hoy
    const startOfToday = new Date();
    startOfToday.setHours(0,0,0,0);
    const returnedToday = dbPrestamos.filter(p => p.fecha_retorno !== null && new Date(p.fecha_retorno) >= startOfToday).length;
    statReturned.textContent = returnedToday;
}
