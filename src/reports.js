// ==========================================================================
// Módulo de Historial, Logs de Auditoría y Reportes Generales
// ==========================================================================

import { dbIngresos, dbSalidas, dbInsumoMovimientos, dbInventario } from './db.js';
import { showToast } from './utils.js';
import { showVoucherDetailsById } from './outflow.js';

let historyCurrentPage = 1;
let historyPageSize = 15;
let consolidatedHistory = [];
let filteredHistory = [];

function removeAccents(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function applyHistoryFilters() {
    const searchInput = document.getElementById("history-search");
    const typeSelect = document.getElementById("history-filter-type");
    const productSelect = document.getElementById("history-filter-product");
 
    const searchQuery = searchInput ? removeAccents(searchInput.value.toLowerCase().trim()) : "";
    const filterType = typeSelect ? typeSelect.value : "";
    const filterProduct = productSelect ? productSelect.value : "";
 
    const searchWords = searchQuery.split(/\s+/).filter(w => w.length > 0);
 
    filteredHistory = consolidatedHistory.filter(mov => {
        const docText = removeAccents((mov.documento || "").toLowerCase());
        const detText = removeAccents((mov.detalles || "").toLowerCase());
        const userText = removeAccents((mov.usuario || "").toLowerCase());
        
        // Build a text of all items code & name
        const itemsText = removeAccents(mov.items.map(it => {
            if (mov.tipo === "insumo_recepcion") {
                return "insumo " + it.nombre;
            }
            const epp = dbInventario.find(i => i.id === it.eppId) || { nombre: "", codigo: "" };
            return epp.codigo + " " + epp.nombre;
        }).join(" ").toLowerCase());
 
        let matchesType = true;
        if (filterType === "ingreso") {
            matchesType = mov.tipo === "ingreso" || mov.tipo === "insumo_recepcion";
        } else if (filterType === "salida") {
            matchesType = mov.tipo === "salida";
        }
 
        let matchesProduct = true;
        if (filterProduct) {
            matchesProduct = mov.items.some(it => it.eppId === filterProduct);
        }
 
        const matchesSearch = searchWords.every(word => {
            return docText.includes(word) || detText.includes(word) || userText.includes(word) || itemsText.includes(word);
        });
 
        return matchesType && matchesSearch && matchesProduct;
    });
}
 
export function populateHistoryProductSelect() {
    const select = document.getElementById("history-filter-product");
    if (!select) return;
    
    const currentVal = select.value;
    select.innerHTML = `<option value="">Todos los Productos (SKU)</option>` + 
        dbInventario.map(p => `<option value="${p.id}" ${p.id === currentVal ? "selected" : ""}>${p.nombre}</option>`).join("");
}
 
export function renderHistoryTable() {
    populateHistoryProductSelect();
    
    const tbody = document.getElementById("history-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
 
    consolidatedHistory = [];

    dbIngresos.forEach(ing => {
        consolidatedHistory.push({
            original: ing,
            tipo: "ingreso",
            fecha: new Date(ing.fecha),
            fechaStr: ing.fecha,
            documento: `Guía: ${ing.factura}`,
            detalles: ing.proveedor,
            usuario: ing.registrado_por || "Administrador Bodega",
            items: ing.items
        });
    });

    dbSalidas.forEach(sal => {
        consolidatedHistory.push({
            original: sal,
            tipo: "salida",
            fecha: new Date(sal.fecha),
            fechaStr: sal.fecha,
            documento: `Entregado a: ${sal.trabajador}`,
            detalles: `RUT: ${sal.rut} | Área: ${sal.area}`,
            usuario: sal.registrado_por || "Despacho Bodega",
            items: sal.items
        });
    });

    dbInsumoMovimientos.forEach(mov => {
        consolidatedHistory.push({
            original: mov,
            tipo: "insumo_recepcion",
            fecha: new Date(mov.fecha),
            fechaStr: mov.fecha,
            documento: `Recepción: ${mov.codigo_solicitud || mov.codigoSolicitud}`,
            detalles: `Proyecto: ${mov.mejora}`,
            usuario: mov.registrado_por || "Bodega Insumos",
            items: mov.items
        });
    });

    consolidatedHistory.sort((a, b) => b.fecha - a.fecha);

    applyHistoryFilters();

    if (filteredHistory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No se registran movimientos en el historial.</td></tr>`;
        renderHistoryPagination();
        return;
    }

    const totalItems = filteredHistory.length;
    const totalPages = Math.ceil(totalItems / historyPageSize);
    if (historyCurrentPage > totalPages) historyCurrentPage = Math.max(1, totalPages);

    const startIndex = (historyCurrentPage - 1) * historyPageSize;
    const endIndex = Math.min(startIndex + historyPageSize, totalItems);
    const pageItems = filteredHistory.slice(startIndex, endIndex);

    pageItems.forEach(mov => {
        const itemsListHTML = mov.items.map(it => {
            if (mov.tipo === "insumo_recepcion") {
                return `<div style="font-size:0.85rem; margin-bottom: 2px;">
                    <span class="badge badge-info" style="font-size: 0.65rem; padding: 2px 6px; background-color:rgba(6, 182, 212, 0.12); color:var(--color-info); border:1px solid rgba(6,182,212,0.2);">
                        ${it.cantidad}x
                    </span> 
                    <strong>INSUMO</strong> - ${it.nombre}
                </div>`;
            }
            const epp = dbInventario.find(i => i.id === it.eppId) || { nombre: "EPP Desconocido", codigo: "???", unidad: "U" };
            return `<div style="font-size:0.85rem; margin-bottom: 2px;">
                <span class="badge badge-info" style="font-size: 0.65rem; padding: 2px 6px;">${it.cantidad}x</span> 
                <strong>${epp.codigo}</strong> - ${epp.nombre}
            </div>`;
        }).join("");

        const badgeTipo = mov.tipo === "ingreso" 
            ? `<span class="badge badge-success"><i class="fa-solid fa-cloud-arrow-up"></i> Ingreso</span>`
            : mov.tipo === "insumo_recepcion"
                ? `<span class="badge badge-info" style="background-color:rgba(6, 182, 212, 0.15); color:var(--color-info); border: 1px solid rgba(6,182,212,0.25);"><i class="fa-solid fa-boxes-packing"></i> Insumo</span>`
                : `<span class="badge badge-primary" style="background-color:rgba(224, 122, 95, 0.15); color:var(--color-primary); border: 1px solid rgba(224,122,95,0.25);"><i class="fa-solid fa-hand-holding-hand"></i> Entrega</span>`;

        const localDate = new Date(mov.fechaStr);
        const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
        const formattedDate = localDate.toLocaleDateString('es-CL', options);

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td style="white-space: nowrap;">${formattedDate}</td>
            <td>${badgeTipo}</td>
            <td>
                <div style="font-weight: 600;">${mov.documento}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 2px;">${mov.detalles}</div>
            </td>
            <td>${itemsListHTML}</td>
            <td style="font-size: 0.85rem; color: var(--text-muted);">${mov.usuario}</td>
            <td>
                ${mov.tipo === "salida" 
                    ? `<button class="btn btn-secondary btn-sm val-voucher-btn" data-id="${mov.original.id}" title="Ver Vale de Entrega Firmado">
                        <i class="fa-solid fa-file-signature text-warning"></i> Vale
                       </button>`
                    : `<span style="color:var(--text-muted); font-size:0.75rem;">N/A</span>`
                }
            </td>
        `;
        tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".val-voucher-btn").forEach(button => {
        button.addEventListener("click", () => {
            showVoucherDetailsById(button.dataset.id);
        });
    });

    renderHistoryPagination();
}

function renderHistoryPagination() {
    const container = document.getElementById("history-pagination");
    if (!container) return;

    const totalItems = filteredHistory.length;
    const totalPages = Math.ceil(totalItems / historyPageSize) || 1;

    if (historyCurrentPage > totalPages) {
        historyCurrentPage = totalPages;
    }

    const startItemIndex = totalItems === 0 ? 0 : (historyCurrentPage - 1) * historyPageSize + 1;
    const endItemIndex = Math.min(historyCurrentPage * historyPageSize, totalItems);

    container.innerHTML = `
        <div class="pagination-info">
            Mostrando <strong>${startItemIndex}</strong> - <strong>${endItemIndex}</strong> de <strong>${totalItems}</strong> movimientos
        </div>
        <div class="pagination-controls">
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeHistoryPage(${historyCurrentPage - 1})" ${historyCurrentPage === 1 ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span style="font-size:0.85rem; font-weight:600; margin:0 8px;">Pág. ${historyCurrentPage} de ${totalPages}</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeHistoryPage(${historyCurrentPage + 1})" ${historyCurrentPage === totalPages ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
        <div class="pagination-page-size">
            <span>Mostrar</span>
            <select onchange="changeHistoryPageSize(this.value)">
                <option value="10" ${historyPageSize === 10 ? 'selected' : ''}>10</option>
                <option value="15" ${historyPageSize === 15 ? 'selected' : ''}>15</option>
                <option value="25" ${historyPageSize === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${historyPageSize === 50 ? 'selected' : ''}>50</option>
            </select>
        </div>
    `;
}

export function changeHistoryPage(page) {
    historyCurrentPage = page;
    renderHistoryTable();
}

export function changeHistoryPageSize(size) {
    historyPageSize = Number(size);
    historyCurrentPage = 1;
    renderHistoryTable();
}

export function filterHistoryTable() {
    historyCurrentPage = 1;
    renderHistoryTable();
}

export function exportHistoryCSV() {
    const listToExport = (filteredHistory && filteredHistory.length > 0) ? filteredHistory : consolidatedHistory;

    if (!listToExport || listToExport.length === 0) {
        showToast("No hay movimientos en el historial para exportar.", "warning");
        return;
    }

    const headers = [
        "Fecha y Hora",
        "Tipo Movimiento",
        "Documento / Folio",
        "Receptor / Proveedor",
        "RUT Trabajador",
        "Area de Trabajo",
        "Turno",
        "Codigo SKU",
        "Descripcion Articulo EPP",
        "Categoria",
        "Cantidad",
        "Unidad Medida",
        "Usuario Registrador",
        "Comentarios / Observaciones"
    ];

    const BOM = "\uFEFF";
    let csvRows = [headers.map(h => `"${h}"`).join(";")];

    listToExport.forEach(mov => {
        const localDate = new Date(mov.fechaStr || mov.fecha);
        const dateFormatted = isNaN(localDate) ? String(mov.fechaStr) : localDate.toLocaleString('es-CL');
        const orig = mov.original || {};

        let tipoLabel = "ENTREGA EPP";
        if (mov.tipo === "ingreso") tipoLabel = "INGRESO GUIA";
        if (mov.tipo === "insumo_recepcion") tipoLabel = "INSUMO MEJORA";

        const docNum = orig.factura || orig.codigo_solicitud || orig.codigoSolicitud || orig.codigo || mov.documento || "";
        const receptorProv = orig.trabajador || orig.proveedor || orig.mejora || mov.detalles || "";
        const rut = orig.rut || "";
        const area = orig.area || "";
        const turno = orig.turno || "";
        const usuario = mov.usuario || orig.registrado_por || "";
        const comentarios = (orig.comentarios || orig.motivo_entrega || "").replace(/"/g, '""');

        (mov.items || []).forEach(it => {
            let sku = "S/C";
            let nombreEpp = it.nombre || "Artículo Desconocido";
            let categoria = "Sin categoría";
            let unidad = "Unidades";

            if (mov.tipo !== "insumo_recepcion") {
                const catalogEPP = dbInventario.find(i => i.id === it.eppId);
                if (catalogEPP) {
                    sku = catalogEPP.codigo || "S/C";
                    nombreEpp = catalogEPP.nombre;
                    categoria = catalogEPP.categoria || "N/A";
                    unidad = catalogEPP.unidad || "Unidades";
                }
            }

            const rowValues = [
                dateFormatted,
                tipoLabel,
                docNum,
                receptorProv,
                rut,
                area,
                turno,
                sku,
                nombreEpp,
                categoria,
                it.cantidad || 1,
                unidad,
                usuario,
                comentarios
            ];

            const formattedRow = rowValues.map(val => `"${String(val).replace(/"/g, '""')}"`).join(";");
            csvRows.push(formattedRow);
        });
    });

    const csvString = BOM + csvRows.join("\r\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `historial_movimientos_bodega_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast("Historial exportado a Excel (tabla plana).", "success");
}

export function generateCorporatePDFReport() {
    const listToPrint = (filteredHistory && filteredHistory.length > 0) ? filteredHistory : consolidatedHistory;

    if (!listToPrint || listToPrint.length === 0) {
        showToast("No hay movimientos para generar el reporte PDF.", "warning");
        return;
    }

    const printWindow = window.open('', '_blank');
    const today = new Date().toLocaleDateString('es-CL');
    const logoUrl = `${window.location.origin}/LOGO PROCLEANMG.jpg`;

    let totalEntregas = 0;
    let totalIngresos = 0;
    let totalItemsMovidos = 0;

    listToPrint.forEach(mov => {
        if (mov.tipo === "salida") totalEntregas++;
        if (mov.tipo === "ingreso" || mov.tipo === "insumo_recepcion") totalIngresos++;
        (mov.items || []).forEach(it => {
            totalItemsMovidos += Number(it.cantidad || 0);
        });
    });

    const rowsHTML = listToPrint.map(mov => {
        const localDate = new Date(mov.fechaStr || mov.fecha);
        const dateFormatted = isNaN(localDate) ? String(mov.fechaStr) : localDate.toLocaleString('es-CL', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

        const itemsSummary = (mov.items || []).map(it => {
            if (mov.tipo === "insumo_recepcion") {
                return `<strong>${it.cantidad}x</strong> INSUMO: ${it.nombre}`;
            }
            const epp = dbInventario.find(i => i.id === it.eppId) || { nombre: "EPP Desconocido", codigo: "???" };
            return `<strong>${it.cantidad}x</strong> [${epp.codigo}] ${epp.nombre}`;
        }).join("<br>");

        const badgeClass = mov.tipo === "ingreso" ? "badge-ingreso" : (mov.tipo === "insumo_recepcion" ? "badge-insumo" : "badge-entrega");
        const tipoText = mov.tipo === "ingreso" ? "INGRESO GUÍA" : (mov.tipo === "insumo_recepcion" ? "INSUMO" : "ENTREGA");

        return `
            <tr>
                <td style="white-space:nowrap; font-weight:600;">${dateFormatted}</td>
                <td><span class="badge ${badgeClass}">${tipoText}</span></td>
                <td>
                    <div style="font-weight:700;">${mov.documento}</div>
                    <div style="font-size:11px; color:#64748b;">${mov.detalles}</div>
                </td>
                <td style="font-size:12px; line-height:1.4;">${itemsSummary}</td>
                <td style="font-size:11px; color:#475569;">${mov.usuario}</td>
            </tr>
        `;
    }).join("");

    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Reporte de Movimientos de Bodega - ProCleanMG</title>
            <style>
                @page {
                    size: A4 landscape;
                    margin: 12mm;
                }
                body {
                    font-family: Arial, Helvetica, sans-serif;
                    color: #0f172a;
                    margin: 20px;
                    padding: 0;
                    background: #ffffff;
                }
                .header-container {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 3px solid #ff7a00;
                    padding-bottom: 16px;
                    margin-bottom: 24px;
                }
                .logo-wrapper {
                    display: flex;
                    align-items: center;
                    gap: 16px;
                }
                .logo-wrapper img {
                    height: 52px;
                    object-fit: contain;
                }
                .company-title h1 {
                    margin: 0;
                    font-size: 20px;
                    font-weight: 800;
                    color: #1e293b;
                    letter-spacing: 0.5px;
                }
                .company-title p {
                    margin: 3px 0 0 0;
                    font-size: 11px;
                    color: #64748b;
                }
                .report-meta {
                    text-align: right;
                    font-size: 12px;
                    color: #334155;
                }
                .summary-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 16px;
                    margin-bottom: 24px;
                }
                .summary-card {
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    padding: 12px 16px;
                    background: #f8fafc;
                }
                .summary-card label {
                    font-size: 10px;
                    text-transform: uppercase;
                    font-weight: 700;
                    color: #64748b;
                    display: block;
                    margin-bottom: 4px;
                }
                .summary-card .val {
                    font-size: 20px;
                    font-weight: 800;
                    color: #0f172a;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 24px;
                }
                th {
                    background: #f1f5f9;
                    text-align: left;
                    font-size: 11px;
                    text-transform: uppercase;
                    font-weight: 700;
                    color: #334155;
                    padding: 10px 12px;
                    border-bottom: 2px solid #cbd5e1;
                }
                td {
                    padding: 10px 12px;
                    font-size: 12px;
                    border-bottom: 1px solid #e2e8f0;
                    vertical-align: top;
                }
                tr:nth-child(even) td {
                    background: #f8fafc;
                }
                .badge {
                    display: inline-block;
                    padding: 3px 8px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                }
                .badge-entrega {
                    background: rgba(224, 122, 95, 0.15);
                    color: #e07a5f;
                    border: 1px solid rgba(224, 122, 95, 0.3);
                }
                .badge-ingreso {
                    background: rgba(42, 157, 143, 0.15);
                    color: #2a9d8f;
                    border: 1px solid rgba(42, 157, 143, 0.3);
                }
                .badge-insumo {
                    background: rgba(6, 182, 212, 0.15);
                    color: #0891b2;
                    border: 1px solid rgba(6, 182, 212, 0.3);
                }
                .footer {
                    margin-top: 30px;
                    border-top: 1px solid #e2e8f0;
                    padding-top: 16px;
                    text-align: center;
                    font-size: 11px;
                    color: #94a3b8;
                }
                @media print {
                    body { margin: 10px; }
                    .summary-card { background: #ffffff !important; border: 1px solid #cbd5e1 !important; }
                }
            </style>
        </head>
        <body>
            <div class="header-container">
                <div class="logo-wrapper">
                    <img src="${logoUrl}" alt="ProCleanMG Logo" onerror="this.style.display='none';">
                    <div class="company-title">
                        <h1>ProClean<span style="color:#ff7a00;">MG</span> - Registro de Movimientos</h1>
                        <p>Sistema de Gestión y Control Auditor de Bodega de EPP</p>
                    </div>
                </div>
                <div class="report-meta">
                    <strong>Informe de Auditoría de Movimientos</strong><br>
                    Fecha de Emisión: ${today}<br>
                    <span style="font-size:11px; color:#64748b;">Registros en Reporte: ${listToPrint.length}</span>
                </div>
            </div>

            <div class="summary-grid">
                <div class="summary-card">
                    <label>Total Movimientos</label>
                    <div class="val">${listToPrint.length}</div>
                </div>
                <div class="summary-card">
                    <label>Entregas a Colaboradores</label>
                    <div class="val" style="color:#e07a5f;">${totalEntregas}</div>
                </div>
                <div class="summary-card">
                    <label>Ingresos por Guía</label>
                    <div class="val" style="color:#2a9d8f;">${totalIngresos}</div>
                </div>
                <div class="summary-card">
                    <label>Total Unidades Despachadas</label>
                    <div class="val" style="color:#3b82f6;">${totalItemsMovidos}</div>
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Fecha y Hora</th>
                        <th>Tipo</th>
                        <th>Documento / Receptor</th>
                        <th>Detalle de Productos</th>
                        <th>Registrado Por</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHTML}
                </tbody>
            </table>

            <div class="footer">
                ProCleanMG ERP - Reporte oficial de movimientos de bodega impreso el ${today}.
            </div>
            <script>
                window.onload = function() {
                    setTimeout(() => {
                        window.print();
                    }, 300);
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}
window.generateCorporatePDFReport = generateCorporatePDFReport;
