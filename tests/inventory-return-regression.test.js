import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const database = readFileSync(new URL('../src/db.js', import.meta.url), 'utf8');
const reconciliation = readFileSync(new URL('../src/reconciliation.js', import.meta.url), 'utf8');
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))).replace(/^export /gm, '');

test('conciliar de 10 a 12 conserva 12 y un solo comprobante por el sobrante de 2', async () => {
    const storage = new Map(), records = [];
    const inventory = [{ id: 'g', stock: 10 }];
    const context = vm.createContext({
        dbInventario: inventory, dbIngresos: [], signatureCanvas: null,
        reconciliationData: [{ id: 'g', codigo: 'G', nombre: 'Guantes', stockSys: 10, physStock: 12, diff: 2, reason: 'Conteo', note: '' }],
        document: { getElementById: () => ({ value: 'Supervisor' }) },
        dbUpdateEPPStock: async (id, stock) => { inventory[0].stock = stock; },
        supabase: { from: () => ({ insert: rows => ({ select: async () => { records.push(...rows); return { data: [{ id: 'ingreso', ...rows[0] }], error: null }; } }) }) },
        showConfirmDialog: async () => true, showToast() {}, console,
        localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
        closeReconciliationSignatureModal() {}, cancelReconciliation() {}, checkDraftAvailability() {}, loadReconciliationHistory() {}
    });
    vm.runInContext(section(database, 'export async function dbInsertInflow(', '// Salidas (Actas de Entrega)') + '\n' + section(reconciliation, 'export async function confirmSaveReconciliationWithSignature()', '/**\n * Carga y renderiza'), context);
    await context.confirmSaveReconciliationWithSignature();
    assert.equal(inventory[0].stock, 12);
    assert.equal(records.length, 1);
    assert.equal(records[0].items[0].cantidad, 2);
    assert.equal(JSON.parse(storage.get('db_conciliaciones_historial')).length, 1);
});

test('un ajuste con stock anterior a una devolución no sobrescribe el saldo recuperado', async () => {
    const inventory = [{ id: 'g', stock: 7 }];
    let remoteStock = 9;
    const predicates = new Map();
    const context = vm.createContext({
        dbInventario: inventory,
        supabase: { from: () => ({
            update(value) { this.next = value.stock; return this; },
            eq(key, value) { predicates.set(key, value); return this; },
            async select() {
                if (predicates.get('stock') !== remoteStock) return { data: [], error: null };
                remoteStock = this.next;
                return { data: [{ id: 'g', stock: remoteStock }], error: null };
            }
        }) }
    });
    vm.runInContext(section(database, 'export async function dbUpdateEPPStock(', '// Categorías'), context);
    await assert.rejects(context.dbUpdateEPPStock('g', 6), /stock cambió/);
    assert.equal(remoteStock, 9);
    assert.equal(inventory[0].stock, 7);
});
