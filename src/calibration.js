// ==========================================================================
// Control de Calibraciones por Número de Serie (calibration.js)
// ==========================================================================

import { dbEquiposSeriales } from './db.js';

/**
 * Retorna el estado de vigencia de calibración de un equipo serializado.
 * @param {string} serial Número de serie a evaluar.
 * @returns {object} { faenaOk: boolean, proveedorOk: boolean, errorFaena: string, errorProveedor: string }
 */
export function getCalibrationStatus(serial) {
    const eq = dbEquiposSeriales.find(e => e.numero_serie === serial);
    if (!eq) {
        return { faenaOk: true, proveedorOk: true, errorFaena: "", errorProveedor: "" };
    }

    const hoy = new Date();
    let faenaOk = true;
    let proveedorOk = true;
    let errorFaena = "";
    let errorProveedor = "";

    // Calibración Mensual en Faena (30 días de validez)
    if (eq.calibracion_faena) {
        const fCal = new Date(eq.calibracion_faena);
        const diffTime = hoy - fCal;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > 30) {
            faenaOk = false;
            errorFaena = `Excedida en ${diffDays - 30} días (Última: ${fCal.toLocaleDateString('es-CL')})`;
        }
    } else {
        faenaOk = false;
        errorFaena = "No registra calibración en faena";
    }

    // Calibración Trimestral por Proveedor (90 días de validez)
    if (eq.calibracion_proveedor) {
        const pCal = new Date(eq.calibracion_proveedor);
        const diffTime = hoy - pCal;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays > 90) {
            proveedorOk = false;
            errorProveedor = `Excedida en ${diffDays - 90} días (Última: ${pCal.toLocaleDateString('es-CL')})`;
        }
    } else {
        proveedorOk = false;
        errorProveedor = "No registra calibración de proveedor";
    }

    return { faenaOk, proveedorOk, errorFaena, errorProveedor };
}

/**
 * Evalúa si un equipo serializado está apto para ser prestado.
 * @param {string} serial Número de serie.
 * @returns {boolean} True si ambas calibraciones están vigentes.
 */
export function isEquipmentFitForLoan(serial) {
    const { faenaOk, proveedorOk } = getCalibrationStatus(serial);
    return faenaOk && proveedorOk;
}
