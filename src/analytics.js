// ==========================================================================
// Módulo de Analítica y Gráficos de Consumo (src/analytics.js)
// Versión Avanzada con Runway, Tendencia Temporal, Paginación, Ordenamiento y Pareto
// ==========================================================================

import { dbSalidas, dbInventario, dbInsumos, dbAreas, dbCategorias } from './db.js';

let initializedFilters = false;

// Estado de Paginación y Ordenamiento: Colaboradores Observados
let deviationsCurrentPage = 1;
let deviationsPageSize = 15;
let deviationsSortField = "trabajador";
let deviationsSortDirection = "asc";
let filteredObservedList = [];

// Estado de Paginación y Ordenamiento: Runway de Autonomía
let runwayCurrentPage = 1;
let runwayPageSize = 15;
let runwaySortField = "runwayDays";
let runwaySortDirection = "asc";
let filteredRunwayList = [];

// Poblar los combos de segmentación dinámicamente al abrir analíticas
function populateFiltersDropdowns() {
    const areaSelect = document.getElementById("ana-filter-area");
    const categorySelect = document.getElementById("ana-filter-category");
    const productSelect = document.getElementById("ana-filter-product");

    if (areaSelect && areaSelect.options.length <= 1) {
        areaSelect.innerHTML = `<option value="">Todas las Áreas</option>`;
        dbAreas.forEach(area => {
            const opt = document.createElement("option");
            opt.value = area;
            opt.textContent = area;
            areaSelect.appendChild(opt);
        });
    }

    if (categorySelect && categorySelect.options.length <= 1) {
        categorySelect.innerHTML = `<option value="">Todas las Categorías</option>`;
        dbCategorias.forEach(cat => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            categorySelect.appendChild(opt);
        });
    }

    if (productSelect && productSelect.options.length <= 1) {
        productSelect.innerHTML = `<option value="">Todos los Productos (SKU)</option>`;
        dbInventario.forEach(item => {
            const opt = document.createElement("option");
            opt.value = item.id;
            opt.textContent = `${item.codigo} - ${item.nombre}`;
            productSelect.appendChild(opt);
        });
    }

    initializedFilters = true;
}

export function setAnalyticsDatePreset(preset) {
    const startInput = document.getElementById("ana-filter-start-date");
    const endInput = document.getElementById("ana-filter-end-date");
    const today = new Date();
    const endStr = today.toISOString().slice(0, 10);

    if (preset === "last-7" && startInput && endInput) {
        const past = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        startInput.value = past.toISOString().slice(0, 10);
        endInput.value = endStr;
    } else if (preset === "this-month" && startInput && endInput) {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startInput.value = firstDay.toISOString().slice(0, 10);
        endInput.value = endStr;
    } else if (preset === "last-30" && startInput && endInput) {
        const past = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        startInput.value = past.toISOString().slice(0, 10);
        endInput.value = endStr;
    } else if (preset === "last-90" && startInput && endInput) {
        const past = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
        startInput.value = past.toISOString().slice(0, 10);
        endInput.value = endStr;
    } else if (preset === "all" && startInput && endInput) {
        startInput.value = "";
        endInput.value = "";
    } else if (preset === "reset") {
        const areaSel = document.getElementById("ana-filter-area");
        const catSel = document.getElementById("ana-filter-category");
        const prodSel = document.getElementById("ana-filter-product");
        const shiftSel = document.getElementById("ana-filter-shift");
        const workerInp = document.getElementById("ana-filter-worker");
        const alertSel = document.getElementById("ana-filter-alert");

        if (areaSel) areaSel.value = "";
        if (catSel) catSel.value = "";
        if (prodSel) prodSel.value = "";
        if (shiftSel) shiftSel.value = "";
        if (workerInp) workerInp.value = "";
        if (alertSel) alertSel.value = "";
        if (startInput) startInput.value = "";
        if (endInput) endInput.value = "";
    }

    renderAnalyticsDashboard();
}
window.setAnalyticsDatePreset = setAnalyticsDatePreset;

// Handlers de Filtrado Cruzado (Cross-Filtering por clic en gráficos)
export function handleAreaChartClick(area) {
    const areaSelect = document.getElementById("ana-filter-area");
    if (!areaSelect) return;
    areaSelect.value = areaSelect.value === area ? "" : area;
    renderAnalyticsDashboard();
}
window.handleAreaChartClick = handleAreaChartClick;

export function handleAlertChartClick(status) {
    const alertSelect = document.getElementById("ana-filter-alert");
    if (!alertSelect) return;
    alertSelect.value = alertSelect.value === status ? "" : status;
    renderAnalyticsDashboard();
}
window.handleAlertChartClick = handleAlertChartClick;

export function handleTopSKUClick(skuId) {
    const prodSelect = document.getElementById("ana-filter-product");
    if (!prodSelect) return;
    prodSelect.value = prodSelect.value === skuId ? "" : skuId;
    renderAnalyticsDashboard();
}
window.handleTopSKUClick = handleTopSKUClick;

export function handleSeasonalityPointClick(monthKey) {
    const startInput = document.getElementById("ana-filter-start-date");
    const endInput = document.getElementById("ana-filter-end-date");
    if (!startInput || !endInput) return;

    const parts = monthKey.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);

    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);

    startInput.value = firstDay.toISOString().slice(0, 10);
    endInput.value = lastDay.toISOString().slice(0, 10);

    renderAnalyticsDashboard();
}
window.handleSeasonalityPointClick = handleSeasonalityPointClick;

export function renderAnalyticsDashboard() {
    // 1. Inicializar selectores de filtros si no se ha hecho
    if (!initializedFilters) {
        populateFiltersDropdowns();
    }

    // 2. Obtener valores de los segmentadores activos
    const selectedArea = document.getElementById("ana-filter-area")?.value || "";
    const selectedCategory = document.getElementById("ana-filter-category")?.value || "";
    const selectedProduct = document.getElementById("ana-filter-product")?.value || "";
    const selectedShift = document.getElementById("ana-filter-shift")?.value || "";
    const workerQuery = document.getElementById("ana-filter-worker")?.value.toLowerCase().trim() || "";
    const alertFilter = document.getElementById("ana-filter-alert")?.value || "";
    const startDateVal = document.getElementById("ana-filter-start-date")?.value || "";
    const endDateVal = document.getElementById("ana-filter-end-date")?.value || "";

    const startDate = startDateVal ? new Date(startDateVal + "T00:00:00") : null;
    const endDate = endDateVal ? new Date(endDateVal + "T23:59:59") : null;

    // 3. Filtrar las transacciones de salida (dbSalidas) en caliente según segmentadores
    const filteredDeliveries = [];
    let filteredEPPsCount = 0;
    let totalDeliveriesCount = 0;
    let criticalDeviations = 0;

    let shiftACount = 0;
    let shiftBCount = 0;

    dbSalidas.forEach(del => {
        // Filtro por Área
        if (selectedArea && del.area !== selectedArea) return;

        // Filtro por Turno
        if (selectedShift && del.turno !== selectedShift) return;

        // Filtro por Colaborador / RUT
        if (workerQuery) {
            const workerName = (del.trabajador || "").toLowerCase();
            const workerRUT = (del.rut || "").toLowerCase();
            if (!workerName.includes(workerQuery) && !workerRUT.includes(workerQuery)) return;
        }

        // Filtro por Fecha
        const delDate = new Date(del.fecha);
        if (startDate && delDate < startDate) return;
        if (endDate && delDate > endDate) return;

        // Filtrar los items individuales de la salida por categoría o SKU específico
        const matchingItems = del.items.filter(item => {
            if (selectedProduct && item.eppId !== selectedProduct) return false;
            if (selectedCategory) {
                const eppDef = dbInventario.find(i => i.id === item.eppId);
                if (!eppDef || eppDef.categoria !== selectedCategory) return false;
            }
            return true;
        });

        if (matchingItems.length > 0) {
            const itemsToInclude = [];

            matchingItems.forEach(item => {
                let isCritical = false;
                const prevDeliveries = dbSalidas.filter(s => 
                    s.rut === del.rut && 
                    new Date(s.fecha) < delDate && 
                    s.items.some(it => it.eppId === item.eppId)
                );

                if (prevDeliveries.length > 0) {
                    prevDeliveries.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
                    const lastDate = new Date(prevDeliveries[0].fecha);
                    const diffDays = Math.floor((delDate - lastDate) / (1000 * 60 * 60 * 24));
                    
                    const eppDef = dbInventario.find(i => i.id === item.eppId);
                    const lifespanDays = ((eppDef && eppDef.duracion_meses) ? Number(eppDef.duracion_meses) : 6) * 30;

                    if (diffDays < lifespanDays * 0.5) {
                        isCritical = true;
                        criticalDeviations++;
                    }
                }

                totalDeliveriesCount++;

                // Filtro por Estado de Alertas
                if (alertFilter === "critical" && !isCritical) return;
                if (alertFilter === "normal" && isCritical) return;

                itemsToInclude.push(item);
                const itemQty = Number(item.cantidad);
                filteredEPPsCount += itemQty;

                if ((del.turno || "").toLowerCase().includes("b")) {
                    shiftBCount += itemQty;
                } else {
                    shiftACount += itemQty;
                }
            });

            if (itemsToInclude.length > 0) {
                filteredDeliveries.push({
                    ...del,
                    items: itemsToInclude
                });
            }
        }
    });

    const deviationRate = totalDeliveriesCount > 0 ? Math.round((criticalDeviations / totalDeliveriesCount) * 100) : 0;

    // Relación de Turnos A vs B
    const totalShiftQty = shiftACount + shiftBCount;
    const shiftAPct = totalShiftQty > 0 ? Math.round((shiftACount / totalShiftQty) * 100) : 0;
    const shiftBPct = totalShiftQty > 0 ? (100 - shiftAPct) : 0;

    // Tendencia vs Período Anterior
    let trendText = "sin período anterior";
    let prevEPPsCount = 0;

    if (startDate && endDate) {
        const periodMs = endDate.getTime() - startDate.getTime();
        const prevStart = new Date(startDate.getTime() - periodMs);
        const prevEnd = new Date(startDate.getTime() - 1);

        dbSalidas.forEach(del => {
            if (selectedArea && del.area !== selectedArea) return;
            if (selectedShift && del.turno !== selectedShift) return;
            const delDate = new Date(del.fecha);
            if (delDate >= prevStart && delDate <= prevEnd) {
                del.items.forEach(it => prevEPPsCount += Number(it.cantidad));
            }
        });

        if (prevEPPsCount > 0) {
            const diffPct = Math.round(((filteredEPPsCount - prevEPPsCount) / prevEPPsCount) * 100);
            const icon = diffPct >= 0 ? "▲ +" : "▼ ";
            const color = diffPct > 0 ? "var(--color-danger)" : "var(--color-success)";
            trendText = `<span style="color:${color}; font-weight:700;">${icon}${diffPct}%</span> vs período anterior`;
        } else {
            trendText = `vs ${prevEPPsCount} u. período anterior`;
        }
    } else {
        trendText = `Histórico (${dbSalidas.length} entregas totales)`;
    }

    // Calcular SLA de requerimientos
    const filteredReqs = dbInsumos.filter(i => {
        if (selectedArea && i.area_trabajador !== selectedArea && i.area !== selectedArea) return false;
        const reqDate = new Date(i.fecha_solicitud || i.fechaSolicitud);
        if (startDate && reqDate < startDate) return false;
        if (endDate && reqDate > endDate) return false;
        return true;
    });

    const pendingReqs = filteredReqs.filter(i => i.estado !== "Recibido" && i.estado !== "Entregado");
    const overdueReqs = pendingReqs.filter(i => (new Date() - new Date(i.fecha_solicitud || i.fechaSolicitud)) > (2 * 24 * 60 * 60 * 1000));
    const slaCompliance = filteredReqs.length > 0 ? Math.round(((filteredReqs.length - overdueReqs.length) / filteredReqs.length) * 100) : 100;

    // Poblar KPIs en el DOM
    const kpiTotal = document.getElementById("ana-kpi-total");
    const kpiDev = document.getElementById("ana-kpi-deviation");
    const kpiShiftRatio = document.getElementById("ana-kpi-shift-ratio");
    const kpiSLA = document.getElementById("ana-kpi-sla");

    const kpiTotalSub = document.getElementById("ana-kpi-total-sub");
    const kpiDevSub = document.getElementById("ana-kpi-deviation-sub");
    const kpiShiftSub = document.getElementById("ana-kpi-shift-sub");
    const kpiSLASub = document.getElementById("ana-kpi-sla-sub");

    if (kpiTotal) kpiTotal.textContent = filteredEPPsCount;
    if (kpiDev) kpiDev.textContent = `${deviationRate}%`;
    if (kpiShiftRatio) kpiShiftRatio.textContent = `${shiftAPct}% / ${shiftBPct}%`;
    if (kpiSLA) kpiSLA.textContent = `${slaCompliance}%`;

    if (kpiTotalSub) kpiTotalSub.innerHTML = trendText;
    if (kpiDevSub) kpiDevSub.innerHTML = `${criticalDeviations} alertas críticas en el período`;
    if (kpiShiftSub) kpiShiftSub.innerHTML = `Turno A: ${shiftACount} u. | Turno B: ${shiftBCount} u.`;
    if (kpiSLASub) kpiSLASub.innerHTML = `${pendingReqs.length} pendientes (${overdueReqs.length} fuera SLA)`;

    // 4. Dibujar Gráficos y Widgets Dinámicos
    renderAreaChart(filteredDeliveries);
    renderCategoryChart(filteredDeliveries);
    renderAlertsDonutChart(criticalDeviations, totalDeliveriesCount);
    renderWeekdayChart(filteredDeliveries);
    renderTopConsumedSKUs(filteredDeliveries);
    renderSeasonalityLineChart(filteredDeliveries);

    // 5. Renderizar Tablas Paginadas
    renderObservedCollaborators(filteredDeliveries);
    renderRunwayAutonomyTable(selectedCategory);
}
window.renderAnalyticsDashboard = renderAnalyticsDashboard;

export function handleCategoryChartClick(category) {
    const categorySelect = document.getElementById("ana-filter-category");
    if (!categorySelect) return;
    categorySelect.value = categorySelect.value === category ? "" : category;
    renderAnalyticsDashboard();
}
window.handleCategoryChartClick = handleCategoryChartClick;

function renderCategoryChart(filteredDeliveries) {
    const container = document.getElementById("analytics-category-chart-container");
    if (!container) return;

    const catCounts = {};
    let totalQty = 0;

    filteredDeliveries.forEach(del => {
        del.items.forEach(it => {
            const eppDef = dbInventario.find(i => i.id === it.eppId);
            const cat = eppDef ? eppDef.categoria : "Sin Categoría";
            const qty = Number(it.cantidad);
            catCounts[cat] = (catCounts[cat] || 0) + qty;
            totalQty += qty;
        });
    });

    const categories = Object.keys(catCounts);
    if (categories.length === 0 || totalQty === 0) {
        container.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">Sin datos de categorías para los filtros seleccionados.</span>`;
        return;
    }

    const maxVal = Math.max(...Object.values(catCounts), 1);
    const chartHeight = 220;
    const barHeight = 22;
    const spacing = 10;
    const chartWidth = 360;
    const activeCat = document.getElementById("ana-filter-category")?.value || "";

    let barsHTML = "";
    categories.forEach((cat, index) => {
        const val = catCounts[cat];
        const pct = Math.round((val / totalQty) * 100);
        const barW = (val / maxVal) * (chartWidth - 160);
        const y = index * (barHeight + spacing) + 15;
        const isSelected = activeCat === cat;
        const fill = isSelected ? "var(--color-warning)" : "var(--color-primary)";

        barsHTML += `
            <g class="bar-group" onclick="handleCategoryChartClick('${cat}')" style="cursor:pointer;" title="Clic para filtrar por categoría ${cat}">
                <text x="5" y="${y + 15}" font-size="10" font-weight="600" fill="var(--text-primary)">${cat.substring(0, 15)}</text>
                <rect x="120" y="${y}" width="${barW}" height="${barHeight}" fill="${fill}" rx="4" opacity="${isSelected ? '1' : '0.85'}">
                    <title>${cat}: ${val} u. (${pct}%) - Clic para filtrar</title>
                </rect>
                <text x="${125 + barW}" y="${y + 15}" font-size="10" font-weight="700" fill="var(--text-secondary)">${val} u. (${pct}%)</text>
            </g>
        `;
    });

    const totalCalculatedHeight = Math.max(chartHeight, categories.length * (barHeight + spacing) + 30);

    container.innerHTML = `
        <svg width="100%" height="100%" viewBox="0 0 ${chartWidth} ${totalCalculatedHeight}" preserveAspectRatio="xMidYMid meet" style="background:transparent; max-width:100%; overflow:hidden;">
            ${barsHTML}
        </svg>
    `;
}

function renderWeekdayChart(filteredDeliveries) {
    const container = document.getElementById("analytics-weekday-chart-container");
    if (!container) return;

    const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const dayCounts = [0, 0, 0, 0, 0, 0, 0];

    filteredDeliveries.forEach(del => {
        const d = new Date(del.fecha);
        const dayIdx = d.getDay();
        let qty = 0;
        del.items.forEach(it => qty += Number(it.cantidad));
        dayCounts[dayIdx] += qty;
    });

    const maxVal = Math.max(...dayCounts, 1);
    const chartHeight = 220;
    const chartWidth = 360;
    const barWidth = 34;
    const spacing = 12;

    let barsHTML = "";
    const orderedIndices = [1, 2, 3, 4, 5, 6, 0];

    orderedIndices.forEach((dayIdx, posIndex) => {
        const val = dayCounts[dayIdx];
        const barHeight = (val / maxVal) * (chartHeight - 60);
        const x = posIndex * (barWidth + spacing) + 20;
        const y = chartHeight - barHeight - 35;
        const dayLabel = days[dayIdx];

        barsHTML += `
            <g class="bar-group" style="cursor:pointer;">
                <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="var(--color-primary)" rx="4" opacity="0.85">
                    <title>${dayLabel}: ${val} EPPs despachados</title>
                </rect>
                <text x="${x + barWidth / 2}" y="${chartHeight - 12}" font-size="10" font-weight="700" fill="var(--text-secondary)" text-anchor="middle">${dayLabel}</text>
                <text x="${x + barWidth / 2}" y="${y - 6}" font-size="10" font-weight="700" fill="var(--text-primary)" text-anchor="middle">${val}</text>
            </g>
        `;
    });

    container.innerHTML = `
        <svg width="100%" height="100%" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="xMidYMid meet" style="background:transparent; max-width:100%; overflow:hidden;">
            ${barsHTML}
            <line x1="10" y1="${chartHeight - 28}" x2="${chartWidth - 10}" y2="${chartHeight - 28}" stroke="var(--border-color)" stroke-width="1"/>
        </svg>
    `;
}

function renderAreaChart(filteredDeliveries) {
    const container = document.getElementById("analytics-area-chart-container");
    if (!container) return;

    const areaCounts = {};
    const areaWorkers = {};

    filteredDeliveries.forEach(del => {
        const area = del.area || "Desconocida";
        let qty = 0;
        del.items.forEach(it => qty += Number(it.cantidad));
        areaCounts[area] = (areaCounts[area] || 0) + qty;
        
        if (!areaWorkers[area]) areaWorkers[area] = new Set();
        if (del.rut) areaWorkers[area].add(del.rut);
    });

    const areas = Object.keys(areaCounts);
    if (areas.length === 0) {
        container.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">No hay datos de consumo para los filtros seleccionados.</span>`;
        return;
    }

    const maxVal = Math.max(...Object.values(areaCounts), 1);
    let barsHTML = "";
    const chartHeight = 220;
    const barWidth = 32;
    const spacing = 14;
    const chartWidth = Math.max(360, areas.length * (barWidth + spacing) + 40);

    const activeArea = document.getElementById("ana-filter-area")?.value || "";

    areas.forEach((area, index) => {
        const value = areaCounts[area];
        const workersCount = areaWorkers[area] ? areaWorkers[area].size : 1;
        const perCapita = (value / Math.max(1, workersCount)).toFixed(1);

        const barHeight = (value / maxVal) * (chartHeight - 60);
        const x = index * (barWidth + spacing) + 25;
        const y = chartHeight - barHeight - 35;

        const isSelected = activeArea === area;
        const barFill = isSelected ? "var(--color-warning)" : "var(--color-primary)";

        barsHTML += `
            <g class="bar-group" onclick="handleAreaChartClick('${area}')" style="cursor:pointer;" title="Clic para filtrar por ${area}">
                <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${barFill}" rx="4" opacity="${isSelected ? '1' : '0.8'}">
                    <title>${area}: ${value} EPPs entregados a ${workersCount} trabajador(es) (~${perCapita} EPP/persona) - Clic para filtrar</title>
                </rect>
                <text x="${x + barWidth / 2}" y="${chartHeight - 15}" font-size="9" fill="var(--text-secondary)" text-anchor="middle">${area.substring(0, 7)}..</text>
                <text x="${x + barWidth / 2}" y="${chartHeight - 2}" font-size="8" font-weight="700" fill="var(--color-primary)" text-anchor="middle">${perCapita}/p</text>
                <text x="${x + barWidth / 2}" y="${y - 6}" font-size="10" font-weight="700" fill="var(--text-primary)" text-anchor="middle">${value}</text>
            </g>
        `;
    });

    container.innerHTML = `
        <svg width="100%" height="100%" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="xMidYMid meet" style="background:transparent; max-width:100%; overflow:hidden;">
            ${barsHTML}
            <line x1="10" y1="${chartHeight - 30}" x2="${chartWidth - 10}" y2="${chartHeight - 30}" stroke="var(--border-color)" stroke-width="1"/>
        </svg>
    `;
}

function renderAlertsDonutChart(criticalCount, totalCount) {
    const container = document.getElementById("analytics-deviation-chart-container");
    if (!container) return;

    if (totalCount === 0) {
        container.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">Sin datos de desvíos para los filtros actuales.</span>`;
        return;
    }

    const normalCount = Math.max(0, totalCount - criticalCount);
    const normalPct = Math.round((normalCount / totalCount) * 100);
    const criticalPct = 100 - normalPct;

    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    const criticalOffset = circumference - (criticalPct / 100) * circumference;

    container.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:center; gap:20px; flex-wrap:wrap; max-width:100%; width:100%;">
            <svg width="150" height="150" viewBox="0 0 150 150" style="max-width:100%; cursor:pointer;">
                <circle cx="75" cy="75" r="${radius}" fill="transparent" stroke="var(--border-color)" stroke-width="15" />
                <circle cx="75" cy="75" r="${radius}" fill="transparent" stroke="var(--color-success)" stroke-width="15" 
                        stroke-dasharray="${circumference}" stroke-dashoffset="${(normalPct / 100) * circumference}"
                        transform="rotate(-90 75 75)" style="transition: stroke-dashoffset 0.8s;" onclick="handleAlertChartClick('normal')">
                    <title>Consumo Correcto: Clic para filtrar</title>
                </circle>
                <circle cx="75" cy="75" r="${radius}" fill="transparent" stroke="var(--color-danger)" stroke-width="15" 
                        stroke-dasharray="${circumference}" stroke-dashoffset="${criticalOffset}"
                        transform="rotate(${(normalPct/100)*360 - 90} 75 75)" style="transition: stroke-dashoffset 0.8s;" onclick="handleAlertChartClick('critical')">
                    <title>Desviaciones Críticas: Clic para filtrar</title>
                </circle>
                <text x="75" y="80" text-anchor="middle" font-size="14" font-weight="800" fill="var(--text-primary)">
                    ${criticalPct}% Alertas
                </text>
            </svg>
            <div style="font-size:0.85rem; display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; align-items:center; gap:8px; cursor:pointer;" onclick="handleAlertChartClick('normal')" title="Clic para filtrar consumos normales">
                    <span style="display:inline-block; width:12px; height:12px; border-radius:3px; background:var(--color-success);"></span>
                    <span>Consumo Correcto (${normalPct}%)</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px; cursor:pointer;" onclick="handleAlertChartClick('critical')" title="Clic para filtrar desviaciones críticas">
                    <span style="display:inline-block; width:12px; height:12px; border-radius:3px; background:var(--color-danger);"></span>
                    <span>Desviaciones Críticas (${criticalPct}%)</span>
                </div>
            </div>
        </div>
    `;
}

function renderTopConsumedSKUs(filteredDeliveries) {
    const container = document.getElementById("analytics-top-skus-container");
    if (!container) return;

    const skuCounts = {};
    filteredDeliveries.forEach(del => {
        del.items.forEach(it => {
            skuCounts[it.eppId] = (skuCounts[it.eppId] || 0) + Number(it.cantidad);
        });
    });

    const itemsList = Object.keys(skuCounts).map(eppId => {
        const catalogEPP = dbInventario.find(i => i.id === eppId);
        return {
            id: eppId,
            codigo: catalogEPP ? catalogEPP.codigo : "???",
            nombre: catalogEPP ? catalogEPP.nombre : "EPP Desconocido",
            cantidad: skuCounts[eppId]
        };
    });

    itemsList.sort((a, b) => b.cantidad - a.cantidad);

    if (itemsList.length === 0) {
        container.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted); text-align:center;">No hay consumos de EPP registrados para los filtros actuales.</span>`;
        return;
    }

    const top5 = itemsList.slice(0, 5);
    const maxQty = top5[0].cantidad || 1;
    const totalQty = itemsList.reduce((sum, item) => sum + item.cantidad, 0);

    const activeSKU = document.getElementById("ana-filter-product")?.value || "";

    let html = `<div style="display:flex; flex-direction:column; gap:12px; padding:10px 0;">`;
    top5.forEach((item, index) => {
        const pctOfTotal = Math.round((item.cantidad / totalQty) * 100);
        const barPct = Math.round((item.cantidad / maxQty) * 100);
        const isSelected = activeSKU === item.id;

        html += `
            <div onclick="handleTopSKUClick('${item.id}')" style="cursor:pointer; padding:4px; border-radius:6px; background:${isSelected ? 'rgba(255, 122, 0, 0.1)' : 'transparent'};" title="Clic para filtrar por este EPP SKU">
                <div style="display:flex; justify-content:space-between; font-size:0.85rem; font-weight:600; margin-bottom:4px;">
                    <span>${index + 1}. <strong>${item.nombre}</strong> <span style="color:var(--text-muted); font-size:0.75rem;">(${item.codigo})</span></span>
                    <span><strong>${item.cantidad} u.</strong> <span style="font-size:0.75rem; color:var(--text-secondary);">(${pctOfTotal}%)</span></span>
                </div>
                <div style="background:var(--bg-tertiary); height:8px; border-radius:4px; overflow:hidden;">
                    <div style="width:${barPct}%; background:${isSelected ? 'var(--color-warning)' : 'var(--color-primary)'}; height:100%; border-radius:4px; transition:width 0.5s;"></div>
                </div>
            </div>
        `;
    });
    html += `</div>`;

    container.innerHTML = html;
}

function renderSeasonalityLineChart(filteredDeliveries) {
    const container = document.getElementById("analytics-seasonality-chart-container");
    if (!container) return;

    const monthlyCounts = {};
    filteredDeliveries.forEach(del => {
        const dateObj = new Date(del.fecha);
        const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
        let qty = 0;
        del.items.forEach(it => qty += Number(it.cantidad));
        monthlyCounts[monthKey] = (monthlyCounts[monthKey] || 0) + qty;
    });

    const months = Object.keys(monthlyCounts).sort();
    if (months.length === 0) {
        container.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">Insuficientes meses con datos para trazar tendencia temporal.</span>`;
        return;
    }

    const chartHeight = 220;
    const chartWidth = 720;
    const paddingLeft = 50;
    const paddingRight = 30;
    const paddingTop = 20;
    const paddingBottom = 40;

    const values = Object.values(monthlyCounts);
    const maxVal = Math.max(...values, 1);

    const graphWidth = chartWidth - paddingLeft - paddingRight;
    const graphHeight = chartHeight - paddingTop - paddingBottom;

    const points = months.map((month, index) => {
        const val = monthlyCounts[month];
        const x = paddingLeft + (index / Math.max(months.length - 1, 1)) * graphWidth;
        const y = chartHeight - paddingBottom - (val / maxVal) * graphHeight;
        return { x, y, month, val };
    });

    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        pathD += ` L ${points[i].x} ${points[i].y}`;
    }

    let gridLinesHTML = "";
    for (let i = 0; i <= 4; i++) {
        const gridY = paddingTop + (i / 4) * graphHeight;
        const gridVal = Math.round(maxVal - (i / 4) * maxVal);
        gridLinesHTML += `
            <line x1="${paddingLeft}" y1="${gridY}" x2="${chartWidth - paddingRight}" y2="${gridY}" class="grid-line"/>
            <text x="${paddingLeft - 10}" y="${gridY + 4}" font-size="9" fill="var(--text-muted)" text-anchor="end">${gridVal}</text>
        `;
    }

    let pointsHTML = "";
    let labelsHTML = "";
    points.forEach(pt => {
        pointsHTML += `
            <circle cx="${pt.x}" cy="${pt.y}" r="6" class="chart-point" onclick="handleSeasonalityPointClick('${pt.month}')" style="cursor:pointer;">
                <title>Período: ${pt.month}\nConsumo: ${pt.val} EPPs\nClic para filtrar por este mes</title>
            </circle>
        `;
        labelsHTML += `
            <text x="${pt.x}" y="${chartHeight - paddingBottom + 18}" font-size="9" fill="var(--text-secondary)" text-anchor="middle" transform="rotate(-15 ${pt.x} ${chartHeight - paddingBottom + 18})" onclick="handleSeasonalityPointClick('${pt.month}')" style="cursor:pointer;">
                ${pt.month}
            </text>
        `;
    });

    container.innerHTML = `
        <svg width="100%" height="100%" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="xMidYMid meet" style="background:transparent; max-width:100%; overflow:hidden;">
            ${gridLinesHTML}
            <path d="${pathD}" class="chart-line"/>
            ${pointsHTML}
            ${labelsHTML}
            <line x1="${paddingLeft}" y1="${chartHeight - paddingBottom}" x2="${chartWidth - paddingRight}" y2="${chartHeight - paddingBottom}" stroke="var(--border-color)" stroke-width="1.5"/>
        </svg>
    `;
}

// ==========================================================================
// COLABORADORES OBSERVADOS: Ordenamiento y Paginación
// ==========================================================================
export function handleAnalyticsDeviationsSort(field) {
    if (deviationsSortField === field) {
        deviationsSortDirection = deviationsSortDirection === "asc" ? "desc" : "asc";
    } else {
        deviationsSortField = field;
        deviationsSortDirection = "asc";
    }

    const headers = document.querySelectorAll("#analytics-deviations-table th.sortable");
    headers.forEach(h => {
        h.classList.remove("active");
        const icon = h.querySelector("i");
        if (icon) icon.className = "fa-solid fa-sort";
        if (h.getAttribute("data-sort") === deviationsSortField) {
            h.classList.add("active");
            if (icon) {
                icon.className = deviationsSortDirection === "asc" ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
            }
        }
    });

    renderObservedCollaboratorsTableOnly();
}
window.handleAnalyticsDeviationsSort = handleAnalyticsDeviationsSort;

function renderObservedCollaborators(filteredDeliveries) {
    const userEPPMetrics = {};

    filteredDeliveries.forEach(del => {
        const workerKey = `${del.rut}_${del.trabajador}_${del.area}`;
        del.items.forEach(item => {
            const key = `${workerKey}_${item.eppId}`;
            if (!userEPPMetrics[key]) {
                const catalogEPP = dbInventario.find(i => i.id === item.eppId);
                const eppName = catalogEPP ? catalogEPP.nombre : (item.nombre || "EPP Desconocido");
                userEPPMetrics[key] = {
                    rut: del.rut,
                    trabajador: del.trabajador,
                    area: del.area,
                    eppId: item.eppId,
                    eppName: eppName,
                    entregas: [],
                };
            }
            userEPPMetrics[key].entregas.push(new Date(del.fecha));
        });
    });

    filteredObservedList = [];
    Object.keys(userEPPMetrics).forEach(key => {
        const metric = userEPPMetrics[key];
        if (metric.entregas.length < 2) return;

        metric.entregas.sort((a, b) => a - b);
        let sumDays = 0;
        for (let i = 1; i < metric.entregas.length; i++) {
            sumDays += Math.floor((metric.entregas[i] - metric.entregas[i-1]) / (1000 * 60 * 60 * 24));
        }
        const avgDays = Math.round(sumDays / (metric.entregas.length - 1));

        const epp = dbInventario.find(i => i.id === metric.eppId);
        const lifespanDays = ((epp && epp.duracion_meses) ? Number(epp.duracion_meses) : 6) * 30;

        if (avgDays < lifespanDays * 0.55) {
            filteredObservedList.push({
                trabajador: metric.trabajador,
                rut: metric.rut,
                area: metric.area,
                eppName: metric.eppName,
                entregasCount: metric.entregas.length,
                avgDays: avgDays,
                lifespanDays: lifespanDays
            });
        }
    });

    renderObservedCollaboratorsTableOnly();
}

function renderObservedCollaboratorsTableOnly() {
    const tbody = document.getElementById("analytics-deviations-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (filteredObservedList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No se detectan colaboradores con desgaste prematuro para los filtros actuales.</td></tr>`;
        renderObservedPagination();
        return;
    }

    filteredObservedList.sort((a, b) => {
        let valA = a[deviationsSortField];
        let valB = b[deviationsSortField];

        if (typeof valA === "string") valA = valA.toLowerCase();
        if (typeof valB === "string") valB = valB.toLowerCase();

        if (valA < valB) return deviationsSortDirection === "asc" ? -1 : 1;
        if (valA > valB) return deviationsSortDirection === "asc" ? 1 : -1;
        return 0;
    });

    const totalItems = filteredObservedList.length;
    const totalPages = Math.ceil(totalItems / deviationsPageSize) || 1;
    if (deviationsCurrentPage > totalPages) deviationsCurrentPage = totalPages;

    const startIndex = (deviationsCurrentPage - 1) * deviationsPageSize;
    const endIndex = Math.min(startIndex + deviationsPageSize, totalItems);
    const pageItems = filteredObservedList.slice(startIndex, endIndex);

    pageItems.forEach(obs => {
        const tr = document.createElement("tr");
        tr.className = "observed-row-clickable";
        tr.title = "Haga clic para auditar la ficha de este colaborador";
        
        tr.addEventListener("click", () => {
            if (window.switchView) {
                window.switchView("view-workers", obs.rut);
            }
        });

        tr.innerHTML = `
            <td>
                <div style="font-weight:600; color:var(--text-primary);">${obs.trabajador}</div>
                <div style="font-size:0.75rem; color:var(--text-secondary);">${obs.area}</div>
            </td>
            <td><strong>${obs.eppName}</strong></td>
            <td style="text-align: center;"><span class="badge" style="background:rgba(255,122,0,0.1); color:var(--color-primary); font-weight:700;">${obs.entregasCount} veces</span></td>
            <td>Cada <strong>${obs.avgDays} d.</strong> (Esperado: ${obs.lifespanDays} d.)</td>
            <td><span class="badge badge-danger"><i class="fa-solid fa-triangle-exclamation"></i> Alerta</span></td>
        `;
        tbody.appendChild(tr);
    });

    renderObservedPagination();
}

function renderObservedPagination() {
    const container = document.getElementById("analytics-deviations-pagination");
    if (!container) return;

    const totalItems = filteredObservedList.length;
    const totalPages = Math.ceil(totalItems / deviationsPageSize) || 1;
    const startItemIndex = totalItems === 0 ? 0 : (deviationsCurrentPage - 1) * deviationsPageSize + 1;
    const endItemIndex = Math.min(deviationsCurrentPage * deviationsPageSize, totalItems);

    container.innerHTML = `
        <div class="pagination-info">
            Mostrando <strong>${startItemIndex}</strong> - <strong>${endItemIndex}</strong> de <strong>${totalItems}</strong> colaboradores observados
        </div>
        <div class="pagination-controls">
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeAnalyticsDeviationsPage(${deviationsCurrentPage - 1})" ${deviationsCurrentPage === 1 ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span style="font-size:0.85rem; font-weight:600; margin:0 8px;">Pág. ${deviationsCurrentPage} de ${totalPages}</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeAnalyticsDeviationsPage(${deviationsCurrentPage + 1})" ${deviationsCurrentPage === totalPages ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
        <div class="pagination-page-size">
            <span>Mostrar</span>
            <select onchange="changeAnalyticsDeviationsPageSize(this.value)">
                <option value="10" ${deviationsPageSize === 10 ? 'selected' : ''}>10</option>
                <option value="15" ${deviationsPageSize === 15 ? 'selected' : ''}>15</option>
                <option value="25" ${deviationsPageSize === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${deviationsPageSize === 50 ? 'selected' : ''}>50</option>
            </select>
        </div>
    `;
}

export function changeAnalyticsDeviationsPage(newPage) {
    deviationsCurrentPage = newPage;
    renderObservedCollaboratorsTableOnly();
}
window.changeAnalyticsDeviationsPage = changeAnalyticsDeviationsPage;

export function changeAnalyticsDeviationsPageSize(newSize) {
    deviationsPageSize = Number(newSize);
    deviationsCurrentPage = 1;
    renderObservedCollaboratorsTableOnly();
}
window.changeAnalyticsDeviationsPageSize = changeAnalyticsDeviationsPageSize;

// ==========================================================================
// RUNWAY DE AUTONOMÍA: Ordenamiento y Paginación
// ==========================================================================
export function handleAnalyticsRunwaySort(field) {
    if (runwaySortField === field) {
        runwaySortDirection = runwaySortDirection === "asc" ? "desc" : "asc";
    } else {
        runwaySortField = field;
        runwaySortDirection = "asc";
    }

    const headers = document.querySelectorAll("#analytics-runway-table th.sortable");
    headers.forEach(h => {
        h.classList.remove("active");
        const icon = h.querySelector("i");
        if (icon) icon.className = "fa-solid fa-sort";
        if (h.getAttribute("data-sort") === runwaySortField) {
            h.classList.add("active");
            if (icon) {
                icon.className = runwaySortDirection === "asc" ? "fa-solid fa-sort-up" : "fa-solid fa-sort-down";
            }
        }
    });

    renderRunwayTableOnly();
}
window.handleAnalyticsRunwaySort = handleAnalyticsRunwaySort;

function renderRunwayAutonomyTable(selectedCategory) {
    const consumedSKU = {};
    dbSalidas.forEach(del => {
        del.items.forEach(it => {
            consumedSKU[it.eppId] = (consumedSKU[it.eppId] || 0) + Number(it.cantidad);
        });
    });

    let minDate = new Date();
    let maxDate = new Date(0);
    dbSalidas.forEach(del => {
        const d = new Date(del.fecha);
        if (d < minDate) minDate = d;
        if (d > maxDate) maxDate = d;
    });

    const elapsedDays = Math.max(1, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)));

    filteredRunwayList = [];

    dbInventario.forEach(item => {
        if (selectedCategory && item.categoria !== selectedCategory) return;

        const totalUsed = consumedSKU[item.id] || 0;
        const dailyConsumption = totalUsed / elapsedDays;
        const currentStock = Number(item.stock || 0);
        let runwayDays = 999;
        
        if (dailyConsumption > 0) {
            runwayDays = Math.round(currentStock / dailyConsumption);
        } else if (currentStock === 0) {
            runwayDays = 0;
        }

        let runwayText = "";
        let badgeClass = "";
        let riskText = "";

        if (runwayDays === 0) {
            runwayText = "0 días (Agotado)";
            badgeClass = "runway-badge-danger";
            riskText = "Quiebre";
        } else if (runwayDays < 7) {
            runwayText = `${runwayDays} días`;
            badgeClass = "runway-badge-danger";
            riskText = "Crítico";
        } else if (runwayDays < 15) {
            runwayText = `${runwayDays} días`;
            badgeClass = "runway-badge-warning";
            riskText = "Medio";
        } else {
            runwayText = runwayDays === 999 ? "Estable (+90 d.)" : `${runwayDays} días`;
            badgeClass = "runway-badge-success";
            riskText = "Bajo";
        }

        filteredRunwayList.push({
            nombre: item.nombre,
            codigo: item.codigo,
            stock: currentStock,
            runwayDays: runwayDays,
            runwayText: runwayText,
            badgeClass: badgeClass,
            riskText: riskText
        });
    });

    renderRunwayTableOnly();
}

function renderRunwayTableOnly() {
    const tbody = document.getElementById("analytics-runway-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (filteredRunwayList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding:20px;">Sin inventario cargado.</td></tr>`;
        renderRunwayPagination();
        return;
    }

    filteredRunwayList.sort((a, b) => {
        let valA = a[runwaySortField];
        let valB = b[runwaySortField];

        if (typeof valA === "string") valA = valA.toLowerCase();
        if (typeof valB === "string") valB = valB.toLowerCase();

        if (valA < valB) return runwaySortDirection === "asc" ? -1 : 1;
        if (valA > valB) return runwaySortDirection === "asc" ? 1 : -1;
        return 0;
    });

    const totalItems = filteredRunwayList.length;
    const totalPages = Math.ceil(totalItems / runwayPageSize) || 1;
    if (runwayCurrentPage > totalPages) runwayCurrentPage = totalPages;

    const startIndex = (runwayCurrentPage - 1) * runwayPageSize;
    const endIndex = Math.min(startIndex + runwayPageSize, totalItems);
    const pageItems = filteredRunwayList.slice(startIndex, endIndex);

    pageItems.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>
                <div style="font-weight:600; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.nombre}">${r.nombre}</div>
                <div style="font-size:0.75rem; color:var(--text-secondary); font-family: monospace;">SKU: ${r.codigo}</div>
            </td>
            <td style="text-align: center; font-weight:700;">${r.stock} u.</td>
            <td>${r.runwayText}</td>
            <td><span class="badge ${r.badgeClass}">${r.riskText}</span></td>
        `;
        tbody.appendChild(tr);
    });

    renderRunwayPagination();
}

function renderRunwayPagination() {
    const container = document.getElementById("analytics-runway-pagination");
    if (!container) return;

    const totalItems = filteredRunwayList.length;
    const totalPages = Math.ceil(totalItems / runwayPageSize) || 1;
    const startItemIndex = totalItems === 0 ? 0 : (runwayCurrentPage - 1) * runwayPageSize + 1;
    const endItemIndex = Math.min(runwayCurrentPage * runwayPageSize, totalItems);

    container.innerHTML = `
        <div class="pagination-info">
            Mostrando <strong>${startItemIndex}</strong> - <strong>${endItemIndex}</strong> de <strong>${totalItems}</strong> SKUs
        </div>
        <div class="pagination-controls">
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeAnalyticsRunwayPage(${runwayCurrentPage - 1})" ${runwayCurrentPage === 1 ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span style="font-size:0.85rem; font-weight:600; margin:0 8px;">Pág. ${runwayCurrentPage} de ${totalPages}</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="changeAnalyticsRunwayPage(${runwayCurrentPage + 1})" ${runwayCurrentPage === totalPages ? 'disabled' : ''}>
                <i class="fa-solid fa-chevron-right"></i>
            </button>
        </div>
        <div class="pagination-page-size">
            <span>Mostrar</span>
            <select onchange="changeAnalyticsRunwayPageSize(this.value)">
                <option value="10" ${runwayPageSize === 10 ? 'selected' : ''}>10</option>
                <option value="15" ${runwayPageSize === 15 ? 'selected' : ''}>15</option>
                <option value="25" ${runwayPageSize === 25 ? 'selected' : ''}>25</option>
                <option value="50" ${runwayPageSize === 50 ? 'selected' : ''}>50</option>
            </select>
        </div>
    `;
}

export function changeAnalyticsRunwayPage(newPage) {
    runwayCurrentPage = newPage;
    renderRunwayTableOnly();
}
window.changeAnalyticsRunwayPage = changeAnalyticsRunwayPage;

export function changeAnalyticsRunwayPageSize(newSize) {
    runwayPageSize = Number(newSize);
    runwayCurrentPage = 1;
    renderRunwayTableOnly();
}
window.changeAnalyticsRunwayPageSize = changeAnalyticsRunwayPageSize;

// ==========================================================================
// EXPORTACIÓN ANALÍTICA A CSV
// ==========================================================================
export function exportAnalyticsCSV() {
    const BOM = "\uFEFF";
    let csvRows = [];

    csvRows.push("ANÁLISIS DE CONSUMO DE EPP Y ADHERENCIA OPERACIONAL - PROCLEANMG");
    csvRows.push("");
    csvRows.push("COLABORADORES OBSERVADOS (CAMBIOS PREMATUROS)");
    csvRows.push("Colaborador;RUT;Área;EPP;Entregas Registradas;Frecuencia Promedio (días);Duración Esperada (días)");

    filteredObservedList.forEach(obs => {
        csvRows.push(`"${(obs.trabajador || '').replace(/"/g, '""')}";"${obs.rut}";"${(obs.area || '').replace(/"/g, '""')}";"${(obs.eppName || '').replace(/"/g, '""')}";${obs.entregasCount};${obs.avgDays};${obs.lifespanDays}`);
    });

    csvRows.push("");
    csvRows.push("RUNWAY DE AUTONOMÍA DE STOCK");
    csvRows.push("Código SKU;Nombre EPP;Stock Actual;Autonomía Estimada (días);Nivel de Riesgo");

    filteredRunwayList.forEach(r => {
        csvRows.push(`"${(r.codigo || '').replace(/"/g, '""')}";"${(r.nombre || '').replace(/"/g, '""')}";${r.stock};"${r.runwayDays}";"${r.riskText}"`);
    });

    const csvString = BOM + csvRows.join("\r\n");
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Analitica_Consumo_EPP_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
window.changeAnalyticsDeviationsPageSize = changeAnalyticsDeviationsPageSize;
window.exportAnalyticsCSV = exportAnalyticsCSV;
