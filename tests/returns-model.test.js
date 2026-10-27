import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryBalances, netDeliveries, previousNetDelivery, validateReturnItems } from '../src/returns-model.js';

const delivery = { id: 'a', rut: '11.111.111-1', fecha: '2026-09-01T12:00:00Z', firma: 'firma original', items: [{ eppId: 'g', cantidad: 3 }, { eppId: 'g', cantidad: 1 }, { eppId: 'c', cantidad: 2 }] };
const returns = [{ id: 'r', salida_id: 'a', fecha: '2026-10-01T12:00:00Z', items: [{ linea: 0, cantidad: 2 }] }];

test('devoluciones parciales, sucesivas y por línea sin alterar el acta firmada', () => {
    const before = structuredClone(delivery);
    assert.deepEqual(deliveryBalances(delivery, returns).map(row => row.saldo), [1, 1, 2]);
    const all = [...returns, { salida_id: 'a', fecha: '2026-10-02', items: [{ linea: 0, cantidad: 1 }, { linea: 2, cantidad: 2 }] }];
    assert.deepEqual(netDeliveries([delivery], all)[0].items.map(row => row.linea), [1]);
    assert.deepEqual(delivery, before);
});

test('una devolución de octubre no modifica el saldo de septiembre al corte', () => {
    assert.equal(deliveryBalances(delivery, returns, '2026-09-30T23:59:59Z')[0].saldo, 3);
    assert.equal(deliveryBalances(delivery, returns, '2026-10-02T00:00:00Z')[0].saldo, 1);
});

test('las alertas actuales omiten entregas totalmente devueltas y recuperan un antecedente previo', () => {
    const older = { ...delivery, id: 'older', fecha: '2026-08-01', items: [{ eppId: 'g', cantidad: 1 }] };
    const latest = { ...delivery, items: [{ eppId: 'g', cantidad: 3 }] };
    const current = { ...delivery, id: 'current', rut: '111111111', fecha: '2026-10-03' };
    const fullReturn = [{ ...returns[0], items: [{ linea: 0, cantidad: 3 }] }];
    assert.equal(previousNetDelivery([older, latest], fullReturn, current, 'g').id, 'older');
    assert.equal(previousNetDelivery([latest], fullReturn, current, 'g'), null);
    assert.equal(previousNetDelivery([latest], fullReturn, { ...current, fecha: '2026-09-02' }, 'g').id, 'a');
});

test('rechaza cero, negativos, exceso y líneas inexistentes o repetidas', () => {
    const balances = deliveryBalances(delivery, returns);
    for (const cantidad of [0, -1, 2, NaN, Infinity]) assert.throws(() => validateReturnItems([{ linea: 0, cantidad }], balances));
    assert.throws(() => validateReturnItems([{ linea: 99, cantidad: 1 }], balances));
    assert.throws(() => validateReturnItems([{ linea: 0, cantidad: 1 }, { linea: 0, cantidad: 1 }], balances));
    assert.deepEqual(validateReturnItems([{ linea: 0, cantidad: 1 }], balances), [{ linea: 0, cantidad: 1, eppId: 'g', entregado: 3 }]);
});

test('una cantidad fraccionaria no deja residuos ni rechaza la devolución del saldo exacto', () => {
    const fractional = { ...delivery, items: [{ eppId: 'g', cantidad: 0.3 }] };
    const partial = [{ ...returns[0], items: [{ linea: 0, cantidad: 0.1 }] }];
    const balances = deliveryBalances(fractional, partial);
    assert.equal(balances[0].saldo, 0.2);
    assert.equal(validateReturnItems([{ linea: 0, cantidad: 0.2 }], balances)[0].cantidad, 0.2);
});
