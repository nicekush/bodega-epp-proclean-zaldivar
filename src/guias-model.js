import { serializeAnalyticsCSV } from './analytics-export.js';

export const GUIA_STATES = Object.freeze({
    PENDIENTE: 'Por despachar', EN_TRANSITO: 'En ruta', ENTREGADA: 'Entregada conforme', ANULADA: 'Anulada'
});
export const GUIA_UNITS = ['UN', 'GL', 'CJ', 'LT', 'KG', 'PAR'];
export const normalizeGuiaText = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
export const escapeGuiaHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const isGuiaManager = user => ['Administrador', 'Supervisor'].includes(user?.rol);
export const canEditGuia = guia => guia?.estado === 'PENDIENTE';
export const canAnnulGuia = (guia, user) => isGuiaManager(user) && ['PENDIENTE', 'EN_TRANSITO'].includes(guia?.estado);

export function localGuiaDate(value = new Date()) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function selectGuias(guias, filters = {}) {
    if (filters.start && filters.end && filters.start > filters.end) return [];
    const query = normalizeGuiaText(filters.query);
    const exactFolio = /^#\d+$/.test(query) ? Number(query.slice(1)) : null;
    const tokens = query.split(/\s+/).filter(Boolean);
    return guias.filter(guia => {
        if (filters.state && filters.state !== 'ALL' && guia.estado !== filters.state) return false;
        if (filters.start && (!guia.fecha || guia.fecha < filters.start)) return false;
        if (filters.end && (!guia.fecha || guia.fecha > filters.end)) return false;
        if (filters.destination && guia.lugar_entrega !== filters.destination) return false;
        if (filters.driver && guia.chofer !== filters.driver) return false;
        if (filters.vehicle && guia.vehiculo !== filters.vehicle) return false;
        if (exactFolio !== null) return Number(guia.folio) === exactFolio;
        const text = normalizeGuiaText([guia.folio, guia.lugar_entrega, guia.chofer, guia.vehiculo, guia.patente,
            guia.emisor_nombre, guia.receptor_nombre, guia.receptor_rut, guia.observaciones,
            ...(guia.items || []).map(item => `${item.articulo || ''} ${item.descripcion || ''} ${item.observacion || ''}`)].join(' '));
        return tokens.every(token => text.includes(token));
    }).sort((a, b) => Number(b.folio) - Number(a.folio));
}

export function validateGuia(guia, items) {
    if (!String(guia.lugar_entrega || '').trim()) throw new Error('Indica el destino de la carga.');
    const date = new Date(`${guia.fecha}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(guia.fecha || '') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== guia.fecha) throw new Error('Indica una fecha de emisión válida.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(guia.hora || '')) throw new Error('Indica una hora válida.');
    if (!String(guia.chofer || '').trim() || !String(guia.vehiculo || '').trim()) throw new Error('Indica chofer y vehículo.');
    if (!Array.isArray(items) || items.length < 1 || items.length > 500) throw new Error('La carga debe contener entre 1 y 500 artículos.');
    for (const item of items) {
        if (!String(item.descripcion || '').trim()) throw new Error('Completa la descripción de cada artículo.');
        if (!Number.isFinite(Number(item.cantidad)) || Number(item.cantidad) <= 0 || Number(item.cantidad) > 1e9) throw new Error('Las cantidades deben ser positivas y válidas.');
        if (!GUIA_UNITS.includes(item.unidad)) throw new Error('Selecciona una unidad válida para cada artículo.');
    }
}

export function guiaTiming(guia, now = new Date()) {
    const elapsed = (start, end) => {
        if (!start || !end) return null;
        const hours = (new Date(end) - new Date(start)) / 3600000;
        return Number.isFinite(hours) ? Math.round(Math.max(0, hours) * 100) / 100 : null;
    };
    return {
        pendingHours: guia.estado === 'PENDIENTE' ? elapsed(guia.created_at, now) : null,
        transitHours: guia.estado === 'EN_TRANSITO' ? elapsed(guia.despachado_at, now) : null,
        deliveryHours: guia.estado === 'ENTREGADA' ? elapsed(guia.despachado_at, guia.receptor_fecha) : null
    };
}

export function buildGuiasCSV(guias, filters = {}, generatedAt = new Date()) {
    const headers = ['ID guía', 'Folio', 'Fecha emisión', 'Hora', 'Estado', 'Destino', 'Chofer', 'Vehículo', 'Patente',
        'Emisor', 'Código artículo', 'Descripción artículo', 'Cantidad', 'Unidad', 'Observación artículo', 'Observaciones guía',
        'Fecha inicio de ruta', 'Receptor', 'RUT receptor', 'Fecha recepción', 'Firma registrada', 'Motivo anulación',
        'Creada por', 'Fecha creación', 'Última actualización', 'Horas pendientes', 'Horas en ruta', 'Horas despacho a recepción',
        'Exportado el (ISO)', 'Filtros aplicados'];
    const selected = selectGuias(guias, filters);
    const context = JSON.stringify(filters);
    const rows = selected.flatMap(guia => {
        const timing = guiaTiming(guia, generatedAt);
        return (guia.items?.length ? guia.items : [{}]).map(item => [
            guia.id, guia.folio, guia.fecha, guia.hora, GUIA_STATES[guia.estado] || guia.estado, guia.lugar_entrega,
            guia.chofer, guia.vehiculo, guia.patente, guia.emisor_nombre, item.articulo, item.descripcion,
            item.cantidad == null ? '' : Number(item.cantidad), item.unidad, item.observacion, guia.observaciones,
            guia.despachado_at, guia.receptor_nombre, guia.receptor_rut, guia.receptor_fecha,
            guia.firma_digital ? 'Sí' : 'No', guia.motivo_anulacion, guia.created_by, guia.created_at, guia.updated_at,
            timing.pendingHours, timing.transitHours, timing.deliveryHours, generatedAt.toISOString(), context
        ]);
    });
    return serializeAnalyticsCSV([{ id: 'guias', headers, rows }], 'guias');
}
