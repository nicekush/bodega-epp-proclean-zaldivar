// ==========================================================================
// Módulo de Conciliación Semanal de Stock (Martes de Bajada)
// ==========================================================================

import { dbInventario, dbUpdateEPPStock, dbInsertInflow } from './db.js';
import { showToast, showConfirmDialog } from './utils.js';
import { currentUser } from './auth.js';

// Estado en memoria para la conciliación activa
let reconciliationData = [];
let reconciliationFilterChip = 'all'; // 'all', 'diff', 'equal'
let reconciliationSearchQuery = '';
let reconciliationSortCol = 'codigo';
let reconciliationSortDir = 'asc'; // 'asc' or 'desc'

// Firma Canvas
let signatureCanvas = null;
let signatureCtx = null;
let isSigning = false;

/**
 * Inicializa la vista de conciliación al ingresar a Historial y Reportes
 */
export function initReconciliationView() {
    checkDraftAvailability();
    loadReconciliationHistory();

    // Iniciar automáticamente si no hay datos cargados en sesión
    if (!reconciliationData || reconciliationData.length === 0) {
        startReconciliation();
    }
}

/**
 * Cambia entre las pestañas "Conciliación Activa" e "Historial de Bajadas"
 */
export function toggleReconciliationHistoryTab(tab) {
    const activePanel = document.getElementById("reconciliation-active-panel");
    const historyPanel = document.getElementById("reconciliation-history-panel");
    const btnActive = document.getElementById("tab-reconcile-active");
    const btnHistory = document.getElementById("tab-reconcile-history");

    if (!activePanel || !historyPanel) return;

    if (tab === 'history') {
        activePanel.style.display = "none";
        historyPanel.style.display = "block";
        if (btnActive) {
            btnActive.classList.remove("btn-primary");
            btnActive.classList.add("btn-secondary");
        }
        if (btnHistory) {
            btnHistory.classList.remove("btn-secondary");
            btnHistory.classList.add("btn-primary");
        }
        loadReconciliationHistory();
    } else {
        activePanel.style.display = "block";
        historyPanel.style.display = "none";
        if (btnActive) {
            btnActive.classList.remove("btn-secondary");
            btnActive.classList.add("btn-primary");
        }
        if (btnHistory) {
            btnHistory.classList.remove("btn-primary");
            btnHistory.classList.add("btn-secondary");
        }
        if (!reconciliationData || reconciliationData.length === 0) {
            startReconciliation();
        }
    }
}

/**
 * Verifica si hay un borrador guardado en localStorage y muestra u oculta el botón de restauración
 */
export function checkDraftAvailability() {
    const btnRestore = document.getElementById("btn-restore-draft");
    if (!btnRestore) return;

    const savedDraft = localStorage.getItem("bajada_draft_v1");
    if (savedDraft) {
        btnRestore.style.display = "inline-flex";
    } else {
        btnRestore.style.display = "none";
    }
}

/**
 * Inicia el proceso de bajada de inventario (guiado)
 */
export function startReconciliation(restoredData = null) {
    const wrapper = document.getElementById("reconciliation-process-wrapper");
    if (wrapper) wrapper.style.display = "block";

    if (restoredData && Array.isArray(restoredData) && restoredData.length > 0) {
        reconciliationData = restoredData;
        showToast("Borrador de conciliación restaurado correctamente.", "success");
    } else {
        // Cargar ítems consumibles (filtrando tipo 'Préstamo')
        const items = dbInventario.filter(i => i.tipo_control !== 'Préstamo');
        reconciliationData = items.map(item => ({
            id: item.id,
            codigo: item.codigo || 'S/K',
            nombre: item.nombre,
            categoria: item.categoria || 'Sin Categoría',
            stockSys: Number(item.stock || 0),
            physStock: Number(item.stock || 0),
            diff: 0,
            reason: 'Sin Observación',
            note: ''
        }));
    }

    renderReconciliationDashboard();
    renderReconciliationTable();
}

/**
 * Reinicia todos los conteos físicos de la conciliación activa
 */
export function resetReconciliationConteo() {
    reconciliationData.forEach(item => {
        item.physStock = item.stockSys;
        item.diff = 0;
        item.reason = 'Sin Observación';
        item.note = '';
    });
    renderReconciliationDashboard();
    renderReconciliationTable();
    showToast("Conteos reiniciados al stock del sistema.", "info");
}


/**
 * Renderiza los 3 KPIs superiores del Dashboard
 */
export function renderReconciliationDashboard() {
    const kpiAuditados = document.getElementById("kpi-reconcile-auditados");
    const kpiProgressLbl = document.getElementById("kpi-reconcile-progress-lbl");
    const kpiNeto = document.getElementById("kpi-reconcile-neto");
    const kpiNetoLbl = document.getElementById("kpi-reconcile-neto-lbl");
    const kpiAdherencia = document.getElementById("kpi-reconcile-adherencia");
    const kpiAdherenciaLbl = document.getElementById("kpi-reconcile-adherencia-lbl");

    if (!kpiAuditados || !reconciliationData.length) return;

    const totalItems = reconciliationData.length;
    // Consideramos auditados aquellos cuyo input ha sido tocado o revisado
    const itemsAuditados = reconciliationData.filter(i => i.physStock !== null && i.physStock !== undefined).length;
    const progressPct = totalItems > 0 ? Math.round((itemsAuditados / totalItems) * 100) : 0;

    let totalSobrantes = 0;
    let totalMermas = 0;
    let itemsCuadrados = 0;

    reconciliationData.forEach(item => {
        if (item.diff > 0) {
            totalSobrantes += item.diff;
        } else if (item.diff < 0) {
            totalMermas += Math.abs(item.diff);
        } else {
            itemsCuadrados++;
        }
    });

    const netoUnidades = totalSobrantes - totalMermas;
    const adherenciaPct = totalItems > 0 ? Math.round((itemsCuadrados / totalItems) * 100) : 100;

    kpiAuditados.textContent = `${itemsAuditados} / ${totalItems}`;
    if (kpiProgressLbl) kpiProgressLbl.textContent = `${progressPct}% del catálogo procesado`;

    if (kpiNeto) {
        kpiNeto.textContent = netoUnidades > 0 ? `+${netoUnidades} u.` : `${netoUnidades} u.`;
        kpiNeto.style.color = netoUnidades < 0 ? "var(--color-danger, #f43f5e)" : (netoUnidades > 0 ? "var(--emerald, #10b981)" : "inherit");
    }
    if (kpiNetoLbl) kpiNetoLbl.textContent = `Sobrantes: +${totalSobrantes} | Mermas: -${totalMermas}`;

    if (kpiAdherencia) {
        kpiAdherencia.textContent = `${adherenciaPct}%`;
        kpiAdherencia.style.color = adherenciaPct < 90 ? "var(--color-warning, #f59e0b)" : "var(--emerald, #10b981)";
    }
    if (kpiAdherenciaLbl) kpiAdherenciaLbl.textContent = `${itemsCuadrados} de ${totalItems} artículos en calce exacto`;
}

/**
 * Filtra y ordena la colección de ítems para renderizar en la tabla
 */
export function getFilteredAndSortedReconciliationData() {
    let filtered = [...reconciliationData];

    // 1. Filtrar por término de búsqueda
    if (reconciliationSearchQuery) {
        const q = reconciliationSearchQuery.toLowerCase();
        filtered = filtered.filter(i => 
            i.codigo.toLowerCase().includes(q) || 
            i.nombre.toLowerCase().includes(q) ||
            i.categoria.toLowerCase().includes(q)
        );
    }

    // 2. Filtrar por Chip de Estado
    if (reconciliationFilterChip === 'diff') {
        filtered = filtered.filter(i => i.diff !== 0);
    } else if (reconciliationFilterChip === 'equal') {
        filtered = filtered.filter(i => i.diff === 0);
    }

    // 3. Ordenar
    filtered.sort((a, b) => {
        let valA = a[reconciliationSortCol];
        let valB = b[reconciliationSortCol];

        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return reconciliationSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return reconciliationSortDir === 'asc' ? 1 : -1;
        return 0;
    });

    return filtered;
}

/**
 * Renderiza la tabla de conciliación
 */
export function renderReconciliationTable() {
    const tbody = document.getElementById("reconciliation-tbody");
    if (!tbody) return;

    const dataToRender = getFilteredAndSortedReconciliationData();

    if (dataToRender.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">
                    No se encontraron artículos que coincidan con la búsqueda o filtro seleccionado.
                </td>
            </tr>
        `;
        return;
    }

    const reasonsList = [
        "Sin Observación",
        "Merma / Deterioro",
        "Error de Registro Previo",
        "Vencimiento / Caducidad",
        "Pérdida / Extravío",
        "Otro Motivo"
    ];

    tbody.innerHTML = dataToRender.map((item, idx) => {
        const diffColor = item.diff < 0 ? "var(--color-danger, #f43f5e)" : (item.diff > 0 ? "var(--emerald, #10b981)" : "inherit");
        const diffDisplay = item.diff > 0 ? `+${item.diff}` : item.diff;
        const rowStyle = item.diff < 0 ? 'background-color: rgba(244, 63, 94, 0.08);' : (item.diff > 0 ? 'background-color: rgba(16, 185, 129, 0.08);' : '');

        const optionsHTML = reasonsList.map(r => 
            `<option value="${r}" ${item.reason === r ? 'selected' : ''}>${r}</option>`
        ).join("");

        return `
            <tr data-epp-id="${item.id}" style="${rowStyle}">
                <td><strong>${item.codigo}</strong></td>
                <td>
                    <div style="font-weight: 600;">${item.nombre}</div>
                    <small style="color: var(--text-secondary); font-size: 0.75rem;">${item.categoria}</small>
                </td>
                <td style="text-align: center; font-weight: bold;">${item.stockSys}</td>
                <td style="text-align: center;">
                    <input 
                        type="number" 
                        class="phys-stock-input form-input" 
                        min="0" 
                        value="${item.physStock}" 
                        data-index="${idx}"
                        style="width: 85px; text-align: center; font-weight: bold; margin: 0 auto; display: block;"
                        oninput="window.calculateDifference('${item.id}', ${item.stockSys}, this.value)"
                        onkeydown="window.handleKeyboardNavigation(event, this)"
                    >
                </td>
                <td style="text-align: center; font-weight: bold; font-size: 1rem; color: ${diffColor};" class="diff-stock-lbl">
                    ${diffDisplay}
                </td>
                <td>
                    <select class="form-select reconcile-reason-select" style="font-size: 0.8rem; padding: 4px 8px; height: 34px;" onchange="window.handleReconcileReasonChange('${item.id}', this.value)">
                        ${optionsHTML}
                    </select>
                </td>
                <td>
                    <input 
                        type="text" 
                        class="form-input reconcile-notes-input" 
                        placeholder="Nota u observación opcional..." 
                        value="${item.note || ''}" 
                        style="font-size: 0.8rem; height: 34px; width: 100%;"
                        oninput="window.handleReconcileNoteChange('${item.id}', this.value)"
                    >
                </td>
            </tr>
        `;
    }).join("");
}

/**
 * Calcula la diferencia para un ítem en tiempo real
 */
export function calculateDifference(eppId, sysStock, physStockVal) {
    const item = reconciliationData.find(i => i.id === eppId);
    if (!item) return;

    const physVal = physStockVal === "" ? 0 : Number(physStockVal);
    item.physStock = physVal;
    item.diff = physVal - sysStock;

    // Actualizar visualmente la celda y la fila sin re-renderizar toda la tabla
    const tr = document.querySelector(`tr[data-epp-id="${eppId}"]`);
    if (tr) {
        const diffLbl = tr.querySelector(".diff-stock-lbl");
        if (diffLbl) {
            diffLbl.textContent = item.diff > 0 ? `+${item.diff}` : item.diff;
            diffLbl.style.color = item.diff < 0 ? "var(--color-danger, #f43f5e)" : (item.diff > 0 ? "var(--emerald, #10b981)" : "inherit");
        }
        tr.style.backgroundColor = item.diff < 0 ? "rgba(244, 63, 94, 0.08)" : (item.diff > 0 ? "rgba(16, 185, 129, 0.08)" : "");
    }

    renderReconciliationDashboard();
}

/**
 * Maneja el cambio de causa de descuadre
 */
export function handleReconcileReasonChange(eppId, reasonVal) {
    const item = reconciliationData.find(i => i.id === eppId);
    if (item) {
        item.reason = reasonVal;
    }
}

/**
 * Maneja el cambio de notas / observaciones
 */
export function handleReconcileNoteChange(eppId, noteVal) {
    const item = reconciliationData.find(i => i.id === eppId);
    if (item) {
        item.note = noteVal;
    }
}

/**
 * Navegación ergonómica por teclado: Enter, Flecha Abajo (ArrowDown) y Flecha Arriba (ArrowUp)
 */
export function handleKeyboardNavigation(event, currentElem) {
    if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const inputs = Array.from(document.querySelectorAll(".phys-stock-input"));
        const currentIndex = inputs.indexOf(currentElem);

        if (currentIndex !== -1) {
            if (event.key === "ArrowUp" && currentIndex > 0) {
                inputs[currentIndex - 1].focus();
                inputs[currentIndex - 1].select();
            } else if ((event.key === "Enter" || event.key === "ArrowDown") && currentIndex < inputs.length - 1) {
                inputs[currentIndex + 1].focus();
                inputs[currentIndex + 1].select();
            }
        }
    }
}

/**
 * Maneja el ordenamiento por columnas
 */
export function handleReconcileSort(col) {
    if (reconciliationSortCol === col) {
        reconciliationSortDir = reconciliationSortDir === 'asc' ? 'desc' : 'asc';
    } else {
        reconciliationSortCol = col;
        reconciliationSortDir = 'asc';
    }

    // Actualizar iconos de las cabeceras
    const ths = document.querySelectorAll("#table-reconciliation th.sortable");
    ths.forEach(th => {
        const icon = th.querySelector("i");
        if (icon) icon.className = "fa-solid fa-sort";
    });

    renderReconciliationTable();
}

/**
 * Cambia el filtro por chip activo
 */
export function setReconcileFilterChip(chip) {
    reconciliationFilterChip = chip;

    document.querySelectorAll(".chip-filter-group button").forEach(btn => {
        btn.classList.remove("active", "btn-primary");
        btn.classList.add("btn-outline");
    });

    const activeBtn = document.getElementById(`chip-reconcile-${chip}`);
    if (activeBtn) {
        activeBtn.classList.remove("btn-outline");
        activeBtn.classList.add("active", "btn-primary");
    }

    renderReconciliationTable();
}

/**
 * Búsqueda global en vivo
 */
export function filterReconciliationTable() {
    const input = document.getElementById("reconcile-search-input");
    reconciliationSearchQuery = input ? input.value.trim() : '';
    renderReconciliationTable();
}

/**
 * Guardar estado actual como borrador multisesión en localStorage
 */
export function saveReconciliationDraft() {
    if (!reconciliationData.length) {
        showToast("No hay datos de conciliación para guardar como borrador.", "warning");
        return;
    }

    try {
        localStorage.setItem("bajada_draft_v1", JSON.stringify({
            timestamp: new Date().toISOString(),
            user: currentUser?.nombre || "Usuario",
            data: reconciliationData
        }));
        checkDraftAvailability();
        showToast("Borrador guardado correctamente. Puede pausar y continuar después.", "success");
    } catch (e) {
        console.error("Error guardando borrador", e);
        showToast("Error al guardar el borrador local.", "error");
    }
}

/**
 * Cargar borrador previo desde localStorage
 */
export function loadReconciliationDraft() {
    const saved = localStorage.getItem("bajada_draft_v1");
    if (!saved) {
        showToast("No se encontró ningún borrador guardado.", "info");
        return;
    }

    try {
        const parsed = JSON.parse(saved);
        startReconciliation(parsed.data);
    } catch (e) {
        showToast("Error al abrir el borrador guardado.", "error");
    }
}

/**
 * Cancela el proceso actual de conciliación
 */
export function cancelReconciliation() {
    const banner = document.getElementById("reconciliation-assistant-banner");
    const wrapper = document.getElementById("reconciliation-process-wrapper");

    if (banner) banner.style.display = "block";
    if (wrapper) wrapper.style.display = "none";
    reconciliationData = [];
}

/**
 * Exporta el reporte de la bajada en curso a CSV UTF-8 con BOM
 */
export function exportReconciliationCSV() {
    if (!reconciliationData.length) {
        showToast("No hay datos cargados para exportar.", "warning");
        return;
    }

    let csvContent = "\uFEFFCódigo SKU,Artículo EPP,Categoría,Stock Sistema,Físico Contado,Diferencia,Causa Descuadre,Observaciones\n";

    reconciliationData.forEach(item => {
        const row = [
            `"${item.codigo}"`,
            `"${item.nombre.replace(/"/g, '""')}"`,
            `"${item.categoria}"`,
            item.stockSys,
            item.physStock,
            item.diff,
            `"${item.reason}"`,
            `"${(item.note || '').replace(/"/g, '""')}"`
        ];
        csvContent += row.join(",") + "\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Martes_de_Bajada_Conciliacion_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Archivo CSV exportado exitosamente.", "success");
}

/**
 * Abre el modal para capturar la firma digital del responsable y confirmar el cierre
 */
export function openReconciliationSignatureModal() {
    const adjustments = reconciliationData.filter(i => i.diff !== 0);

    const modal = document.getElementById("modal-reconciliation-signature");
    const summaryBox = document.getElementById("reconciliation-summary-box");
    const supervisorInput = document.getElementById("reconcile-supervisor-name");

    if (!modal || !summaryBox) return;

    if (supervisorInput) {
        supervisorInput.value = currentUser?.nombre || "";
    }

    let totalSobrantes = 0;
    let totalMermas = 0;
    adjustments.forEach(a => {
        if (a.diff > 0) totalSobrantes += a.diff;
        else totalMermas += Math.abs(a.diff);
    });

    summaryBox.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span>Total Artículos Auditados:</span> <strong>${reconciliationData.length}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span>Artículos con Descuadre:</span> <strong style="color: ${adjustments.length > 0 ? 'var(--color-danger, #f43f5e)' : 'var(--emerald)'};">${adjustments.length}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
            <span>Resumen de Unidades:</span> <strong>+${totalSobrantes} Sobrantes / -${totalMermas} Mermas</strong>
        </div>
    `;

    modal.classList.add("active");
    setupSignatureCanvas();
}

/**
 * Cierra el modal de firma digital
 */
export function closeReconciliationSignatureModal() {
    const modal = document.getElementById("modal-reconciliation-signature");
    if (modal) modal.classList.remove("active");
}

/**
 * Configura los eventos del canvas de firma digital
 */
function setupSignatureCanvas() {
    signatureCanvas = document.getElementById("reconcile-signature-canvas");
    if (!signatureCanvas) return;

    signatureCtx = signatureCanvas.getContext("2d");
    signatureCtx.lineWidth = 2;
    signatureCtx.lineCap = "round";
    signatureCtx.strokeStyle = "#1e293b";

    // Limpiar canvas
    signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);

    function getPos(e) {
        const rect = signatureCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: clientX - rect.left,
            y: clientY - rect.top
        };
    }

    function startDrawing(e) {
        isSigning = true;
        const pos = getPos(e);
        signatureCtx.beginPath();
        signatureCtx.moveTo(pos.x, pos.y);
    }

    function draw(e) {
        if (!isSigning) return;
        e.preventDefault();
        const pos = getPos(e);
        signatureCtx.lineTo(pos.x, pos.y);
        signatureCtx.stroke();
    }

    function stopDrawing() {
        isSigning = false;
    }

    signatureCanvas.onmousedown = startDrawing;
    signatureCanvas.onmousemove = draw;
    signatureCanvas.onmouseup = stopDrawing;
    signatureCanvas.onmouseleave = stopDrawing;

    signatureCanvas.ontouchstart = startDrawing;
    signatureCanvas.ontouchmove = draw;
    signatureCanvas.ontouchend = stopDrawing;
}

/**
 * Limpia el contenido trazado en el canvas
 */
export function clearReconcileSignatureCanvas() {
    if (signatureCanvas && signatureCtx) {
        signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    }
}

/**
 * Procesa la bajada, actualiza stock en BD, guarda historial y registra ingreso
 */
export async function confirmSaveReconciliationWithSignature() {
    const supervisorInput = document.getElementById("reconcile-supervisor-name");
    const supervisorName = supervisorInput ? supervisorInput.value.trim() : "";

    if (!supervisorName) {
        showToast("Ingrese el nombre del responsable o supervisor a cargo.", "warning");
        return;
    }

    // Verificar si el canvas tiene trazo
    const canvasData = signatureCanvas ? signatureCanvas.toDataURL() : "";

    const adjustments = reconciliationData.filter(i => i.diff !== 0);

    const confirmAction = await showConfirmDialog(
        "Aprobar Bajada de Inventario",
        `Se registrarán ajustes para ${adjustments.length} artículos en la base de datos. ¿Desea proceder?`
    );
    if (!confirmAction) return;

    try {
        showToast("Aplicando cuadratura de stock...", "info");

        const inflowItems = [];

        for (const item of reconciliationData) {
            if (item.diff !== 0) {
                // Actualizar stock base en Supabase / Local
                await dbUpdateEPPStock(item.id, item.physStock);

                if (item.diff > 0) {
                    inflowItems.push({
                        eppId: item.id,
                        nombre: item.nombre,
                        cantidad: item.diff
                    });
                }
            }
        }

        // Si hubieron sobrantes positivos, registrar documento de ingreso
        if (inflowItems.length > 0) {
            await dbInsertInflow({
                factura: "CUADRA-" + Date.now().toString().substring(7),
                proveedor: "Ajuste de Inventario (Martes de Bajada)",
                fecha: new Date().toISOString(),
                items: inflowItems,
                comentarios: `Ajustes de cuadratura semanal aprobados por ${supervisorName}.\n` + 
                             adjustments.map(a => `${a.nombre}: Dif: ${a.diff > 0 ? '+' + a.diff : a.diff} (Motivo: ${a.reason}). Note: ${a.note}`).join("\n"),
                registrado_por: supervisorName
            });
        }

        // Guardar registro de la Bajada completa en el Historial Local
        const pastReconciliations = JSON.parse(localStorage.getItem("db_conciliaciones_historial") || "[]");
        
        let totalSobrantes = 0;
        let totalMermas = 0;
        let itemsCuadrados = 0;

        reconciliationData.forEach(i => {
            if (i.diff > 0) totalSobrantes += i.diff;
            else if (i.diff < 0) totalMermas += Math.abs(i.diff);
            else itemsCuadrados++;
        });

        const adherenciaPct = Math.round((itemsCuadrados / reconciliationData.length) * 100);

        pastReconciliations.unshift({
            id: "BAJADA-" + Date.now(),
            fecha: new Date().toISOString(),
            responsable: supervisorName,
            totalItems: reconciliationData.length,
            totalSobrantes,
            totalMermas,
            adherenciaPct,
            firma: canvasData,
            detalles: adjustments.map(a => ({
                codigo: a.codigo,
                nombre: a.nombre,
                sysStock: a.stockSys,
                physStock: a.physStock,
                diff: a.diff,
                reason: a.reason,
                note: a.note
            }))
        });

        localStorage.setItem("db_conciliaciones_historial", JSON.stringify(pastReconciliations));
        localStorage.removeItem("bajada_draft_v1"); // Limpiar borrador

        showToast("¡Conciliación de inventario procesada y aprobada exitosamente!", "success");
        closeReconciliationSignatureModal();
        cancelReconciliation();
        checkDraftAvailability();
        loadReconciliationHistory();

    } catch (e) {
        console.error("Error al guardar la conciliación:", e);
        showToast("Ocurrió un error al procesar los ajustes de stock.", "error");
    }
}

/**
 * Carga y renderiza el historial de conciliaciones pasadas
 */
export function loadReconciliationHistory() {
    const tbody = document.getElementById("reconciliation-history-tbody");
    if (!tbody) return;

    const history = JSON.parse(localStorage.getItem("db_conciliaciones_historial") || "[]");

    if (history.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">
                    No se registran bajadas de inventario guardadas anteriormente.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = history.map(item => {
        const fechaFormatted = new Date(item.fecha).toLocaleString("es-CL", { dateStyle: 'short', timeStyle: 'short' });
        const hasFirma = item.firma && item.firma.length > 50;

        return `
            <tr>
                <td><strong>${fechaFormatted}</strong></td>
                <td>${item.responsable}</td>
                <td style="text-align: center; font-weight: bold;">${item.totalItems}</td>
                <td style="text-align: center; color: var(--color-danger, #f43f5e); font-weight: bold;">-${item.totalMermas} u.</td>
                <td style="text-align: center; color: var(--emerald, #10b981); font-weight: bold;">+${item.totalSobrantes} u.</td>
                <td style="text-align: center; font-weight: bold;">${item.adherenciaPct}%</td>
                <td style="text-align: center;">
                    ${hasFirma ? `<span class="badge badge-success" style="background: rgba(16, 185, 129, 0.15); color: var(--emerald); padding: 4px 8px; border-radius: 4px; font-size: 0.75rem;"><i class="fa-solid fa-signature"></i> Firmado</span>` : `<span class="badge badge-secondary">Sin Firma</span>`}
                </td>
                <td style="text-align: center;">
                    <button class="btn btn-secondary btn-sm" onclick="window.viewReconciliationDetails('${item.id}')" title="Ver Acta">
                        <i class="fa-solid fa-eye"></i> Detalle
                    </button>
                </td>
            </tr>
        `;
    }).join("");
}

/**
 * Muestra el acta con el detalle de una conciliación pasada
 */
export function viewReconciliationDetails(histId) {
    const history = JSON.parse(localStorage.getItem("db_conciliaciones_historial") || "[]");
    const record = history.find(h => h.id === histId);
    if (!record) return;

    let detailsHTML = record.detalles.map(d => `
        <tr>
            <td>${d.codigo}</td>
            <td>${d.nombre}</td>
            <td style="text-align:center;">${d.sysStock}</td>
            <td style="text-align:center;">${d.physStock}</td>
            <td style="text-align:center; font-weight:bold; color: ${d.diff < 0 ? '#f43f5e' : '#10b981'};">${d.diff > 0 ? '+' + d.diff : d.diff}</td>
            <td>${d.reason}</td>
            <td>${d.note || '-'}</td>
        </tr>
    `).join("");

    const detailWindow = window.open("", "_blank", "width=800,height=600");
    detailWindow.document.write(`
        <html>
        <head>
            <title>Acta de Conciliación - ${record.id}</title>
            <style>
                body { font-family: sans-serif; padding: 20px; color: #1e293b; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; }
                th, td { border: 1px solid #cbd5e1; padding: 8px; font-size: 13px; text-align: left; }
                th { background: #f1f5f9; }
                .header { display: flex; justify-content: space-between; border-bottom: 2px solid #1e293b; padding-bottom: 10px; }
            </style>
        </head>
        <body>
            <div class="header">
                <div>
                    <h2>PROCLEANMG - Acta de Bajada de Inventario</h2>
                    <p>Fecha: ${new Date(record.fecha).toLocaleString()}</p>
                    <p>Responsable: ${record.responsable}</p>
                </div>
                <div>
                    <p><strong>Adherencia:</strong> ${record.adherenciaPct}%</p>
                    <p><strong>Mermas:</strong> -${record.totalMermas} | <strong>Sobrantes:</strong> +${record.totalSobrantes}</p>
                </div>
            </div>
            <h3>Detalle de Insumos Ajustados</h3>
            <table>
                <thead>
                    <tr>
                        <th>Código</th>
                        <th>Artículo EPP</th>
                        <th>Stock Sistema</th>
                        <th>Físico Contado</th>
                        <th>Diferencia</th>
                        <th>Motivo</th>
                        <th>Nota</th>
                    </tr>
                </thead>
                <tbody>
                    ${detailsHTML.length > 0 ? detailsHTML : '<tr><td colspan="7">No hubieron descuadres en esta bajada.</td></tr>'}
                </tbody>
            </table>
            ${record.firma ? `<div style="margin-top: 30px;"><p>Firma de Conformidad:</p><img src="${record.firma}" style="border: 1px solid #ccc; max-width: 250px;"/></div>` : ''}
        </body>
        </html>
    `);
}

// Exportar al scope global de window para eventos inline
window.initReconciliationView = initReconciliationView;
window.toggleReconciliationHistoryTab = toggleReconciliationHistoryTab;
window.startReconciliation = startReconciliation;
window.renderReconciliationTable = renderReconciliationTable;
window.calculateDifference = calculateDifference;
window.handleReconcileReasonChange = handleReconcileReasonChange;
window.handleReconcileNoteChange = handleReconcileNoteChange;
window.handleKeyboardNavigation = handleKeyboardNavigation;
window.handleReconcileSort = handleReconcileSort;
window.setReconcileFilterChip = setReconcileFilterChip;
window.filterReconciliationTable = filterReconciliationTable;
window.saveReconciliationDraft = saveReconciliationDraft;
window.loadReconciliationDraft = loadReconciliationDraft;
window.cancelReconciliation = cancelReconciliation;
window.exportReconciliationCSV = exportReconciliationCSV;
window.openReconciliationSignatureModal = openReconciliationSignatureModal;
window.closeReconciliationSignatureModal = closeReconciliationSignatureModal;
window.clearReconcileSignatureCanvas = clearReconcileSignatureCanvas;
window.confirmSaveReconciliationWithSignature = confirmSaveReconciliationWithSignature;
window.loadReconciliationHistory = loadReconciliationHistory;
window.viewReconciliationDetails = viewReconciliationDetails;
window.resetReconciliationConteo = resetReconciliationConteo;
