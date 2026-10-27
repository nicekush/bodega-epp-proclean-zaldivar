import { dbSalidas, dbInventario, dbDevoluciones, dbDevolucionesStatus, dbFetchDevoluciones, dbRegistrarDevolucion } from './db.js';
import { currentUser } from './auth.js';
import { deliveryBalances, validateReturnItems } from './returns-model.js';
import { showToast } from './utils.js';

export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = value => new Date(value).toLocaleString('es-CL');
const canReceive = () => ['Administrador', 'Supervisor', 'Bodeguero'].includes(currentUser?.rol);
let selectedDelivery = null;
let requestId = null;
let submittedPayload = null;
let saving = false;
let receipt = null;

export function returnSummaryHTML(delivery) {
    if (!dbDevolucionesStatus.ready) return `<p class="return-status-warning">${escapeHTML(dbDevolucionesStatus.error)}</p>`;
    const records = dbDevoluciones.filter(row => String(row.salida_id) === String(delivery.id)).sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    return records.map(row => `<button type="button" class="btn btn-secondary btn-sm" data-return-receipt="${escapeHTML(row.id)}">Devolución ${escapeHTML(date(row.fecha))} · ${row.items.reduce((sum, item) => sum + Number(item.cantidad), 0)} u.</button>`).join(' ');
}

function ensureModal() {
    if (document.getElementById('return-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'return-modal';
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'return-title');
    modal.innerHTML = `<div class="modal-content return-dialog">
        <div class="modal-header"><h3 id="return-title">Registrar devolución sin uso</h3><button type="button" class="btn-close" aria-label="Cerrar devolución" id="return-close">&times;</button></div>
        <div class="modal-body"><p id="return-person"></p><p id="return-message" role="status"></p>
        <form id="return-form">
            <p>Registra únicamente material sin uso, recibido y aceptado por bodega como apto para reingreso.</p>
            <div class="table-container"><table><thead><tr><th>Producto</th><th>Entregado</th><th>Devuelto</th><th>Saldo</th><th>Devolver ahora</th></tr></thead><tbody id="return-lines"></tbody></table></div>
            <div class="form-group"><label for="return-reason">Motivo</label><select id="return-reason" required><option value="">Seleccionar motivo</option><option>No utilizado</option><option>Cambio de talla sin uso</option><option>Excedente entregado sin uso</option><option>Otro motivo</option></select></div>
            <div class="form-group"><label for="return-notes">Observaciones</label><textarea id="return-notes" maxlength="4000" rows="2" placeholder="Detalle de la recepción o del cambio"></textarea></div>
            <label class="return-accept"><input type="checkbox" id="return-accepted" required> Confirmo que recibí el material sin uso y apto para reingreso, y que esta devolución aún no fue sumada al stock mediante un ajuste.</label>
            <p id="return-impact" class="return-impact" aria-live="polite"></p>
            <p>Si el stock ya fue corregido con un ajuste, este formulario duplicaría el ingreso. Ese caso requiere regularización del registro.</p>
            <div class="modal-footer"><button class="btn btn-secondary" type="button" id="return-cancel">Cancelar</button><button class="btn btn-primary" type="submit" id="return-save">Confirmar recepción</button></div>
        </form>
        <div id="return-receipt" hidden></div>
        <div id="return-documents"></div>
        </div></div>`;
    document.body.appendChild(modal);
    document.getElementById('return-close').addEventListener('click', closeReturn);
    document.getElementById('return-cancel').addEventListener('click', closeReturn);
    document.getElementById('return-form').addEventListener('submit', saveReturn);
    modal.addEventListener('input', updateImpact);
    modal.addEventListener('keydown', event => { if (event.key === 'Escape') closeReturn(); });
}

function closeReturn() {
    if (saving) return;
    document.getElementById('return-modal')?.classList.remove('active');
}

export async function openReturnForDelivery(id) {
    if (saving) return;
    const delivery = dbSalidas.find(row => String(row.id) === String(id));
    if (!delivery) { showToast('No se encontró el acta de entrega.', 'warning'); return; }
    ensureModal();
    selectedDelivery = delivery;
    requestId = crypto.randomUUID();
    submittedPayload = null;
    receipt = null;
    const form = document.getElementById('return-form');
    form.reset();
    form.hidden = true;
    document.getElementById('return-receipt').hidden = true;
    document.getElementById('return-title').textContent = 'Registrar devolución sin uso';
    document.getElementById('return-person').textContent = `${delivery.trabajador} · RUT ${delivery.rut} · Acta ${delivery.id} · ${date(delivery.fecha)}`;
    document.getElementById('return-message').textContent = 'Cargando saldos confirmados…';
    document.getElementById('return-documents').innerHTML = '';
    document.getElementById('return-modal').classList.add('active');
    document.getElementById('return-close').focus();
    await dbFetchDevoluciones();
    // Otra apertura puede haberse iniciado mientras llegaba la consulta.
    if (selectedDelivery !== delivery) return;
    document.getElementById('return-message').textContent = dbDevolucionesStatus.ready ? '' : dbDevolucionesStatus.error;
    if (!dbDevolucionesStatus.ready) return;
    document.getElementById('return-documents').innerHTML = returnSummaryHTML(delivery);
    if (!canReceive()) { document.getElementById('return-message').textContent = 'Tu usuario no tiene permiso para registrar recepciones.'; return; }
    const balances = deliveryBalances(delivery, dbDevoluciones);
    if (!balances.some(item => item.saldo > 0)) {
        document.getElementById('return-message').textContent = 'Esta entrega está totalmente devuelta.';
        return;
    }
    document.getElementById('return-lines').innerHTML = balances.map(item => {
        const product = dbInventario.find(row => String(row.id) === String(item.eppId));
        return `<tr><td>${escapeHTML(product?.codigo || '')} · ${escapeHTML(product?.nombre || item.eppId)}</td><td>${item.entregado}</td><td>${item.devuelto}</td><td>${item.saldo}</td><td><input aria-label="Cantidad a devolver de ${escapeHTML(product?.nombre || item.eppId)}" class="return-quantity" data-line="${item.linea}" type="number" min="0" max="${item.saldo}" step="any" value="0" ${item.saldo <= 0 ? 'disabled' : ''}></td></tr>`;
    }).join('');
    form.hidden = false;
    form.querySelectorAll('input, select, textarea, button').forEach(element => { if (!element.classList.contains('return-quantity')) element.disabled = false; });
    updateImpact();
}

function chosenItems() {
    return [...document.querySelectorAll('#return-lines .return-quantity')]
        .filter(input => Number(input.value) !== 0)
        .map(input => ({ linea: Number(input.dataset.line), cantidad: Number(input.value) }));
}

function updateImpact() {
    if (!selectedDelivery || document.getElementById('return-form').hidden) return;
    const balances = deliveryBalances(selectedDelivery, dbDevoluciones);
    const lines = chosenItems().map(item => {
        const balance = balances.find(row => row.linea === item.linea);
        const product = dbInventario.find(row => String(row.id) === String(balance?.eppId));
        if (!balance || !Number.isFinite(item.cantidad) || item.cantidad < 0 || item.cantidad > balance.saldo) return 'Revisa las cantidades: deben estar dentro del saldo disponible.';
        const unit = product?.unidad || 'u.';
        const remaining = Number((balance.saldo - item.cantidad).toPrecision(15));
        return `Reingreso: ${item.cantidad} ${unit} de ${product?.nombre || balance.eppId}. Saldo neto de esta entrega: ${remaining} ${unit}.`;
    });
    document.getElementById('return-impact').textContent = lines.join('\n') || 'Indica las cantidades que se reciben para ver el efecto en el stock y en la entrega neta.';
}

async function saveReturn(event) {
    event.preventDefault();
    if (saving || !selectedDelivery) return;
    const message = document.getElementById('return-message');
    try {
        if (!document.getElementById('return-accepted').checked) throw new Error('Confirma la recepción del material.');
        const items = validateReturnItems(chosenItems(), deliveryBalances(selectedDelivery, dbDevoluciones));
        const motivo = document.getElementById('return-reason').value;
        const notas = document.getElementById('return-notes').value.trim();
        if (!motivo || (motivo === 'Otro motivo' && !notas)) throw new Error('Indica el motivo y detalla la observación si seleccionas Otro motivo.');
        const payload = { salidaId: selectedDelivery.id, items, motivo, notas, requestId };
        if (submittedPayload && JSON.stringify(payload) !== submittedPayload) {
            throw new Error('Hay una recepción pendiente de confirmación. Reintenta los mismos datos o cierra y revisa los comprobantes antes de crear otra.');
        }
        submittedPayload = JSON.stringify(payload);
        saving = true;
        document.getElementById('return-save').disabled = true;
        message.textContent = 'Registrando recepción…';
        const record = await dbRegistrarDevolucion(payload);
        saving = false;
        showReturnReceipt(record.id);
        document.dispatchEvent(new CustomEvent('epp-return-saved', { detail: { salidaId: selectedDelivery.id } }));
        if (!dbDevolucionesStatus.ready) message.textContent = dbDevolucionesStatus.error;
        showToast('Devolución registrada. El acta original se conserva.', 'success');
    } catch (error) {
        message.textContent = error.message || 'No se pudo confirmar la devolución. Reintenta con los mismos datos.';
    } finally {
        saving = false;
        document.getElementById('return-save').disabled = false;
    }
}

function receiptHTML(record) {
    return `<h2>Comprobante de devolución de EPP</h2><p>Folio: ${escapeHTML(record.id)}<br>Fecha de recepción: ${escapeHTML(date(record.fecha))}<br>Acta original: ${escapeHTML(record.salida_id)}</p>
        <p>Colaborador: ${escapeHTML(record.trabajador)} · RUT ${escapeHTML(record.rut)}<br>Área: ${escapeHTML(record.area)} · Turno: ${escapeHTML(record.turno)}</p>
        <p>Condición: sin uso, recibido y aceptado como apto para reingreso.<br>Motivo: ${escapeHTML(record.motivo)}<br>Observaciones: ${escapeHTML(record.notas)}</p>
        <table><thead><tr><th>SKU</th><th>Producto</th><th>Cantidad devuelta</th><th>Unidad</th></tr></thead><tbody>${record.items.map(item => `<tr><td>${escapeHTML(item.codigo)}</td><td>${escapeHTML(item.nombre)}</td><td>${Number(item.cantidad)}</td><td>${escapeHTML(item.unidad)}</td></tr>`).join('')}</tbody></table>
        <p>Recibido por: ${escapeHTML(record.registrado_por)} · RUT ${escapeHTML(record.registrado_por_rut)}</p><p>Este comprobante complementa el acta de entrega original.</p>`;
}

export function showReturnReceipt(id) {
    const record = dbDevoluciones.find(row => row.id === id);
    if (!record) return;
    ensureModal();
    receipt = record;
    selectedDelivery = dbSalidas.find(row => String(row.id) === String(record.salida_id));
    document.getElementById('return-title').textContent = 'Comprobante de devolución';
    document.getElementById('return-person').textContent = '';
    document.getElementById('return-message').textContent = '';
    document.getElementById('return-form').hidden = true;
    const container = document.getElementById('return-receipt');
    container.hidden = false;
    container.innerHTML = receiptHTML(record) + '<button type="button" class="btn btn-primary" id="return-print">Imprimir comprobante</button>';
    document.getElementById('return-documents').innerHTML = `<button type="button" class="btn btn-secondary" data-return-delivery="${escapeHTML(record.salida_id)}">Ver saldos y devoluciones del acta</button>`;
    document.getElementById('return-print').addEventListener('click', printReturnReceipt);
    document.getElementById('return-modal').classList.add('active');
}

function printReturnReceipt() {
    if (!receipt) return;
    const popup = window.open('', '_blank');
    if (!popup) { showToast('Permite abrir el comprobante para imprimir.', 'warning'); return; }
    popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Devolución ${escapeHTML(receipt.id)}</title><style>body{font:14px Arial;margin:32px;color:#17212b}h2{font-size:22px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border:1px solid #bbb;text-align:left}p{line-height:1.6}</style></head><body>${receiptHTML(receipt)}</body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
}

document.addEventListener('click', event => {
    const delivery = event.target.closest('[data-return-delivery]');
    const record = event.target.closest('[data-return-receipt]');
    if (delivery) openReturnForDelivery(delivery.dataset.returnDelivery);
    if (record) showReturnReceipt(record.dataset.returnReceipt);
});
