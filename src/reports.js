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
    if (dbIngresos.length === 0 && dbSalidas.length === 0) {
        showToast("No hay movimientos para exportar.", "warning");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Fecha,Tipo,Documento/Guia,Receptor/Proveedor,RUT,Area,Codigo EPP,Nombre EPP,Cantidad,Unidad,Usuario\r\n";

    dbIngresos.forEach(ing => {
        const localDate = new Date(ing.fecha).toLocaleDateString('es-CL');
        ing.items.forEach(it => {
            const epp = dbInventario.find(i => i.id === it.eppId) || { nombre: "EPP Desconocido", codigo: "???" };
            const row = [
                localDate,
                "INGRESO",
                ing.factura,
                ing.proveedor,
                "", 
                "", 
                epp.codigo,
                `"${epp.nombre.replace(/"/g, '""')}"`,
                it.cantidad,
                epp.unidad || "Unidades",
                ing.registrado_por || "Administrador Bodega"
            ];
            csvContent += row.join(",") + "\r\n";
        });
    });

    dbSalidas.forEach(sal => {
        const localDate = new Date(sal.fecha).toLocaleDateString('es-CL');
        sal.items.forEach(it => {
            const epp = dbInventario.find(i => i.id === it.eppId) || { nombre: "EPP Desconocido", codigo: "???" };
            const row = [
                localDate,
                "SALIDA",
                "ACTA-ENTREGA",
                `"${sal.trabajador.replace(/"/g, '""')}"`,
                sal.rut,
                sal.area,
                epp.codigo,
                `"${epp.nombre.replace(/"/g, '""')}"`,
                it.cantidad,
                epp.unidad || "Unidades",
                sal.registrado_por || "Despacho Bodega"
            ];
            csvContent += row.join(",") + "\n";
        });
    });

    dbInsumoMovimientos.forEach(mov => {
        const localDate = new Date(mov.fecha).toLocaleDateString('es-CL');
        mov.items.forEach(it => {
            const row = [
                localDate,
                "RECEPCION_INSUMO",
                mov.codigoSolicitud,
                `"Proyecto: ${mov.mejora.replace(/"/g, '""')}"`,
                "", 
                "", 
                "INSUMO",
                `"${it.nombre.replace(/"/g, '""')}"`,
                it.cantidad,
                "Unidades",
                mov.registrado_por || "Bodega Insumos"
            ];
            csvContent += row.join(",") + "\n";
        });
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `reporte_bodega_movimientos_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Historial exportado en formato CSV.", "success");
}
 
export function generateCorporatePDFReport() {
    const printWindow = window.open('', '_blank');
    const today = new Date().toLocaleDateString('es-CL');
    
    const totalIngresos = dbIngresos.length;
    const totalSalidas = dbSalidas.length;
    const activeConsumables = dbInventario.filter(i => i.tipo_control !== 'Préstamo');
    const underStock = activeConsumables.filter(i => i.stock <= i.stock_minimo).length;
    
    let inventoryRowsHTML = dbInventario.map(item => `
        <tr>
            <td>${item.codigo}</td>
            <td>${item.nombre}</td>
            <td>${item.categoria}</td>
            <td style="text-align:center; font-weight:bold; color: ${item.stock <= item.stock_minimo ? '#f43f5e' : 'inherit'};">${item.stock}</td>
            <td style="text-align:center;">${item.stock_minimo}</td>
            <td>${item.tipo_control}</td>
        </tr>
    `).join("");
 
    printWindow.document.write(`
        <html>
        <head>
            <title>Reporte de Bodega ProCleanMG - ${today}</title>
            <style>
                body {
                    font-family: 'Outfit', 'Inter', sans-serif;
                    color: #0f172a;
                    margin: 40px;
                    padding: 0;
                    background: #ffffff;
                }
                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    border-bottom: 3px solid #ff7a00;
                    padding-bottom: 20px;
                    margin-bottom: 30px;
                }
                .logo-section h1 {
                    margin: 0;
                    font-size: 24px;
                    font-weight: 800;
                    letter-spacing: 1px;
                }
                .logo-section span {
                    color: #ff7a00;
                }
                .logo-section p {
                    margin: 4px 0 0 0;
                    font-size: 12px;
                    color: #64748b;
                }
                .date-section {
                    text-align: right;
                    font-size: 14px;
                    color: #475569;
                }
                .summary-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 20px;
                    margin-bottom: 40px;
                }
                .summary-card {
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    padding: 16px;
                    background: #f8fafc;
                }
                .summary-card label {
                    font-size: 11px;
                    text-transform: uppercase;
                    font-weight: 700;
                    letter-spacing: 0.5px;
                    color: #64748b;
                    display: block;
                    margin-bottom: 6px;
                }
                .summary-card value {
                    font-size: 24px;
                    font-weight: 800;
                    color: #0f172a;
                    display: block;
                }
                .summary-card.alert value {
                    color: #f43f5e;
                }
                h2 {
                    font-size: 16px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    margin-bottom: 16px;
                    border-left: 4px solid #ff7a00;
                    padding-left: 10px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 40px;
                }
                th {
                    background: #f1f5f9;
                    text-align: left;
                    font-size: 10px;
                    text-transform: uppercase;
                    font-weight: 700;
                    letter-spacing: 1px;
                    padding: 12px;
                    border-bottom: 2px solid #cbd5e1;
                }
                td {
                    padding: 12px;
                    font-size: 13px;
                    border-bottom: 1px solid #e2e8f0;
                }
                tr:nth-child(even) td {
                    background: #f8fafc;
                }
                .footer {
                    margin-top: 60px;
                    border-top: 1px solid #e2e8f0;
                    padding-top: 20px;
                    text-align: center;
                    font-size: 11px;
                    color: #94a3b8;
                }
                @media print {
                    body { margin: 20px; }
                    .summary-card { background: #ffffff !important; border: 1px solid #cbd5e1 !important; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="logo-section">
                    <h1>ProClean<span>MG</span></h1>
                    <p>Sistema de Control y Aseguramiento de Bodega de EPP</p>
                </div>
                <div class="date-section">
                    <strong>Reporte Ejecutivo de Inventario</strong><br>
                    Fecha de Emisión: ${today}
                </div>
            </div>
            
            <div class="summary-grid">
                <div class="summary-card">
                    <label>Total Ingresos</label>
                    <value>${totalIngresos}</value>
                </div>
                <div class="summary-card">
                    <label>Total Entregas</label>
                    <value>${totalSalidas}</value>
                </div>
                <div class="summary-card alert">
                    <label>Bajo Stock Mínimo</label>
                    <value>${underStock}</value>
                </div>
                <div class="summary-card">
                    <label>Vigencia Operacional</label>
                    <value>100%</value>
                </div>
            </div>
 
            <h2>Estado de Stock Físico</h2>
            <table>
                <thead>
                    <tr>
                        <th>Código SKU</th>
                        <th>Nombre EPP</th>
                        <th>Categoría</th>
                        <th style="text-align:center;">Stock Actual</th>
                        <th style="text-align:center;">Stock Mínimo</th>
                        <th>Control</th>
                    </tr>
                </thead>
                <tbody>
                    ${inventoryRowsHTML}
                </tbody>
            </table>
 
            <div class="footer">
                ProCleanMG ERP - Reporte generado de manera segura por el Asistente Digital de Bodega.
            </div>
            <script>
                window.onload = function() {
                    window.print();
                }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}
window.generateCorporatePDFReport = generateCorporatePDFReport;
