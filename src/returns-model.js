// Saldos derivados: las cantidades y firmas del acta original nunca se editan.
export const rutKey = value => String(value || '').replace(/[^0-9kK]/g, '').toUpperCase();
const same = (a, b) => String(a) === String(b);
const time = value => value == null ? Infinity : new Date(value).getTime();
const precise = value => Number(value.toPrecision(15));

export function deliveryBalances(delivery, returns = [], cutoff = null) {
    const totals = new Map();
    for (const record of returns) {
        if (!same(record.salida_id, delivery.id) || time(record.fecha) > time(cutoff)) continue;
        for (const item of record.items || []) {
            totals.set(item.linea, precise((totals.get(item.linea) || 0) + Number(item.cantidad)));
        }
    }
    return (delivery.items || []).map((item, linea) => {
        const entregado = Number(item.cantidad);
        const devuelto = totals.get(linea) || 0;
        return { ...item, linea, entregado, devuelto, saldo: Math.max(0, precise(entregado - devuelto)) };
    });
}

export function netDeliveries(deliveries, returns, cutoff = new Date()) {
    return deliveries.filter(delivery => time(delivery.fecha) <= time(cutoff)).map(delivery => ({
        ...delivery,
        items: deliveryBalances(delivery, returns, cutoff)
            .filter(item => item.saldo > 0).map(item => ({ ...item, cantidad: item.saldo }))
    })).filter(delivery => delivery.items.length);
}

export function previousNetDelivery(deliveries, returns, delivery, eppId) {
    const rut = rutKey(delivery.rut);
    if (!rut) return null;
    return netDeliveries(deliveries, returns, delivery.fecha)
        .filter(row => rutKey(row.rut) === rut && time(row.fecha) < time(delivery.fecha)
            && row.items.some(item => same(item.eppId, eppId)))
        .sort((a, b) => time(b.fecha) - time(a.fecha))[0] || null;
}

export function validateReturnItems(items, balances) {
    if (!Array.isArray(items) || !items.length) throw new Error('Selecciona al menos una cantidad para devolver.');
    const seen = new Set();
    for (const item of items) {
        if (!Number.isInteger(item.linea) || seen.has(item.linea)) throw new Error('La línea de entrega no es válida o está repetida.');
        seen.add(item.linea);
        const balance = balances.find(row => row.linea === item.linea);
        if (!balance || !Number.isFinite(item.cantidad) || item.cantidad <= 0 || item.cantidad > balance.saldo) {
            throw new Error('La cantidad debe ser mayor que cero y no superar el saldo por devolver.');
        }
    }
    return items.map(({ linea, cantidad }) => {
        const balance = balances.find(row => row.linea === linea);
        return { linea, cantidad, eppId: String(balance.eppId), entregado: balance.entregado };
    });
}
