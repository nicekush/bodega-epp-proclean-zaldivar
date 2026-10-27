// Datos y serialización del reporte. No depende del DOM ni consulta la base de datos.
import { outflowSignatureLabel } from './outflow-signatures.js';
const DAY_MS = 86400000;
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
const numberOrNull = value => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
const rutKey = value => String(value || '').replace(/[.\s-]/g, '').toUpperCase();
const uniqueText = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'es')).join(' | ');

function dateOrNull(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function formatExportDate(value) {
    const date = dateOrNull(value);
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function stats(rows) {
    return {
        quantity: round(rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0)),
        deliveries: new Set(rows.map(row => row.deliveryKey)).size,
        operators: new Set(rows.map(row => row.rutKey).filter(Boolean)).size,
        products: new Set(rows.map(row => row.productKey)).size,
        critical: rows.filter(row => row.isCritical).length
    };
}

function groupRows(rows, keyOf) {
    const groups = new Map();
    rows.forEach(row => {
        const key = JSON.stringify(keyOf(row));
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });
    return [...groups.values()];
}

function frequency(rows) {
    const datesByDelivery = new Map();
    rows.forEach(row => {
        if (row.date) datesByDelivery.set(row.deliveryKey, row.date);
    });
    const dates = [...datesByDelivery.values()].sort((a, b) => a - b);
    const intervals = dates.slice(1).map((date, i) => (date - dates[i]) / DAY_MS);
    return {
        first: dates[0] ? formatExportDate(dates[0]) : '',
        last: dates.length ? formatExportDate(dates.at(-1)) : '',
        average: intervals.length ? round(intervals.reduce((sum, days) => sum + days, 0) / intervals.length) : '',
        minimum: intervals.length ? round(intervals.reduce((minimum, days) => Math.min(minimum, days), Infinity)) : ''
    };
}

function flattenDeliveries(deliveries, catalog) {
    return deliveries.flatMap((delivery, deliveryIndex) => (delivery.items || []).map((item, itemIndex) => {
        const product = catalog.get(String(item.eppId));
        const analysis = item.analytics || {};
        const id = String(delivery.id ?? '');
        const workerRut = rutKey(delivery.rut);
        const quantity = numberOrNull(item.cantidad);
        const date = dateOrNull(delivery.fecha);
        return {
            deliveryKey: deliveryIndex, id,
            folio: delivery.folio || delivery.codigo || (id ? `ACTA-${id.split('-')[1] || id}` : ''),
            line: (item.linea ?? itemIndex) + 1, date, recordedDate: delivery.fecha || '',
            rut: delivery.rut || '', rutKey: workerRut,
            // Sin RUT no se fusionan personas por coincidencia de nombre.
            workerKey: workerRut || `sin-rut-acta-${deliveryIndex}`,
            worker: delivery.trabajador || 'Sin nombre',
            area: delivery.area || 'Sin área', shift: delivery.turno || 'Sin turno',
            productKey: String(item.eppId ?? `sin-id-${item.codigo || item.nombre || itemIndex}`),
            productId: item.eppId ?? '', code: product?.codigo || item.codigo || '',
            product: product?.nombre || item.nombre || 'EPP sin catálogo',
            category: product?.categoria || item.categoria || 'Sin categoría',
            unit: product?.unidad || item.unidad || 'Sin unidad',
            quantity, recordedQuantity: item.cantidad ?? '', catalogued: Boolean(product),
            gross: item.entregado ?? item.cantidad ?? '', returned: item.devuelto ?? 0,
            previousDate: analysis.previousDeliveryDate || '',
            daysSincePrevious: analysis.daysSincePrevious ?? '',
            lifespanDays: analysis.lifespanDays ?? '',
            isCritical: Boolean(analysis.isCritical),
            status: analysis.isCritical ? 'Alerta crítica' : analysis.previousDeliveryDate ? 'Sin alerta por frecuencia' : 'Sin antecedente',
            reason: delivery.motivo_entrega || '', size: delivery.talla_ropa || '',
            clothingReason: delivery.razon_cambio_ropa || '', comments: delivery.comentarios || '',
            registeredBy: delivery.registrado_por || '',
            signature: outflowSignatureLabel(delivery),
            quality: [!date && 'Fecha inválida o ausente', !workerRut && 'Sin RUT', !product && 'SKU fuera del catálogo',
                quantity === null && 'Cantidad no numérica', quantity !== null && quantity <= 0 && 'Cantidad no positiva']
                .filter(Boolean).join(' | ')
        };
    }));
}

export function buildAnalyticsExportSections({
    deliveries = [], inventory = [], requests = [], observed = [], runway = [],
    filters = {}, alertContext = {}, generatedAt = new Date(), sourceDeliveriesCount = deliveries.length,
    originalDeliveries = deliveries, returns = [], cutoff = generatedAt.toISOString()
} = {}) {
    const catalog = new Map(inventory.map(item => [String(item.id), item]));
    const rows = flattenDeliveries(deliveries, catalog);
    const totals = stats(rows);
    const productFilter = catalog.get(String(filters.product));
    const filterEntries = [
        ['Desde', filters.startDate || 'Sin límite'], ['Hasta', filters.endDate || 'Sin límite'],
        ['Área', filters.area || 'Todas'], ['Categoría', filters.category || 'Todas'],
        ['SKU', filters.product ? `${productFilter?.codigo || filters.product} - ${productFilter?.nombre || 'Sin catálogo'}` : 'Todos'],
        ['Turno', filters.shift || 'Todos'], ['Operador / RUT (búsqueda)', filters.worker || 'Todos'],
        ['Estado de alerta', filters.alert === 'critical' ? 'Crítico' : filters.alert === 'normal' ? 'Sin alerta crítica' : 'Todos']
    ];
    const filterDescription = filterEntries.map(([key, value]) => `${key}: ${value}`).join(' | ');
    const generatedText = generatedAt.toISOString();
    const traceHeaders = ['Exportado el (ISO)', 'Filtros aplicados'];
    const table = (id, title, headers, data, trace = false) => ({
        id, title,
        headers: trace ? [...headers, ...traceHeaders] : headers,
        rows: trace ? data.map(row => [...row, generatedText, filterDescription]) : data
    });
    const detailHeaders = [
        'ID acta', 'Referencia acta', 'Línea exportada del acta', 'Fecha/hora registrada', 'Fecha local', 'RUT', 'Operador',
        'Área', 'Turno', 'ID EPP', 'Código SKU', 'EPP', 'Categoría', 'Unidad', 'Cantidad',
        'Entrega anterior (historial completo)', 'Días desde entrega anterior', 'Vida útil de referencia (días)',
        'Estado de frecuencia', 'Motivo de entrega', 'Talla', 'Razón cambio de ropa', 'Comentarios',
        'Registrado por', 'Registro de firma', 'Observaciones de datos', 'Entregado original', 'Devuelto sin uso al corte', 'Fecha de corte del saldo'
    ];
    const detailValues = row => [
        row.id, row.folio, row.line, row.recordedDate, row.date ? formatExportDate(row.date) : '', row.rut, row.worker,
        row.area, row.shift, row.productId, row.code, row.product, row.category, row.unit,
        row.quantity ?? row.recordedQuantity, row.previousDate, row.daysSincePrevious, row.lifespanDays,
        row.status, row.reason, row.size, row.clothingReason, row.comments, row.registeredBy, row.signature, row.quality,
        row.gross, row.returned, cutoff
    ];
    // El informe se ordena cronológicamente sin modificar el orden de las tablas en pantalla.
    const chronologicalRows = [...rows].sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity));
    const sections = [
        table('metadata', 'CONTEXTO DEL INFORME', ['Campo', 'Valor'], [
            ['Generado el (ISO)', generatedText], ['Zona horaria de fechas locales', Intl.DateTimeFormat().resolvedOptions().timeZone],
            ...filterEntries,
            ['Fuente', 'Datos cargados en la sesión de Bodega EPP; exportación sin límite de páginas de la interfaz'],
            ['Actas cargadas en sesión', sourceDeliveriesCount],
            ['Criterio de cantidades', 'Entrega neta: original menos devoluciones sin uso aceptadas hasta el corte. No acredita consumo físico. Actas agrupadas por fecha original.'],
            ['Fecha de corte de saldos', cutoff],
            ['Comparación temporal', 'Cada período se calcula con las devoluciones recibidas hasta su propio cierre.'],
            ['Movimientos de devolución', 'Sección separada por fecha de recepción; filtros de persona, área, turno, categoría y SKU. El filtro de alerta corresponde solo a entregas.'],
            ['Regla de alerta', 'Intervalo inferior al 50% de la vida útil; antecedente con saldo según devoluciones conocidas a la fecha de la entrega evaluada'],
            ['Frecuencia del ranking', 'Intervalos entre actas del mismo operador/EPP incluidas en la selección; vacío si hay menos de dos fechas válidas'],
            ['Unidades', 'Cantidades según unidad del catálogo; sin conversión entre pares, cajas u otras unidades'],
            ['Participación del operador', 'Porcentaje de la cantidad del mismo EPP en la selección exportada'],
            ['Identidad del operador', 'RUT sin puntos, espacios ni guion para agrupar; actas sin RUT se mantienen separadas'],
            ['Catálogo y stock', 'Valores actuales de referencia; no corresponden necesariamente a la fecha de la entrega'],
            ['Requerimientos', 'Alcance del panel actual: filtros de área y fechas de solicitud; no aplica SKU, categoría, turno, operador ni alerta'],
            ['Cobertura de stock', 'Todo el historial cargado y categoría seleccionada; cantidades netas actuales por entrega, mínimo cero. No aplica los demás filtros. Base diaria: cantidad histórica neta / días entre primera y última entrega, mínimo un día'],
            ['Colaboradores observados', 'Tabla del panel: promedio de las entregas filtradas inferior al 55% de la vida útil; criterio distinto de alertas por evento'],
            ['Datos no registrados', 'Campos vacíos; no se infieren motivos, firmas ni fechas'],
            ['Cantidades inválidas', 'Se conservan en el detalle y se excluyen de las sumas si no son numéricas']
        ]),
        table('summary', 'RESUMEN DE LA SELECCIÓN', ['Indicador', 'Valor'], [
            ['Actas distintas', totals.deliveries], ['Líneas de EPP', rows.length],
            ['Operadores identificados por RUT', totals.operators], ['EPP distintos', totals.products],
            ['Líneas sin RUT', rows.filter(row => !row.rutKey).length],
            ['Alertas críticas en la selección exportada', totals.critical],
            ['Líneas sin antecedente', rows.filter(row => !row.previousDate).length],
            ['Alertas del contexto antes del filtro de estado', alertContext.critical ?? ''],
            ['Líneas del contexto antes del filtro de estado', alertContext.total ?? ''],
            ['Líneas con observaciones de datos', rows.filter(row => row.quality).length],
            ...groupRows(rows, row => [row.unit]).map(group => [`Cantidad despachada (${group[0].unit})`, stats(group).quantity])
        ]),
        table('deliveries', 'HISTORIAL DETALLADO DE ENTREGAS NETAS', detailHeaders, chronologicalRows.map(detailValues), true)
    ];
    const originals = flattenDeliveries(originalDeliveries, catalog);
    sections.push(table('originals', 'ENTREGAS ORIGINALES DEL PERÍODO (INCLUYE LAS TOTALMENTE DEVUELTAS; SIN FILTRO DE ALERTA)',
        ['ID acta', 'Fecha de entrega', 'RUT', 'Colaborador', 'SKU', 'Producto', 'Cantidad original', 'Devuelto sin uso al corte', 'Entrega neta al corte', 'Unidad', 'Fecha de corte'],
        originals.map(row => [row.id, row.recordedDate, row.rut, row.worker, row.code, row.product, row.gross, row.returned, Number(row.gross) - Number(row.returned), row.unit, cutoff]), true));
    const returnRows = returns.filter(record => {
        const received = dateOrNull(record.fecha);
        if (!received || received > new Date(cutoff)) return false;
        if (filters.startDate && received < new Date(filters.startDate + 'T00:00:00')) return false;
        if (filters.endDate && received > new Date(filters.endDate + 'T23:59:59.999')) return false;
        if (filters.area && record.area !== filters.area || filters.shift && record.turno !== filters.shift) return false;
        const query = (filters.worker || '').toLowerCase();
        return !query || (record.trabajador || '').toLowerCase().includes(query) || (record.rut || '').toLowerCase().includes(query);
    }).flatMap(record => (record.items || []).filter(item => {
        if (filters.product && String(item.eppId) !== String(filters.product)) return false;
        return !filters.category || catalog.get(String(item.eppId))?.categoria === filters.category;
    }).map(item => [record.id, record.salida_id, record.fecha, record.rut, record.trabajador, record.area, record.turno,
        item.codigo, item.nombre, item.cantidad, item.unidad, record.motivo, record.notas, record.registrado_por]));
    sections.push(table('returns', 'DEVOLUCIONES RECIBIDAS EN EL PERÍODO',
        ['ID devolución', 'Acta original', 'Fecha de recepción', 'RUT', 'Colaborador', 'Área', 'Turno', 'SKU', 'Producto', 'Cantidad devuelta', 'Unidad', 'Motivo', 'Observaciones', 'Recibido por'], returnRows, true));

    const byProduct = groupRows(rows, row => [row.productKey]);
    const ranking = byProduct.flatMap(productRows => {
        const productTotal = stats(productRows).quantity;
        return groupRows(productRows, row => [row.workerKey])
            .sort((a, b) => stats(b).quantity - stats(a).quantity || stats(b).deliveries - stats(a).deliveries || a[0].worker.localeCompare(b[0].worker, 'es'))
            .map((group, i) => {
                const first = group[0];
                const latest = [...group].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))[0];
                const metrics = stats(group);
                const dates = frequency(group);
                return [i + 1, first.productId, first.code, first.product, first.category, first.unit, latest.rut, latest.worker,
                    uniqueText(group.map(row => row.area)), uniqueText(group.map(row => row.shift)),
                    metrics.quantity, metrics.deliveries, round(metrics.quantity / metrics.deliveries),
                    productTotal ? round(metrics.quantity / productTotal * 100) : '', dates.first, dates.last,
                    dates.average, dates.minimum, metrics.critical];
            });
    });
    sections.push(table('operators', 'CONSUMO POR OPERADOR Y EPP — RANKING DENTRO DE CADA EPP', [
        'Posición dentro del EPP', 'ID EPP', 'Código SKU', 'EPP', 'Categoría', 'Unidad', 'RUT', 'Operador',
        'Áreas registradas', 'Turnos registrados', 'Cantidad recibida', 'Actas distintas', 'Cantidad media por acta',
        'Participación en cantidad del EPP (%)', 'Primera entrega de la selección', 'Última entrega de la selección',
        'Intervalo medio entre actas seleccionadas (días)', 'Intervalo mínimo entre actas seleccionadas (días)', 'Alertas críticas'
    ], ranking, true));

    const productSummary = byProduct.map(group => {
        const first = group[0];
        const product = catalog.get(String(first.productId));
        const metrics = stats(group);
        const dates = frequency(group);
        return [first.productId, first.code, first.product, first.category, first.unit, metrics.quantity,
            metrics.deliveries, metrics.operators, dates.first, dates.last, metrics.critical,
            product ? numberOrNull(product.stock) : '', product ? numberOrNull(product.stock_minimo) : '',
            product ? numberOrNull(product.duracion_meses) : '', group.filter(row => !row.rutKey).length];
    }).sort((a, b) => b[5] - a[5]);
    sections.push(table('products', 'RESUMEN DE CONSUMO POR EPP', [
        'ID EPP', 'Código SKU', 'EPP', 'Categoría', 'Unidad', 'Cantidad despachada', 'Actas distintas',
        'Operadores identificados', 'Primera entrega de la selección', 'Última entrega de la selección',
        'Alertas críticas', 'Stock actual (referencia)', 'Stock mínimo actual', 'Vida útil actual (meses)', 'Líneas sin RUT'
    ], productSummary, true));

    const dimensionHeaders = ['Unidad', 'Cantidad despachada', 'Actas distintas', 'Operadores identificados', 'EPP distintos', 'Alertas críticas'];
    for (const [id, title, label, keyOf] of [
        ['areas', 'CONSUMO POR ÁREA', 'Área', row => row.area],
        ['shifts', 'CONSUMO POR TURNO', 'Turno', row => row.shift],
        ['categories', 'CONSUMO POR CATEGORÍA', 'Categoría', row => row.category],
        ['months', 'EVOLUCIÓN MENSUAL DE ENTREGAS', 'Mes local', row => row.date ? formatExportDate(row.date).slice(0, 7) : 'Sin fecha válida'],
        ['reasons', 'CONSUMO POR MOTIVO DE ENTREGA', 'Motivo', row => row.reason || 'No registrado']
    ]) {
        const data = groupRows(rows, row => [keyOf(row), row.unit]).map(group => {
            const metrics = stats(group);
            return [keyOf(group[0]), group[0].unit, metrics.quantity, metrics.deliveries, metrics.operators, metrics.products, metrics.critical];
        }).sort((a, b) => id === 'months' ? a[0].localeCompare(b[0], 'es') : b[2] - a[2]);
        sections.push(table(id, title, [label, ...dimensionHeaders], data));
    }
    sections.push(table('alerts', 'ENTREGAS CON ALERTA CRÍTICA EN LA SELECCIÓN', detailHeaders,
        chronologicalRows.filter(row => row.isCritical).map(detailValues)));
    sections.push(table('observed', 'COLABORADORES OBSERVADOS — PROMEDIO DEL PANEL (UMBRAL 55%)', [
        'Operador', 'RUT', 'Área', 'EPP', 'Entregas registradas', 'Intervalo promedio (días)', 'Vida útil esperada (días)'
    ], observed.map(row => [row.trabajador, row.rut, row.area, row.eppName, row.entregasCount, row.avgDays, row.lifespanDays])));
    sections.push(table('requests', 'REQUERIMIENTOS — FILTROS DE ÁREA Y FECHAS DE SOLICITUD', [
        'ID solicitud', 'Código solicitud', 'Fecha de solicitud', 'Operador', 'RUT', 'Área registrada', 'Turno',
        'Prioridad', 'Estado', 'Requerimiento / proyecto', 'Proveedor', 'Artículo solicitado',
        'Cantidad solicitada', 'Cantidad entregada', 'Cantidad pendiente', 'Comentarios'
    ], requests.flatMap(request => (request.items?.length ? request.items : [{}]).map(item => {
        const requested = numberOrNull(item.solicitado);
        const received = numberOrNull(item.recibido);
        return [request.id, request.codigo, request.fecha_solicitud || request.fechaSolicitud, request.trabajador, request.rut,
            request.area_trabajador || request.area, request.turno, request.prioridad, request.estado, request.mejora,
            request.proveedor, item.nombre, requested, received,
            requested !== null && received !== null ? Math.max(0, requested - received) : '', request.comentarios];
    }))));
    sections.push(table('stock', 'COBERTURA DE STOCK DEL PANEL — HISTORIAL COMPLETO Y FILTRO DE CATEGORÍA', [
        'ID EPP', 'Código SKU', 'EPP', 'Categoría', 'Unidad', 'Stock actual', 'Stock mínimo actual',
        'Cantidad entregada en historial', 'Primera entrega de la base global', 'Última entrega de la base global',
        'Días de la base global', 'Consumo diario estimado', 'Cobertura sin redondear a días enteros',
        'Estado de la estimación', 'Autonomía mostrada en panel', 'Riesgo mostrado en panel'
    ], runway.map(row => [row.id, row.codigo, row.nombre, row.categoria, row.unidad, row.stock, row.stockMinimo,
        row.totalUsed, row.firstDeliveryDate, row.lastDeliveryDate, row.elapsedDays, row.dailyConsumption,
        row.dailyConsumption > 0 ? round(row.stock / row.dailyConsumption) : '',
        row.dailyConsumption > 0 ? 'Basada en consumo histórico' : 'Sin consumo observado; cobertura no estimable',
        row.runwayText, row.riskText])));
    return sections;
}

function csvCell(value) {
    if (value == null) return '""';
    // Decimal con coma para Excel en configuración regional española/chilena.
    if (typeof value === 'number') return Number.isFinite(value) ? `"${String(value).replace('.', ',')}"` : '""';
    let text = String(value).replace(/\0/g, '');
    // El contenido de texto se abre como texto, incluso si comienza como una fórmula.
    if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
}

export function serializeAnalyticsCSV(sections, mode = 'complete') {
    let records;
    if (mode === 'complete') {
        records = sections.flatMap(section => [[section.title], section.headers, ...section.rows, []]);
    } else {
        const section = sections.find(item => item.id === mode);
        if (!section) throw new Error(`Tipo de exportación desconocido: ${mode}`);
        // Las tablas independientes empiezan por el encabezado, listas para filtrar o crear tablas dinámicas.
        records = [section.headers, ...section.rows];
    }
    return '\uFEFF' + records.map(record => record.map(csvCell).join(';')).join('\r\n');
}
