export function createReturnsRepository(client, getUser) {
    const state = { records: [], ready: false, error: '' };
    async function load() {
        try {
            const records = [];
            for (let offset = 0; ; offset += 500) {
                const { data, error } = await client.from('epp_devoluciones').select('*').order('id').range(offset, offset + 499);
                if (error) throw error;
                if (!Array.isArray(data)) throw new Error('Respuesta inválida al cargar devoluciones.');
                records.push(...data);
                if (data.length < 500) break;
            }
            state.records = records;
            state.ready = true;
            state.error = '';
        } catch (error) {
            state.ready = false;
            state.error = ['42P01', 'PGRST205'].includes(error.code)
                ? 'Falta instalar la actualización SQL de devoluciones en la base de datos.'
                : 'No fue posible cargar las devoluciones. Actualiza la página antes de interpretar los saldos.';
        }
        return state;
    }
    async function save({ salidaId, items, motivo, notas = '', requestId }) {
        const user = getUser();
        if (!user?.rut) throw new Error('Inicia sesión antes de registrar una devolución.');
        if (!state.ready) throw new Error(state.error || 'Carga las devoluciones antes de registrar una recepción.');
        const { data, error } = await client.rpc('epp_registrar_devolucion', {
            p_rut: user.rut, p_salida_id: String(salidaId), p_items: items,
            p_motivo: motivo, p_notas: notas, p_request_id: requestId
        });
        if (error) throw error;
        if (!data?.id || String(data.salida_id) !== String(salidaId) || !Array.isArray(data.items) || !data.items.length) {
            throw new Error('El servidor no confirmó la devolución. Reintenta con los mismos datos.');
        }
        if (!state.records.some(row => row.id === data.id)) state.records.unshift(data);
        return data;
    }
    return { state, load, save };
}
