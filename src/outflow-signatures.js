const REQUIRED_FIELDS = ['id', 'trabajador', 'rut', 'area', 'fecha', 'items', 'registrado_por'];
const OPTIONAL_FIELDS = ['turno', 'comentarios', 'motivo_entrega', 'talla_ropa', 'razon_cambio_ropa'];
export const hasOutflowSignature = row => Object.prototype.hasOwnProperty.call(row, 'firma');
export function outflowSignatureLabel(row) {
    if (!hasOutflowSignature(row)) return 'Pendiente de consultar en acta';
    if (String(row.firma || '').startsWith('data:')) return 'Firma digital registrada';
    return row.firma || 'Sin firma registrada';
}

export function createOutflowSignaturesRepository(client) {
    let fields = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
    const pending = new Map();

    async function loadSummaries() {
        const rows = [];
        for (let offset = 0; ; ) {
            const { data, error } = await client.from('salidas').select(fields.join(',')).order('id').range(offset, offset + 499);
            if (error) {
                // Compatibilidad con esquemas anteriores: solo se omiten columnas opcionales
                // que el servidor confirma que no existen. Otros errores siguen siendo fatales.
                const absent = ['42703', 'PGRST204'].includes(error.code)
                    && /does not exist|could not find.*column/i.test(error.message || '')
                    && OPTIONAL_FIELDS.find(field => fields.includes(field) && new RegExp(`\\b${field}\\b`).test(error.message || ''));
                if (!absent) throw error;
                fields = fields.filter(field => field !== absent);
                continue;
            }
            if (!Array.isArray(data)) throw new Error('Respuesta inválida al cargar las entregas.');
            rows.push(...data.map(({ firma, ...summary }) => summary));
            if (data.length < 500) return rows;
            offset += 500;
        }
    }

    async function loadSignature(row, { refresh = false } = {}) {
        if (hasOutflowSignature(row) && !refresh) return row;
        const key = String(row.id);
        let request = pending.get(key);
        if (!request) {
            request = (async () => {
                const { data, error } = await client.from('salidas').select('id,firma').eq('id', row.id).single();
                if (error) throw new Error('No fue posible cargar la firma. Reintenta antes de imprimir.');
                if (!data || String(data.id) !== key || !hasOutflowSignature(data)
                    || !(data.firma === null || typeof data.firma === 'string')) {
                    throw new Error('El servidor no confirmó la firma del acta. Reintenta antes de imprimir.');
                }
                return data.firma;
            })();
            pending.set(key, request);
            request.finally(() => { if (pending.get(key) === request) pending.delete(key); }).catch(() => {});
        }
        row.firma = await request;
        return row;
    }
    return { loadSummaries, loadSignature };
}
