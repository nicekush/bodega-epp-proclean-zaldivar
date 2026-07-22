// ==========================================================================
// Módulo de Configuración y Ajustes Administrativos (settings.js)
// ==========================================================================

import { 
    dbAreasFull, 
    dbInventario, 
    dbEquiposSeriales, 
    dbSaveAreaKit, 
    dbInsertEquipOSerial,
    dbUpdateCalibracion,
    dbUpdateEPPStock,
    dbInsertInflow
} from './db.js';
import { showToast, showConfirmDialog } from './utils.js';
import { currentUser } from './auth.js';
import { getCalibrationStatus } from './calibration.js';

let localKitItems = [];

// ==========================================================================
// 1. Plantillas de EPP por Área (Kits)
// ==========================================================================

export function initSettingsView() {
    populateSettingsDropdowns();
    renderSerialsTable();
}
window.initSettingsView = initSettingsView;

function populateSettingsDropdowns() {
    const areaSelect = document.getElementById("kit-area-select");
    const eppSelect = document.getElementById("kit-epp-select");
    const serialProductSelect = document.getElementById("new-serial-product");
    
    if (areaSelect) {
        areaSelect.innerHTML = `<option value="" disabled selected>Seleccione área...</option>` + 
            dbAreasFull.map(a => `<option value="${a.nombre}">${a.nombre}</option>`).join("");
    }
    
    if (eppSelect) {
        eppSelect.innerHTML = `<option value="" disabled selected>Seleccione EPP...</option>` + 
            dbInventario.filter(i => i.tipo_control !== 'Préstamo')
                .map(i => `<option value="${i.id}">${i.nombre}</option>`).join("");
    }

    if (serialProductSelect) {
        serialProductSelect.innerHTML = `<option value="" disabled selected>Seleccione...</option>` + 
            dbInventario.filter(i => i.tipo_control === 'Préstamo')
                .map(i => `<option value="${i.id}">${i.nombre}</option>`).join("");
    }
}

export function onKitAreaChange() {
    const areaName = document.getElementById("kit-area-select").value;
    const areaObj = dbAreasFull.find(a => a.nombre === areaName);
    
    localKitItems = areaObj && areaObj.kit ? [...areaObj.kit] : [];
    renderKitItemsTable();
}
window.onKitAreaChange = onKitAreaChange;

function renderKitItemsTable() {
    const tbody = document.getElementById("kit-items-tbody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    if (localKitItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No hay EPPs en esta plantilla.</td></tr>`;
        return;
    }

    localKitItems.forEach((item, idx) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${item.codigo || item.eppId.substring(0,8)}</strong></td>
            <td>${item.nombre}</td>
            <td style="text-align: center; font-weight:bold;">${item.cantidad}</td>
            <td style="text-align: center;">
                <button type="button" class="btn btn-danger-outline btn-sm" onclick="removeEPPFromKit(${idx})">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

export function addEPPToKit() {
    const areaName = document.getElementById("kit-area-select").value;
    const eppId = document.getElementById("kit-epp-select").value;
    const qty = Number(document.getElementById("kit-qty-input").value);

    if (!areaName) {
        showToast("Seleccione un área de trabajo primero.", "warning");
        return;
    }
    if (!eppId) {
        showToast("Seleccione un artículo de EPP.", "warning");
        return;
    }
    if (!qty || qty <= 0) {
        showToast("Cantidad debe ser mayor a cero.", "warning");
        return;
    }

    const epp = dbInventario.find(i => i.id === eppId);
    if (!epp) return;

    // Verificar si ya existe
    if (localKitItems.some(i => i.eppId === eppId)) {
        showToast("Este EPP ya está agregado al kit. Modifíquelo o elimínelo primero.", "warning");
        return;
    }

    localKitItems.push({
        eppId: eppId,
        codigo: epp.codigo,
        nombre: epp.nombre,
        cantidad: qty
    });

    renderKitItemsTable();
    document.getElementById("kit-epp-select").value = "";
    document.getElementById("kit-qty-input").value = "1";
}
window.addEPPToKit = addEPPToKit;

export function removeEPPFromKit(idx) {
    localKitItems.splice(idx, 1);
    renderKitItemsTable();
}
window.removeEPPFromKit = removeEPPFromKit;

export async function saveAreaKit() {
    const areaName = document.getElementById("kit-area-select").value;
    if (!areaName) {
        showToast("Seleccione un área primero.", "warning");
        return;
    }

    try {
        showToast("Guardando kit en Supabase...", "info");
        await dbSaveAreaKit(areaName, localKitItems);
        showToast(`Plantilla de kit para "${areaName}" guardada correctamente.`, "success");
    } catch (e) {
        console.error(e);
        showToast("Error al guardar la plantilla de kit.", "error");
    }
}
window.saveAreaKit = saveAreaKit;


// ==========================================================================
// 2. Registro y Calibración de Series de Equipos
// ==========================================================================

export async function handleRegisterSerial(e) {
    e.preventDefault();
    const productId = document.getElementById("new-serial-product").value;
    const serialNum = document.getElementById("new-serial-number").value.trim();
    const calFaena = document.getElementById("new-serial-cal-faena").value;
    const calProv = document.getElementById("new-serial-cal-proveedor").value;

    if (!productId || !serialNum) {
        showToast("Producto y Serie son obligatorios.", "error");
        return;
    }

    // Verificar si ya existe el serial
    if (dbEquiposSeriales.some(s => s.numero_serie.toLowerCase() === serialNum.toLowerCase())) {
        showToast(`El número de serie "${serialNum}" ya se encuentra registrado.`, "error");
        return;
    }

    const payload = {
        producto_id: productId,
        numero_serie: serialNum,
        estado: 'Disponible',
        calibracion_faena: calFaena || null,
        calibracion_proveedor: calProv || null
    };

    try {
        showToast("Registrando serie en Supabase...", "info");
        await dbInsertEquipOSerial(payload);
        showToast(`Número de serie "${serialNum}" registrado con éxito.`, "success");
        
        document.getElementById("create-serial-form").reset();
        renderSerialsTable();
    } catch (err) {
        console.error(err);
        showToast("Error al registrar la serie del equipo.", "error");
    }
}
window.handleRegisterSerial = handleRegisterSerial;

export function renderSerialsTable() {
    const tbody = document.getElementById("serials-tbody");
    if (!tbody) return;
    
    tbody.innerHTML = "";
    if (dbEquiposSeriales.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No hay equipos serializados registrados.</td></tr>`;
        return;
    }

    dbEquiposSeriales.forEach(s => {
        const prod = dbInventario.find(i => i.id === s.producto_id);
        const prodName = prod ? prod.nombre : "Producto Desconocido";
        
        const { faenaOk, proveedorOk, errorFaena, errorProveedor } = getCalibrationStatus(s.numero_serie);
        
        let stateBadge = `<span class="badge badge-success">Disponible</span>`;
        if (s.estado === 'Prestado') {
            stateBadge = `<span class="badge badge-warning">Prestado</span>`;
        } else if (s.estado === 'Dañado') {
            stateBadge = `<span class="badge badge-danger">Dañado</span>`;
        }

        const faenaText = s.calibracion_faena ? new Date(s.calibracion_faena).toLocaleDateString('es-CL') : "No registra";
        const provText = s.calibracion_proveedor ? new Date(s.calibracion_proveedor).toLocaleDateString('es-CL') : "No registra";

        const calFaenaHTML = faenaOk 
            ? `<span class="text-success">${faenaText}</span>` 
            : `<span class="text-danger" title="${errorFaena}"><i class="fa-solid fa-triangle-exclamation"></i> Vencida</span>`;
            
        const calProvHTML = proveedorOk 
            ? `<span class="text-success">${provText}</span>` 
            : `<span class="text-danger" title="${errorProveedor}"><i class="fa-solid fa-triangle-exclamation"></i> Vencida</span>`;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${prodName}</strong></td>
            <td><code>${s.numero_serie}</code></td>
            <td>${stateBadge}</td>
            <td>${calFaenaHTML}</td>
            <td>${calProvHTML}</td>
            <td style="text-align: center;">
                <button type="button" class="btn btn-secondary btn-sm" onclick="openUpdateCalibrationDialog('${s.numero_serie}')" title="Actualizar Calibración">
                    <i class="fa-solid fa-screwdriver-wrench"></i> Calibrar
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

export function openUpdateCalibrationDialog(serial) {
    let overlay = document.getElementById("calib-dialog-overlay");
    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "calib-dialog-overlay";
        overlay.className = "modal-overlay";
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 400px; padding: 20px;">
                <h3 style="margin-bottom:12px;">Actualizar Calibraciones</h3>
                <h4 id="calib-dialog-serial" style="margin-bottom:16px; font-family:monospace;"></h4>
                <div class="form-group">
                    <label for="calib-faena-date">Nueva Calibración Faena (Mensual)</label>
                    <input type="date" id="calib-faena-date" style="width:100%;">
                </div>
                <div class="form-group" style="margin-top:12px;">
                    <label for="calib-prov-date">Nueva Calibración Proveedor (Trimestral)</label>
                    <input type="date" id="calib-prov-date" style="width:100%;">
                </div>
                <div style="margin-top:20px; display:flex; justify-content:flex-end; gap:10px;">
                    <button class="btn btn-secondary" onclick="document.getElementById('calib-dialog-overlay').classList.remove('active')">Cancelar</button>
                    <button class="btn btn-primary" id="btn-confirm-calib">Guardar</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }
    
    document.getElementById("calib-dialog-serial").textContent = `Equipo: ${serial}`;
    
    const eq = dbEquiposSeriales.find(e => e.numero_serie === serial);
    document.getElementById("calib-faena-date").value = eq?.calibracion_faena || "";
    document.getElementById("calib-prov-date").value = eq?.calibracion_proveedor || "";
    
    const confirmBtn = document.getElementById("btn-confirm-calib");
    confirmBtn.onclick = async function() {
        const faena = document.getElementById("calib-faena-date").value;
        const prov = document.getElementById("calib-prov-date").value;
        overlay.classList.remove("active");
        
        try {
            await dbUpdateCalibracion(serial, faena || null, prov || null);
            showToast("Fechas de calibración actualizadas.", "success");
            renderSerialsTable();
        } catch (e) {
            showToast("Error al guardar calibración.", "error");
        }
    };
    
    overlay.classList.add("active");
}
window.openUpdateCalibrationDialog = openUpdateCalibrationDialog;


// ==========================================================================
// 3. Martes de Bajada (Conciliación Semanal de Stock)
// ==========================================================================

export function startReconciliation() {
    const container = document.getElementById("reconciliation-assistant-container");
    if (!container) return;

    // Renderizar la tabla de conteo físico para todos los consumibles
    const items = dbInventario.filter(i => i.tipo_control !== 'Préstamo');
    
    let tableRowsHTML = items.map((item, idx) => `
        <tr data-epp-id="${item.id}">
            <td><strong>${item.codigo}</strong></td>
            <td>${item.nombre}</td>
            <td style="text-align: center; font-weight:bold;">${item.stock}</td>
            <td style="text-align: center; width: 120px;">
                <input type="number" class="phys-stock-input" min="0" value="${item.stock}" style="width: 80px; text-align: center; font-weight: bold;" oninput="calculateDifference('${item.id}', ${item.stock}, this.value)">
            </td>
            <td style="text-align: center; font-weight: bold;" class="diff-stock-lbl">0</td>
            <td>
                <input type="text" class="reconcile-notes-input" placeholder="Opcional..." style="width: 100%; font-size: 0.8rem; height: 32px;">
            </td>
        </tr>
    `).join("");

    container.innerHTML = `
        <div class="table-responsive" style="margin-bottom: 20px;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Código</th>
                        <th>Artículo EPP</th>
                        <th style="text-align: center;">Stock Sistema</th>
                        <th style="text-align: center;">Físico Contado</th>
                        <th style="text-align: center;">Diferencia</th>
                        <th>Observación / Notas</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRowsHTML}
                </tbody>
            </table>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:12px;">
            <button class="btn btn-secondary" onclick="cancelReconciliation()">Cancelar</button>
            <button class="btn btn-primary" onclick="saveReconciliation()">
                <i class="fa-solid fa-clipboard-check"></i> Finalizar y Ajustar Stock
            </button>
        </div>
    `;
}
window.startReconciliation = startReconciliation;

export function calculateDifference(eppId, sysStock, physStockVal) {
    const physStock = physStockVal === "" ? 0 : Number(physStockVal);
    const diff = physStock - sysStock;
    
    const row = document.querySelector(`tr[data-epp-id="${eppId}"]`);
    if (row) {
        const diffLbl = row.querySelector(".diff-stock-lbl");
        diffLbl.textContent = diff > 0 ? `+${diff}` : diff;
        
        if (diff < 0) {
            diffLbl.style.color = "var(--color-danger, #f43f5e)";
        } else if (diff > 0) {
            diffLbl.style.color = "var(--emerald, #10b981)";
        } else {
            diffLbl.style.color = "inherit";
        }
    }
}
window.calculateDifference = calculateDifference;

export function cancelReconciliation() {
    const container = document.getElementById("reconciliation-assistant-container");
    if (container) {
        container.innerHTML = `
            <div style="background-color: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.15); padding: 15px; border-radius: var(--radius-md); margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; gap: 15px;">
                <div>
                    <strong style="color: var(--emerald); display: block; margin-bottom: 4px; font-size: 0.95rem;">Asistente de Conciliación Semanal</strong>
                    <span style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; display: block;">Inicie el proceso de bajada de inventario guiado para comparar y cuadrar el stock del sistema contra el conteo físico de bodega.</span>
                </div>
                <button type="button" class="btn btn-primary" onclick="startReconciliation()" style="flex-shrink:0;">
                    <i class="fa-solid fa-play"></i> Iniciar Bajada
                </button>
            </div>
        `;
    }
}
window.cancelReconciliation = cancelReconciliation;

export async function saveReconciliation() {
    const rows = document.querySelectorAll("#reconciliation-assistant-container tbody tr");
    const adjustments = [];
    
    rows.forEach(tr => {
        const eppId = tr.dataset.eppId;
        const physInput = tr.querySelector(".phys-stock-input");
        const notesInput = tr.querySelector(".reconcile-notes-input");
        
        if (eppId && physInput) {
            const epp = dbInventario.find(i => i.id === eppId);
            const sysStock = epp ? epp.stock : 0;
            const physStock = Number(physInput.value);
            const diff = physStock - sysStock;
            const note = notesInput.value.trim();
            
            if (diff !== 0) {
                adjustments.push({ eppId, sysStock, physStock, diff, note });
            }
        }
    });

    if (adjustments.length === 0) {
        showToast("Sin diferencias detectadas. El stock se encuentra cuadradro.", "success");
        cancelReconciliation();
        return;
    }

    const confirmSave = await showConfirmDialog(
        "Guardar Conciliación",
        `Se registrarán mermas/ajustes para ${adjustments.length} artículos. Esto modificará permanentemente el stock. ¿Desea continuar?`
    );
    if (!confirmSave) return;

    try {
        showToast("Aplicando ajustes de stock...", "info");
        const inflowItems = [];
        
        for (const adj of adjustments) {
            // Actualizar stock de inventario base
            await dbUpdateEPPStock(adj.eppId, adj.physStock);
            
            const epp = dbInventario.find(i => i.id === adj.eppId);
            if (epp) {
                inflowItems.push({
                    eppId: adj.eppId,
                    nombre: epp.nombre,
                    cantidad: adj.diff // Puede ser positivo o negativo
                });
            }
        }

        // Registrar en ingresos como guía de cuadratura semanal
        await dbInsertInflow({
            factura: "CUADRA-" + Date.now().toString().substring(8),
            proveedor: "Ajuste de Inventario (Martes de Bajada)",
            fecha: new Date().toISOString(),
            items: inflowItems.filter(i => i.cantidad > 0), // Solo los incrementos si aplica, o documentar notas
            comentarios: "Ajustes de cuadratura semanal: \n" + adjustments.map(a => `${dbInventario.find(i => i.id === a.eppId)?.nombre}: Dif: ${a.diff} (Físico: ${a.physStock}). Obs: ${a.note}`).join("\n"),
            registrado_por: currentUser?.nombre || "Administrador"
        });

        showToast("Conciliación de inventario procesada y guardada.", "success");
        cancelReconciliation();
    } catch (e) {
        console.error(e);
        showToast("Error al guardar ajustes de conciliación.", "error");
    }
}
window.saveReconciliation = saveReconciliation;
