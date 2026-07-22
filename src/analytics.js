// ==========================================================================
// Módulo de Analítica y Gráficos de Consumo (src/analytics.js)
// Versión Avanzada con Runway, Tendencia Temporal y Segmentadores de Datos
// ==========================================================================

import { dbSalidas, dbInventario, dbInsumos, dbAreas, dbCategorias } from './db.js';

let initializedFilters = false;

// Poblar los combos de segmentación dinámicamente al abrir analíticas
function populateFiltersDropdowns() {
    const areaSelect = document.getElementById("ana-filter-area");
    const categorySelect = document.getElementById("ana-filter-category");

    if (!areaSelect || !categorySelect) return;

    // Poblar Áreas
    areaSelect.innerHTML = `<option value="">Todas las Áreas</option>`;
    dbAreas.forEach(area => {
        const opt = document.createElement("option");
        opt.value = area;
        opt.textContent = area;
        areaSelect.appendChild(opt);
    });

    // Poblar Categorías
    categorySelect.innerHTML = `<option value="">Todas las Categorías</option>`;
    dbCategorias.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        categorySelect.appendChild(opt);
    });

    initializedFilters = true;
}

export function renderAnalyticsDashboard() {
    // 1. Inicializar selectores de filtros si no se ha hecho
    if (!initializedFilters) {
        populateFiltersDropdowns();
    }

    // 2. Obtener valores de los segmentadores activos
    const selectedArea = document.getElementById("ana-filter-area")?.value || "";
    const selectedCategory = document.getElementById("ana-filter-category")?.value || "";
    const startDateVal = document.getElementById("ana-filter-start-date")?.value || "";
    const endDateVal = document.getElementById("ana-filter-end-date")?.value || "";

    const startDate = startDateVal ? new Date(startDateVal + "T00:00:00") : null;
    const endDate = endDateVal ? new Date(endDateVal + "T23:59:59") : null;

    // 3. Filtrar las transacciones de salida (dbSalidas) en caliente según segmentadores
    const filteredDeliveries = [];
    let filteredEPPsCount = 0;
    let totalDeliveriesCount = 0;
    let criticalDeviations = 0;

    dbSalidas.forEach(del => {
        // Filtro por Área
        if (selectedArea && del.area !== selectedArea) return;

        // Filtro por Fecha
        const delDate = new Date(del.fecha);
        if (startDate && delDate < startDate) return;
        if (endDate && delDate > endDate) return;

        // Filtrar los items individuales de la salida por categoría si se requiere
        const matchingItems = del.items.filter(item => {
            if (!selectedCategory) return true;
            const eppDef = dbInventario.find(i => i.id === item.eppId);
            return eppDef && eppDef.categoria === selectedCategory;
        });

        if (matchingItems.length > 0) {
            filteredDeliveries.push({
                ...del,
                items: matchingItems
            });

            matchingItems.forEach(item => {
                filteredEPPsCount += Number(item.cantidad);
                totalDeliveriesCount++;

                // Validar desviación contra historial anterior
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
                        criticalDeviations++;
                    }
                }
            });
        }
    });

    const deviationRate = totalDeliveriesCount > 0 ? Math.round((criticalDeviations / totalDeliveriesCount) * 100) : 0;

    // Calcular SLA de requerimientos (Filtro de área aplicado si es posible)
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
    document.getElementById("ana-kpi-total").textContent = filteredEPPsCount;
    document.getElementById("ana-kpi-deviation").textContent = `${deviationRate}%`;
    document.getElementById("ana-kpi-sla").textContent = `${slaCompliance}%`;

    // 4. Dibujar Gráficos Dinámicos
    renderAreaChart(filteredDeliveries);
    renderAlertsDonutChart(criticalDeviations, totalDeliveriesCount);
    renderSeasonalityLineChart(filteredDeliveries);

    // 5. Renderizar Tablas
    renderObservedCollaborators(filteredDeliveries);
    renderRunwayAutonomyTable(selectedCategory);
}
window.renderAnalyticsDashboard = renderAnalyticsDashboard;

function renderAreaChart(filteredDeliveries) {
    const container = document.getElementById("analytics-area-chart-container");
    if (!container) return;

    const areaCounts = {};
    filteredDeliveries.forEach(del => {
        const area = del.area || "Desconocida";
        let qty = 0;
        del.items.forEach(it => qty += Number(it.cantidad));
        areaCounts[area] = (areaCounts[area] || 0) + qty;
    });

    const areas = Object.keys(areaCounts);
    if (areas.length === 0) {
        container.innerHTML = `<span style="font-size:0.9rem; color:var(--text-muted);">No hay datos de consumo para los filtros seleccionados.</span>`;
        return;
    }

    const maxVal = Math.max(...Object.values(areaCounts), 1);
    let barsHTML = "";
    const chartHeight = 200;
    const chartWidth = 360;
    const barWidth = 35;
    const spacing = 18;

    areas.forEach((area, index) => {
        const value = areaCounts[area];
        const barHeight = (value / maxVal) * (chartHeight - 40);
        const x = index * (barWidth + spacing) + 30;
        const y = chartHeight - barHeight - 25;

        barsHTML += `
            <g class="bar-group" style="cursor:pointer;">
                <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="var(--color-primary)" rx="4" opacity="0.8">
                    <title>${area}: ${value} EPPs</title>
                </rect>
                <text x="${x + barWidth / 2}" y="${chartHeight - 5}" font-size="9" fill="var(--text-secondary)" text-anchor="middle">${area.substring(0, 7)}..</text>
                <text x="${x + barWidth / 2}" y="${y - 6}" font-size="10" font-weight="700" fill="var(--text-primary)" text-anchor="middle">${value}</text>
            </g>
        `;
    });

    container.innerHTML = `
        <svg width="${chartWidth}" height="${chartHeight}" style="background:transparent; overflow:visible;">
            ${barsHTML}
            <line x1="10" y1="${chartHeight - 20}" x2="${chartWidth}" y2="${chartHeight - 20}" stroke="var(--border-color)" stroke-width="1"/>
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
        <div style="display:flex; align-items:center; gap:20px;">
            <svg width="150" height="150" viewBox="0 0 150 150">
                <circle cx="75" cy="75" r="${radius}" fill="transparent" stroke="var(--border-color)" stroke-width="15" />
                <circle cx="75" cy="75" r="${radius}" fill="transparent" stroke="var(--color-success)" stroke-width="15" 
                        stroke-dasharray="${circumference}" stroke-dashoffset="${(normalPct / 100) * circumference}"
                        transform="rotate(-90 75 75)" style="transition: stroke-dashoffset 0.8s;"/>
                <circle cx="75" cy="75" r="${radius}" fill="transparent" stroke="var(--color-danger)" stroke-width="15" 
                        stroke-dasharray="${circumference}" stroke-dashoffset="${criticalOffset}"
                        transform="rotate(${(normalPct/100)*360 - 90} 75 75)" style="transition: stroke-dashoffset 0.8s;"/>
                <text x="75" y="80" text-anchor="middle" font-size="14" font-weight="800" fill="var(--text-primary)">
                    ${criticalPct}% Alertas
                </text>
            </svg>
            <div style="font-size:0.85rem; display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="display:inline-block; width:12px; height:12px; border-radius:3px; background:var(--color-success);"></span>
                    <span>Consumo Correcto (${normalPct}%)</span>
                </div>
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="display:inline-block; width:12px; height:12px; border-radius:3px; background:var(--color-danger);"></span>
                    <span>Desviaciones Críticas (${criticalPct}%)</span>
                </div>
            </div>
        </div>
    `;
}

function renderSeasonalityLineChart(filteredDeliveries) {
    const container = document.getElementById("analytics-seasonality-chart-container");
    if (!container) return;

    // Agrupar cantidades por año-mes
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
    const minVal = 0;

    const graphWidth = chartWidth - paddingLeft - paddingRight;
    const graphHeight = chartHeight - paddingTop - paddingBottom;

    // Trazar puntos de coordenadas
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
    // Líneas de cuadrícula horizontal
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
            <circle cx="${pt.x}" cy="${pt.y}" r="5" class="chart-point">
                <title>Período: ${pt.month}\nConsumo: ${pt.val} EPPs</title>
            </circle>
        `;
        labelsHTML += `
            <text x="${pt.x}" y="${chartHeight - paddingBottom + 18}" font-size="9" fill="var(--text-secondary)" text-anchor="middle" transform="rotate(-15 ${pt.x} ${chartHeight - paddingBottom + 18})">
                ${pt.month}
            </text>
        `;
    });

    container.innerHTML = `
        <svg width="100%" height="${chartHeight}" viewBox="0 0 ${chartWidth} ${chartHeight}" style="background:transparent; overflow:visible;">
            ${gridLinesHTML}
            <path d="${pathD}" class="chart-line"/>
            ${pointsHTML}
            ${labelsHTML}
            <!-- Eje base -->
            <line x1="${paddingLeft}" y1="${chartHeight - paddingBottom}" x2="${chartWidth - paddingRight}" y2="${chartHeight - paddingBottom}" stroke="var(--border-color)" stroke-width="1.5"/>
        </svg>
    `;
}

function renderObservedCollaborators(filteredDeliveries) {
    const tbody = document.getElementById("analytics-deviations-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";
    const userEPPMetrics = {};

    filteredDeliveries.forEach(del => {
        const workerKey = `${del.rut}_${del.trabajador}_${del.area}`;
        del.items.forEach(item => {
            const key = `${workerKey}_${item.eppId}`;
            if (!userEPPMetrics[key]) {
                userEPPMetrics[key] = {
                    rut: del.rut,
                    trabajador: del.trabajador,
                    area: del.area,
                    eppId: item.eppId,
                    eppName: item.nombre,
                    entregas: [],
                };
            }
            userEPPMetrics[key].entregas.push(new Date(del.fecha));
        });
    });

    const observedList = [];
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
            observedList.push({
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

    if (observedList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">No se detectan colaboradores con desgaste prematuro para los filtros actuales.</td></tr>`;
        return;
    }

    observedList.sort((a, b) => a.avgDays - b.avgDays);

    observedList.forEach(obs => {
        const tr = document.createElement("tr");
        tr.className = "observed-row-clickable";
        tr.title = "Haga clic para auditar la ficha de este colaborador";
        
        // Redirección directa al hacer clic
        tr.addEventListener("click", () => {
            const searchInput = document.getElementById("worker-search-rut");
            if (searchInput) {
                searchInput.value = obs.rut;
                window.switchView("view-workers");
                setTimeout(() => {
                    window.searchWorkerProfile();
                }, 150);
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
}

function renderRunwayAutonomyTable(selectedCategory) {
    const tbody = document.getElementById("analytics-runway-tbody");
    if (!tbody) return;

    tbody.innerHTML = "";

    // 1. Calcular el ritmo de consumo histórico por SKU
    // Mapeo SKU -> total entregados
    const consumedSKU = {};
    dbSalidas.forEach(del => {
        del.items.forEach(it => {
            consumedSKU[it.eppId] = (consumedSKU[it.eppId] || 0) + Number(it.cantidad);
        });
    });

    // Encontrar el período completo de transacciones en días para sacar promedio
    let minDate = new Date();
    let maxDate = new Date(0);
    dbSalidas.forEach(del => {
        const d = new Date(del.fecha);
        if (d < minDate) minDate = d;
        if (d > maxDate) maxDate = d;
    });

    const elapsedDays = Math.max(1, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)));

    const runwayList = [];

    dbInventario.forEach(item => {
        // Filtrar por categoría seleccionada si aplica
        if (selectedCategory && item.categoria !== selectedCategory) return;

        const totalUsed = consumedSKU[item.id] || 0;
        // Consumo promedio diario de este SKU
        const dailyConsumption = totalUsed / elapsedDays;

        const currentStock = Number(item.stock || 0);
        let runwayDays = 999; // Por defecto asumimos autonomía ilimitada si no hay consumo
        
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

        runwayList.push({
            nombre: item.nombre,
            codigo: item.codigo,
            stock: currentStock,
            runwayDays: runwayDays,
            runwayText: runwayText,
            badgeClass: badgeClass,
            riskText: riskText
        });
    });

    // Ordenar de mayor a menor urgencia de abastecimiento
    runwayList.sort((a, b) => a.runwayDays - b.runwayDays);

    // Renderizar los SKUs
    runwayList.slice(0, 7).forEach(r => {
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

    if (runwayList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding:20px;">Sin inventario cargado.</td></tr>`;
    }
}
