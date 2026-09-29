// ==========================================================================
// Base de Datos Centralizada en la Nube (Supabase Client & Query Layer)
// ==========================================================================

import { createClient } from '@supabase/supabase-js';
import guiasSeed from './data/guias_seed.json';

const supabaseUrl = 
    import.meta.env.VITE_SUPABASE_URL || 
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL || 
    import.meta.env.SUPABASE_URL;

const supabaseAnonKey = 
    import.meta.env.VITE_SUPABASE_ANON_KEY || 
    import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
    import.meta.env.SUPABASE_ANON_KEY ||
    import.meta.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn("⚠️ [Supabase] Advertencia: Variables de entorno de Supabase no detectadas en este entorno.");
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');
 
// Estado de memoria local sincronizado
export let dbCategorias = [];
export let dbAreas = [];
export let dbAreasFull = [];
export let dbTurnos = [];
export let dbInventario = [];
export let dbIngresos = [];
export let dbSalidas = [];
export let dbInsumos = [];
export let dbInsumoMovimientos = [];
export let dbSolicitudesAbastecimiento = [];
export let dbEquiposSeriales = [];
export let dbPrestamos = [];
export let dbAjustesStock = [];
export let dbGuias = [];
export let dbGuiasCatalogos = { vehiculos: [], choferes: [], destinos: [] };
export let dbGuiasConfig = {};
 
// Helper seguro para guardar en localStorage evitando QuotaExceededError
export function safeLocalStorageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
            console.warn(`[Storage Safety] QuotaExceededError al guardar '${key}'. Limpiando archivos pesados en Base64 para liberar espacio.`);
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    const cleaned = parsed.map(item => {
                        const clone = { ...item };
                        if (clone.evidencia && clone.evidencia.length > 500) clone.evidencia = "";
                        if (clone.firma && clone.firma.length > 1000) clone.firma = "";
                        if (clone.firma_salida && clone.firma_salida.length > 1000) clone.firma_salida = "";
                        return clone;
                    });
                    localStorage.setItem(key, JSON.stringify(cleaned));
                    return;
                }
            } catch (innerErr) {
                console.error("[Storage Safety] No se pudo depurar el Base64", innerErr);
            }
        }
        console.error(`Error guardando en localStorage key=${key}`, e);
    }
}

// Inicialización asíncrona desde Supabase
export async function initDatabase() {
    try {
        // 1. Cargar Categorías
        const { data: cats, error: errCats } = await supabase.from('categorias').select('nombre').order('nombre');
        if (errCats) throw errCats;
        dbCategorias = cats.map(c => c.nombre);
 
        // 2. Cargar Áreas (con Fallback Local para inicio sin conexión)
        try {
            const { data: ars, error: errArs } = await supabase.from('areas').select('*').order('nombre');
            if (errArs) throw errArs;
            dbAreasFull = ars.map(a => {
                const localKit = localStorage.getItem(`area_kit_${a.nombre}`);
                if (localKit && !a.kit) {
                    try { a.kit = JSON.parse(localKit); } catch(e) {}
                }
                return a;
            });
            dbAreas = dbAreasFull.map(a => a.nombre);
            // Guardar copia local para inicio offline
            localStorage.setItem("db_areas_full", JSON.stringify(dbAreasFull));
        } catch (e) {
            console.warn("Fallo al cargar areas de Supabase. Usando copia local.", e);
            const localAreas = localStorage.getItem("db_areas_full");
            if (localAreas) {
                dbAreasFull = JSON.parse(localAreas);
                dbAreas = dbAreasFull.map(a => a.nombre);
            } else {
                dbAreasFull = [];
                dbAreas = [];
            }
        }
 
        // 2.5 Cargar Turnos
        try {
            const { data: trns, error: errTrns } = await supabase.from('turnos').select('nombre').order('nombre');
            if (errTrns) throw errTrns;
            dbTurnos = trns.map(t => t.nombre);
        } catch (e) {
            console.warn("Tabla 'turnos' no disponible en Supabase. Usando valores por defecto.", e);
            dbTurnos = ['Turno A', 'Turno B'];
        }

        // 3. Cargar Catálogo de Inventario
        const { data: inv, error: errInv } = await supabase.from('inventario').select('*').order('codigo');
        if (errInv) throw errInv;
        dbInventario = inv;

        // 4. Cargar Ingresos (Facturas)
        const { data: ing, error: errIng } = await supabase.from('ingresos').select('*').order('fecha', { ascending: false });
        if (errIng) throw errIng;
        dbIngresos = ing;

        // 5. Cargar Salidas (Actas)
        const { data: sal, error: errSal } = await supabase.from('salidas').select('*').order('fecha', { ascending: false });
        if (errSal) throw errSal;
        dbSalidas = sal;
        await dbCleanDuplicateOutflows();

        // 6. Cargar Insumos para Mejoras
        const { data: ins, error: errIns } = await supabase.from('insumos_mejoras').select('*').order('fecha_solicitud', { ascending: false });
        if (errIns) throw errIns;
        dbInsumos = ins;

        // 7. Cargar Historial de Movimientos de Insumos
        const { data: mov, error: errMov } = await supabase.from('insumos_movimientos').select('*').order('fecha', { ascending: false });
        if (errMov) throw errMov;
        dbInsumoMovimientos = mov;

        // 8. Cargar Solicitudes de Abastecimiento de Bodega (con Fallback Local)
        try {
            const { data: rep, error: errRep } = await supabase.from('solicitudes_abastecimiento').select('*').order('fecha', { ascending: false });
            if (errRep) throw errRep;
            dbSolicitudesAbastecimiento = rep || [];
        } catch (e) {
            console.warn("Tabla 'solicitudes_abastecimiento' no detectada en Supabase. Usando persistencia en localStorage.");
            const localData = localStorage.getItem("db_solicitudes_abastecimiento");
            try {
                dbSolicitudesAbastecimiento = localData ? JSON.parse(localData) : [];
            } catch (parseErr) {
                dbSolicitudesAbastecimiento = [];
            }
            if (!Array.isArray(dbSolicitudesAbastecimiento)) {
                dbSolicitudesAbastecimiento = [];
            }
        }
 
        // 9. Cargar Equipos Seriales (con Fallback Local)
        try {
            const { data: serials, error: errSerials } = await supabase.from('equipos_seriales').select('*').order('numero_serie');
            if (errSerials) throw errSerials;
            dbEquiposSeriales = serials || [];
        } catch (e) {
            console.warn("Tabla 'equipos_seriales' no disponible en Supabase. Usando localStorage.");
            const localSerials = localStorage.getItem("db_equipos_seriales");
            dbEquiposSeriales = localSerials ? JSON.parse(localSerials) : [];
        }
 
        // 10. Cargar Préstamos (con Fallback Local)
        try {
            const { data: prest, error: errPrest } = await supabase.from('prestamos').select('*').order('fecha_salida', { ascending: false });
            if (errPrest) throw errPrest;
            dbPrestamos = prest || [];
        } catch (e) {
            console.warn("Tabla 'prestamos' no disponible en Supabase. Usando localStorage.");
            const localPrest = localStorage.getItem("db_prestamos");
            dbPrestamos = localPrest ? JSON.parse(localPrest) : [];
        }

        // 11. Cargar Auditoría de Ajustes de Stock (con Fallback Local)
        try {
            const { data: ajst, error: errAjst } = await supabase.from('ajustes_stock').select('*').order('fecha', { ascending: false });
            if (errAjst) throw errAjst;
            dbAjustesStock = ajst || [];
        } catch (e) {
            console.warn("Tabla 'ajustes_stock' no disponible en Supabase. Usando localStorage.");
            const localAjst = localStorage.getItem("db_ajustes_stock");
            try {
                dbAjustesStock = localAjst ? JSON.parse(localAjst) : [];
            } catch (errParse) {
                dbAjustesStock = [];
            }
        }

        // 12. Cargar Guías de Despacho (con Fallback Local & Semilla Histórica)
        try {
            const { data: gList, error: errG } = await supabase
                .from('guias_despacho')
                .select(`
                    *,
                    items:guia_despacho_items(*)
                `)
                .order('folio', { ascending: false });

            if (errG) throw errG;
            if (gList && gList.length > 0) {
                dbGuias = gList;
                safeLocalStorageSet("db_guias_despacho", JSON.stringify(dbGuias));
            } else {
                throw new Error("Sin registros en Supabase guias_despacho.");
            }
        } catch (e) {
            console.warn("Tabla 'guias_despacho' no disponible en Supabase o vacía. Usando cache local o semilla histórica.", e);
            const local = localStorage.getItem("db_guias_despacho");
            if (local) {
                try {
                    dbGuias = JSON.parse(local);
                } catch(err) {
                    dbGuias = guiasSeed || [];
                }
            } else {
                dbGuias = guiasSeed || [];
                safeLocalStorageSet("db_guias_despacho", JSON.stringify(dbGuias));
            }
        }

        // 13. Cargar Catálogos de Despacho (Vehículos, Choferes, Destinos)
        try {
            const { data: cats, error: errCats } = await supabase
                .from('guias_despacho_catalogos')
                .select('*')
                .order('frecuencia', { ascending: false });

            if (errCats) throw errCats;
            if (cats && cats.length > 0) {
                dbGuiasCatalogos = {
                    vehiculos: cats.filter(c => c.tipo === 'vehiculo'),
                    choferes: cats.filter(c => c.tipo === 'chofer'),
                    destinos: cats.filter(c => c.tipo === 'destino'),
                    all: cats
                };
            } else {
                throw new Error("Catálogos vacíos");
            }
        } catch (e) {
            const defVehiculos = [
                'Maxus T60', 'Toyota Hilux', 'Mitsubishi L200', 'Volkswagen Delivery',
                'Camión Hino SCBY16', 'Hyundai Porter', 'Shineray T50', 'Bus Yutong', 'Grúa Rescate'
            ];
            const defDestinos = [
                'PWM Chile', 'Oficina ANT', 'Taller GMI', 'Kaufman', 'Derco', 'MPM',
                'Salmos sur 107', 'Av. Argentina 2309', 'Av. José Infante, Salamanca', 'Faena Minera', 'Faena Zaldívar'
            ];
            const defChoferes = [
                'Marco Andrade', 'Luis Gamboa', 'Pedro Velazquez', 'Robert Gonzalez',
                'Manuel Espinosa', 'Santos Jofre', 'Alexis Silva', 'Bruno Castro', 'Ignacio Perez', 'Jhon Diaz'
            ];
            dbGuiasCatalogos = {
                vehiculos: defVehiculos.map((v, i) => ({ id: i + 1, tipo: 'vehiculo', nombre: v, frecuencia: 1 })),
                choferes: defChoferes.map((c, i) => ({ id: i + 1, tipo: 'chofer', nombre: c, frecuencia: 1 })),
                destinos: defDestinos.map((d, i) => ({ id: i + 1, tipo: 'destino', nombre: d, frecuencia: 1 })),
                all: []
            };
        }

    } catch (error) {
        console.error("Error cargando base de datos desde Supabase:", error);
        throw error;
    }
}

export async function dbInsertAjusteStock(ajuste) {
    const record = {
        id: ajuste.id || "AUD-" + Date.now(),
        fecha: ajuste.fecha || new Date().toISOString(),
        epp_id: ajuste.epp_id,
        epp_codigo: ajuste.epp_codigo,
        epp_nombre: ajuste.epp_nombre,
        stock_anterior: ajuste.stock_anterior,
        stock_nuevo: ajuste.stock_nuevo,
        tipo_operacion: ajuste.tipo_operacion,
        cantidad_ajuste: ajuste.cantidad_ajuste,
        motivo: ajuste.motivo,
        notas: ajuste.notas || "",
        usuario: ajuste.usuario || "Operador"
    };

    try {
        const { data, error } = await supabase.from('ajustes_stock').insert([{
            epp_id: record.epp_id,
            epp_codigo: record.epp_codigo,
            epp_nombre: record.epp_nombre,
            stock_anterior: record.stock_anterior,
            stock_nuevo: record.stock_nuevo,
            tipo_operacion: record.tipo_operacion,
            cantidad_ajuste: record.cantidad_ajuste,
            motivo: record.motivo,
            notas: record.notas,
            usuario: record.usuario,
            fecha: record.fecha
        }]).select();

        if (error) throw error;
        dbAjustesStock.unshift(data[0]);
        safeLocalStorageSet("db_ajustes_stock", JSON.stringify(dbAjustesStock));
        return data[0];
    } catch (e) {
        console.warn("Fallo guardado de auditoría en Supabase, guardando localmente.", e);
        dbAjustesStock.unshift(record);
        safeLocalStorageSet("db_ajustes_stock", JSON.stringify(dbAjustesStock));
        return record;
    }
}

// ==========================================================================
// Operaciones de Escritura y Sincronización en Supabase
// ==========================================================================

// EPP / Inventario
export async function dbInsertEPP(item) {
    const { data, error } = await supabase.from('inventario').insert([{
        codigo: item.codigo,
        nombre: item.nombre,
        categoria: item.categoria,
        stock: item.stock,
        stock_minimo: item.stockMinimo,
        unidad: item.unidad,
        duracion_meses: item.duracion_meses,
        tipo_control: item.tipo_control || 'Consumo',
        plazo_retorno: item.plazo_retorno || '12h'
    }]).select();
    if (error) throw error;
    // Sincronizar localmente
    dbInventario.push(data[0]);
    return data[0];
}
 
// Plantillas de EPP por Área (Kits)
export async function dbSaveAreaKit(areaNombre, items) {
    try {
        const { data, error } = await supabase.from('areas')
            .update({ kit: items })
            .eq('nombre', areaNombre)
            .select();
        if (error) throw error;
        const idx = dbAreasFull.findIndex(a => a.nombre === areaNombre);
        if (idx !== -1) {
            dbAreasFull[idx].kit = items;
        }
        return data[0];
    } catch (e) {
        console.warn("Fallo guardado de kit en Supabase, guardando localmente.", e);
        const idx = dbAreasFull.findIndex(a => a.nombre === areaNombre);
        if (idx !== -1) {
            dbAreasFull[idx].kit = items;
        }
        localStorage.setItem(`area_kit_${areaNombre}`, JSON.stringify(items));
        return { nombre: areaNombre, kit: items };
    }
}
 
// Equipos Seriales y Calibración
export async function dbInsertEquipOSerial(eq) {
    try {
        const { data, error } = await supabase.from('equipos_seriales').insert([{
            producto_id: eq.producto_id,
            numero_serie: eq.numero_serie,
            estado: eq.estado || 'Disponible',
            calibracion_faena: eq.calibracion_faena,
            calibracion_proveedor: eq.calibracion_proveedor
        }]).select();
        if (error) throw error;
        dbEquiposSeriales.push(data[0]);
        return data[0];
    } catch (e) {
        console.warn("Fallo guardado de serie en Supabase, guardando localmente.", e);
        const localEq = {
            id: eq.id || "EQ-" + Date.now(),
            producto_id: eq.producto_id,
            numero_serie: eq.numero_serie,
            estado: eq.estado || 'Disponible',
            calibracion_faena: eq.calibracion_faena,
            calibracion_proveedor: eq.calibracion_proveedor
        };
        dbEquiposSeriales.push(localEq);
        localStorage.setItem("db_equipos_seriales", JSON.stringify(dbEquiposSeriales));
        return localEq;
    }
}
 
export async function dbUpdateCalibracion(serial, calibracionFaena, calibracionProveedor) {
    try {
        const { data, error } = await supabase.from('equipos_seriales')
            .update({
                calibracion_faena: calibracionFaena,
                calibracion_proveedor: calibracionProveedor
            })
            .eq('numero_serie', serial)
            .select();
        if (error) throw error;
        const idx = dbEquiposSeriales.findIndex(e => e.numero_serie === serial);
        if (idx !== -1) {
            dbEquiposSeriales[idx].calibracion_faena = calibracionFaena;
            dbEquiposSeriales[idx].calibracion_proveedor = calibracionProveedor;
        }
        return data[0];
    } catch (e) {
        console.warn("Fallo actualización de calibración en Supabase, guardando localmente.", e);
        const idx = dbEquiposSeriales.findIndex(e => e.numero_serie === serial);
        if (idx !== -1) {
            dbEquiposSeriales[idx].calibracion_faena = calibracionFaena;
            dbEquiposSeriales[idx].calibracion_proveedor = calibracionProveedor;
        }
        localStorage.setItem("db_equipos_seriales", JSON.stringify(dbEquiposSeriales));
        return dbEquiposSeriales[idx];
    }
}
 
export async function dbUpdateEquipoEstado(serial, estado) {
    try {
        const { data, error } = await supabase.from('equipos_seriales')
            .update({ estado })
            .eq('numero_serie', serial)
            .select();
        if (error) throw error;
        const idx = dbEquiposSeriales.findIndex(e => e.numero_serie === serial);
        if (idx !== -1) dbEquiposSeriales[idx].estado = estado;
        return data[0];
    } catch (e) {
        const idx = dbEquiposSeriales.findIndex(e => e.numero_serie === serial);
        if (idx !== -1) dbEquiposSeriales[idx].estado = estado;
        localStorage.setItem("db_equipos_seriales", JSON.stringify(dbEquiposSeriales));
    }
}
 
// Préstamos
export async function dbInsertPrestamo(prestamo) {
    try {
        const { data, error } = await supabase.from('prestamos').insert([{
            trabajador_rut: prestamo.trabajador_rut,
            trabajador_nombre: prestamo.trabajador_nombre,
            area: prestamo.area,
            turno: prestamo.turno,
            items: prestamo.items,
            firma_salida: prestamo.firma_salida,
            fecha_salida: prestamo.fecha_salida,
            fecha_retorno: null,
            recibido_por_rut: null,
            recibido_por_nombre: null,
            estado_retorno: null,
            observaciones_retorno: null
        }]).select();
        if (error) throw error;
 
        // Actualizar estado de las series de equipos prestados
        for (const item of prestamo.items) {
            if (item.numero_serie) {
                await dbUpdateEquipoEstado(item.numero_serie, 'Prestado');
            }
        }
 
        dbPrestamos.unshift(data[0]);
        return data[0];
    } catch (e) {
        console.warn("Fallo guardado de préstamo en Supabase, guardando localmente.", e);
        const localPrestamo = {
            id: "PRST-" + Date.now(),
            trabajador_rut: prestamo.trabajador_rut,
            trabajador_nombre: prestamo.trabajador_nombre,
            area: prestamo.area,
            turno: prestamo.turno,
            items: prestamo.items,
            firma_salida: prestamo.firma_salida,
            fecha_salida: prestamo.fecha_salida,
            fecha_retorno: null,
            recibido_por_rut: null,
            recibido_por_nombre: null,
            estado_retorno: null,
            observaciones_retorno: null
        };
 
        for (const item of prestamo.items) {
            if (item.numero_serie) {
                const idx = dbEquiposSeriales.findIndex(eq => eq.numero_serie === item.numero_serie);
                if (idx !== -1) dbEquiposSeriales[idx].estado = 'Prestado';
            }
        }
        localStorage.setItem("db_equipos_seriales", JSON.stringify(dbEquiposSeriales));
 
        dbPrestamos.unshift(localPrestamo);
        localStorage.setItem("db_prestamos", JSON.stringify(dbPrestamos));
        return localPrestamo;
    }
}
 
export async function dbRetornarPrestamo(id, dataRetorno) {
    try {
        const { data, error } = await supabase.from('prestamos')
            .update({
                fecha_retorno: dataRetorno.fecha_retorno,
                recibido_por_rut: dataRetorno.recibido_por_rut,
                recibido_por_nombre: dataRetorno.recibido_por_nombre,
                estado_retorno: dataRetorno.estado_retorno,
                observaciones_retorno: dataRetorno.observaciones_retorno
            })
            .eq('id', id)
            .select();
        if (error) throw error;
 
        // Liberar series o marcarlas como Dañadas
        const dbP = dbPrestamos.find(p => p.id === id);
        if (dbP && dbP.items) {
            for (const item of dbP.items) {
                if (item.numero_serie) {
                    const nuevoEstado = dataRetorno.estado_retorno === 'Dañado' ? 'Dañado' : 'Disponible';
                    await dbUpdateEquipoEstado(item.numero_serie, nuevoEstado);
                }
            }
        }
 
        const idx = dbPrestamos.findIndex(p => p.id === id);
        if (idx !== -1) {
            dbPrestamos[idx].fecha_retorno = dataRetorno.fecha_retorno;
            dbPrestamos[idx].recibido_por_rut = dataRetorno.recibido_por_rut;
            dbPrestamos[idx].recibido_por_nombre = dataRetorno.recibido_por_nombre;
            dbPrestamos[idx].estado_retorno = dataRetorno.estado_retorno;
            dbPrestamos[idx].observaciones_retorno = dataRetorno.observaciones_retorno;
        }
        return data[0];
    } catch (e) {
        console.warn("Fallo retorno de préstamo en Supabase, guardando localmente.", e);
        const idx = dbPrestamos.findIndex(p => p.id === id);
        if (idx !== -1) {
            dbPrestamos[idx].fecha_retorno = dataRetorno.fecha_retorno;
            dbPrestamos[idx].recibido_por_rut = dataRetorno.recibido_por_rut;
            dbPrestamos[idx].recibido_por_nombre = dataRetorno.recibido_por_nombre;
            dbPrestamos[idx].estado_retorno = dataRetorno.estado_retorno;
            dbPrestamos[idx].observaciones_retorno = dataRetorno.observaciones_retorno;
 
            for (const item of dbPrestamos[idx].items) {
                if (item.numero_serie) {
                    const nuevoEstado = dataRetorno.estado_retorno === 'Dañado' ? 'Dañado' : 'Disponible';
                    const eqIdx = dbEquiposSeriales.findIndex(eq => eq.numero_serie === item.numero_serie);
                    if (eqIdx !== -1) dbEquiposSeriales[eqIdx].estado = nuevoEstado;
                }
            }
            localStorage.setItem("db_equipos_seriales", JSON.stringify(dbEquiposSeriales));
        }
        localStorage.setItem("db_prestamos", JSON.stringify(dbPrestamos));
        return dbPrestamos[idx];
    }
}

export async function dbUpdateEPPStock(id, newStock) {
    const { data, error } = await supabase.from('inventario')
        .update({ stock: newStock })
        .eq('id', id)
        .select();
    if (error) throw error;
    // Sincronizar localmente
    const idx = dbInventario.findIndex(i => i.id === id);
    if (idx !== -1) dbInventario[idx].stock = newStock;
    return data[0];
}

// Categorías
export async function dbInsertCategory(nombre) {
    const { data, error } = await supabase.from('categorias').insert([{ nombre }]).select();
    if (error) throw error;
    dbCategorias.push(nombre);
    dbCategorias.sort();
    return data[0];
}

export async function dbDeleteCategory(nombre) {
    const { error } = await supabase.from('categorias').delete().eq('nombre', nombre);
    if (error) throw error;
    dbCategorias = dbCategorias.filter(c => c !== nombre);
}

// Áreas
export async function dbInsertArea(nombre) {
    const { data, error } = await supabase.from('areas').insert([{ nombre }]).select();
    if (error) throw error;
    dbAreas.push(nombre);
    dbAreas.sort();
    return data[0];
}

export async function dbDeleteArea(nombre) {
    const { error } = await supabase.from('areas').delete().eq('nombre', nombre);
    if (error) throw error;
    dbAreas = dbAreas.filter(a => a !== nombre);
}

// Ingresos (Facturas)
export async function dbInsertInflow(inflow) {
    // Insertar el ingreso
    const { data, error } = await supabase.from('ingresos').insert([{
        factura: inflow.factura,
        proveedor: inflow.proveedor,
        fecha: inflow.fecha,
        items: inflow.items,
        comentarios: inflow.comentarios,
        registrado_por: inflow.registrado_por
    }]).select();
    if (error) throw error;
    
    // Actualizar stock de los EPPs asociados en Supabase
    for (const item of inflow.items) {
        const localEPP = dbInventario.find(i => i.id === item.eppId);
        if (localEPP) {
            const nuevoStock = localEPP.stock + item.cantidad;
            await dbUpdateEPPStock(item.eppId, nuevoStock);
        }
    }
    
    dbIngresos.unshift(data[0]);
    return data[0];
}

// Salidas (Actas de Entrega)
export async function dbInsertOutflow(outflow) {
    const payload = {
        trabajador: outflow.trabajador,
        rut: outflow.rut,
        area: outflow.area,
        turno: outflow.turno || "",
        fecha: outflow.fecha,
        items: outflow.items,
        firma: outflow.firma,
        registrado_por: outflow.registrado_por
    };

    let resultData = null;
    let { data, error } = await supabase.from('salidas').insert([payload]).select();
    
    if (error) {
        if (error.message && error.message.includes('turno')) {
            delete payload.turno;
            const resNoTurno = await supabase.from('salidas').insert([payload]).select();
            if (resNoTurno.error) throw resNoTurno.error;
            resultData = resNoTurno.data[0];
        } else {
            throw error;
        }
    } else {
        resultData = data[0];
    }

    // Descontar stock de los EPPs en Supabase
    for (const item of outflow.items) {
        const localEPP = dbInventario.find(i => i.id === item.eppId);
        if (localEPP) {
            const nuevoStock = Math.max(0, localEPP.stock - item.cantidad);
            await dbUpdateEPPStock(item.eppId, nuevoStock);
        }
    }

    const fullRecord = { ...outflow, ...resultData };
    dbSalidas.unshift(fullRecord);
    return fullRecord;
}

export async function dbCleanDuplicateOutflows() {
    if (!dbSalidas || dbSalidas.length < 2) return { cleanedCount: 0 };

    const duplicateIdsToDelete = [];
    const itemsToRestoreMap = {};

    const sortedSalidas = [...dbSalidas].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    for (let i = 0; i < sortedSalidas.length - 1; i++) {
        const current = sortedSalidas[i];
        if (duplicateIdsToDelete.includes(current.id)) continue;

        for (let j = i + 1; j < sortedSalidas.length; j++) {
            const next = sortedSalidas[j];
            if (duplicateIdsToDelete.includes(next.id)) continue;

            const timeDiffMs = Math.abs(new Date(next.fecha) - new Date(current.fecha));
            if (timeDiffMs > 90000) break;

            const rutMatch = (current.rut || "").trim().toUpperCase() === (next.rut || "").trim().toUpperCase();
            const userMatch = (current.registrado_por || "").trim().toUpperCase() === (next.registrado_por || "").trim().toUpperCase();

            const getItemsSignature = (itemsArr) => {
                if (!Array.isArray(itemsArr)) return "";
                return itemsArr
                    .map(it => `${it.eppId}:${it.cantidad}`)
                    .sort()
                    .join("|");
            };

            const itemsMatch = getItemsSignature(current.items) === getItemsSignature(next.items);

            if (rutMatch && userMatch && itemsMatch && getItemsSignature(current.items) !== "") {
                console.warn("Salida duplicada por doble clic detectada:", next.id, "Fecha:", next.fecha);
                duplicateIdsToDelete.push(next.id);

                (next.items || []).forEach(item => {
                    itemsToRestoreMap[item.eppId] = (itemsToRestoreMap[item.eppId] || 0) + Number(item.cantidad);
                });
            }
        }
    }

    if (duplicateIdsToDelete.length === 0) return { cleanedCount: 0 };

    console.log(`Deduplicando ${duplicateIdsToDelete.length} salidas e incrementando stock restituido...`);

    for (const id of duplicateIdsToDelete) {
        const { error } = await supabase.from('salidas').delete().eq('id', id);
        if (error) console.error("Error eliminando registro duplicado en Supabase:", error);
    }

    for (const eppId of Object.keys(itemsToRestoreMap)) {
        const qtyToRestore = itemsToRestoreMap[eppId];
        const localEPP = dbInventario.find(i => i.id === eppId);
        if (localEPP) {
            const nuevoStock = localEPP.stock + qtyToRestore;
            localEPP.stock = nuevoStock;
            await dbUpdateEPPStock(eppId, nuevoStock);
        }
    }

    dbSalidas = dbSalidas.filter(s => !duplicateIdsToDelete.includes(s.id));
    return { cleanedCount: duplicateIdsToDelete.length, restoredItems: itemsToRestoreMap };
}

// Insumos para Mejoras (Solicitud)
export async function dbInsertSupplyRequest(req) {
    const { data, error } = await supabase.from('insumos_mejoras').insert([{
        codigo: req.codigo,
        fecha_solicitud: req.fechaSolicitud,
        mejora: req.mejora,
        proveedor: req.proveedor,
        items: req.items,
        estado: req.estado,
        comentarios: req.comentarios,
        trabajador: req.trabajador,
        rut: req.rut,
        turno: req.turno,
        prioridad: req.prioridad,
        evidencia: req.evidencia
    }]).select();
    if (error) throw error;

    dbInsumos.unshift(data[0]);
    return data[0];
}

// Insumos para Mejoras (Recepción)
export async function dbInsertSupplyReception(mov, reqId, updatedItems, newStatus, updatedComments) {
    // 1. Registrar movimiento
    const { data: newMov, error: errMov } = await supabase.from('insumos_movimientos').insert([{
        fecha: mov.fecha,
        codigo_solicitud: mov.codigoSolicitud,
        mejora: mov.mejora,
        items: mov.items,
        comentarios: mov.comentarios,
        registrado_por: mov.registrado_por
    }]).select();
    if (errMov) throw errMov;

    // 2. Actualizar estado y cantidades de la solicitud de mejora
    const { data: updatedReq, error: errReq } = await supabase.from('insumos_mejoras')
        .update({
            items: updatedItems,
            estado: newStatus,
            comentarios: updatedComments
        })
        .eq('id', reqId)
        .select();
    if (errReq) throw errReq;

    // Sincronizar localmente
    dbInsumoMovimientos.unshift(newMov[0]);
    const idx = dbInsumos.findIndex(i => i.id === reqId);
    if (idx !== -1) {
        dbInsumos[idx].items = updatedItems;
        dbInsumos[idx].estado = newStatus;
        dbInsumos[idx].comentarios = updatedComments;
    }

    return newMov[0];
}

// Función de reinicio de BD (borra todas las transacciones pero mantiene catálogo)
export async function dbResetTransactions() {
    const { error: err1 } = await supabase.from('ingresos').delete().neq('factura', 'KEEP');
    const { error: err2 } = await supabase.from('salidas').delete().neq('trabajador', 'KEEP');
    const { error: err3 } = await supabase.from('insumos_movimientos').delete().neq('mejora', 'KEEP');
    const { error: err4 } = await supabase.from('insumos_mejoras').delete().neq('codigo', 'KEEP');
    
    // Limpiar préstamos y equipos seriales asociados
    const { error: errLoans } = await supabase.from('prestamos').delete().neq('trabajador_rut', 'KEEP');
    const { error: errSerials } = await supabase.from('equipos_seriales').delete().neq('numero_serie', 'KEEP');
    
    if (err1 || err2 || err3 || err4 || errLoans || errSerials) {
        throw (err1 || err2 || err3 || err4 || errLoans || errSerials);
    }
    
    // Resetear stocks de catálogo a 0
    const { error: err5 } = await supabase.from('inventario').update({ stock: 0 }).neq('codigo', 'KEEP');
    if (err5) throw err5;
 
    await initDatabase();
}

// ==========================================================================
// Operaciones de Autenticación y Usuarios (Supabase Custom RBAC)
// ==========================================================================

export async function dbVerificarCredenciales(rut, password) {
    const { data, error } = await supabase.rpc('verificar_credenciales', {
        p_rut: rut,
        p_password: password
    });
    if (error) throw error;
    return data && data[0] ? data[0] : { success: false };
}

export async function dbObtenerUsuarios() {
    const { data, error } = await supabase
        .from('usuarios')
        .select('rut, nombre, rol, cambio_clave_pendiente, created_at')
        .order('nombre');
    if (error) throw error;
    return data;
}

export async function dbCrearUsuario(usuario) {
    // Generar el hash de la contraseña en la base de datos usando crypt de pg_crypto
    // Como Supabase JS inserta directamente objetos, podemos usar un insert raw o una RPC.
    // Para simplificar, insertamos llamando a una consulta que usa la expresión crypt en sql,
    // pero como la librería supabase-js escapa valores, la forma más limpia y segura es usar RPC
    // o insertar directamente si habilitamos una pequeña RPC auxiliar o hacemos el hash vía Postgres.
    // Vamos a crear el usuario encriptando la clave temporal.
    // Usaremos una llamada RPC en Postgres para crear usuarios de forma segura.
    const { data, error } = await supabase.rpc('crear_usuario', {
        p_rut: usuario.rut,
        p_nombre: usuario.nombre,
        p_rol: usuario.rol,
        p_password: usuario.password
    });
    if (error) throw error;
    return data;
}

export async function dbActualizarPassword(rut, nuevaPassword) {
    const { data, error } = await supabase.rpc('actualizar_password_usuario', {
        p_rut: rut,
        p_password: nuevaPassword
    });
    if (error) throw error;
    return data;
}

export async function dbEliminarUsuario(rut) {
    let { error } = await supabase
        .from('usuarios')
        .delete()
        .eq('rut', rut);

    if (error) {
        console.warn("Error en eliminación directa, intentando RPC eliminar_usuario...", error);
        const { error: rpcErr } = await supabase.rpc('eliminar_usuario', { p_rut: rut });
        if (rpcErr) throw error;
    }
}

// Actualizar perfil de usuario (Nombre y Rol)
export async function dbActualizarUsuario(rut, nombre, rol, password = null) {
    let updateData = { nombre, rol };

    let { error } = await supabase
        .from('usuarios')
        .update(updateData)
        .eq('rut', rut);

    if (error) {
        console.warn("Error en actualización directa, intentando RPC actualizar_usuario...", error);
        const { error: rpcErr } = await supabase.rpc('actualizar_usuario', {
            p_rut: rut,
            p_nombre: nombre,
            p_rol: rol
        });
        if (rpcErr) throw error;
    }

    if (password && password.trim().length >= 6) {
        const { error: errPass } = await supabase.rpc('actualizar_password_usuario', {
            p_rut: rut,
            p_password: password
        });
        if (errPass) throw errPass;
    }
}



// Actualizar datos del EPP (Nombre, Categoría, Stock Mínimo, Unidad, Duración, Control, Plazo)
export async function dbUpdateEPPData(id, item) {
    const { data, error } = await supabase.from('inventario')
        .update({
            nombre: item.nombre,
            categoria: item.categoria,
            stock_minimo: item.stock_minimo,
            unidad: item.unidad,
            duracion_meses: item.duracion_meses,
            tipo_control: item.tipo_control,
            plazo_retorno: item.plazo_retorno
        })
        .eq('id', id)
        .select();
    if (error) throw error;
    
    // Sincronizar localmente
    const idx = dbInventario.findIndex(i => i.id === id);
    if (idx !== -1) {
        dbInventario[idx].nombre = item.nombre;
        dbInventario[idx].categoria = item.categoria;
        dbInventario[idx].stock_minimo = item.stock_minimo;
        dbInventario[idx].unidad = item.unidad;
        dbInventario[idx].duracion_meses = item.duracion_meses;
        dbInventario[idx].tipo_control = item.tipo_control;
        dbInventario[idx].plazo_retorno = item.plazo_retorno;
    }
    return data[0];
}

// Eliminar EPP del catálogo
export async function dbDeleteEPP(id) {
    const { error } = await supabase.from('inventario')
        .delete()
        .eq('id', id);
    if (error) throw error;
    
    // Sincronizar localmente
    dbInventario = dbInventario.filter(i => i.id !== id);
}

// Turnos
export async function dbInsertTurno(nombre) {
    const { data, error } = await supabase.from('turnos').insert([{ nombre }]).select();
    if (error) throw error;
    dbTurnos.push(data[0].nombre);
    dbTurnos.sort();
    return data[0];
}

export async function dbDeleteTurno(nombre) {
    const { error } = await supabase.from('turnos').delete().eq('nombre', nombre);
    if (error) throw error;
    dbTurnos = dbTurnos.filter(t => t !== nombre);
}

// Solicitudes de Abastecimiento de Bodega (Pedidos de Reposición)
export async function dbInsertReplenishmentRequest(req) {
    const summaryEPP = req.items.map(it => it.nombre).join(", ").slice(0, 250);
    const totalQty = req.items.reduce((acc, it) => acc + Number(it.cantidad || 0), 0);
    const firstSku = req.items[0] ? req.items[0].sku : "-";
    const firstEppId = req.items[0] ? req.items[0].eppId : null;

    const payload = {
        codigo: req.codigo,
        fecha: req.fecha,
        epp_id: firstEppId,
        sku: firstSku,
        nombre_epp: summaryEPP,
        cantidad_solicitada: totalQty,
        cantidad_recibida: req.items.reduce((acc, it) => acc + Number(it.recibido || 0), 0),
        estado: req.estado,
        comentarios: req.comentarios,
        registrado_por: req.registrado_por,
        items: req.items
    };

    const isEdit = req.id && !req.id.startsWith("REP-TEMP-");

    try {
        let resultData;
        if (isEdit) {
            const { data, error } = await supabase.from('solicitudes_abastecimiento')
                .update(payload)
                .eq('id', req.id)
                .select();
            if (error) throw error;
            resultData = data[0];
            
            // Sincronizar localmente
            const idx = dbSolicitudesAbastecimiento.findIndex(r => r.id === req.id);
            if (idx !== -1) dbSolicitudesAbastecimiento[idx] = resultData;
        } else {
            const { data, error } = await supabase.from('solicitudes_abastecimiento').insert([payload]).select();
            if (error) throw error;
            resultData = data[0];
            dbSolicitudesAbastecimiento.unshift(resultData);
        }
        return resultData;
    } catch (e) {
        console.warn("Fallo en Supabase, procesando localmente en localStorage.", e);
        const localReq = {
            id: req.id || "REP-" + Date.now(),
            ...payload
        };
        
        if (isEdit) {
            const idx = dbSolicitudesAbastecimiento.findIndex(r => r.id === req.id);
            if (idx !== -1) dbSolicitudesAbastecimiento[idx] = localReq;
        } else {
            dbSolicitudesAbastecimiento.unshift(localReq);
        }
        localStorage.setItem("db_solicitudes_abastecimiento", JSON.stringify(dbSolicitudesAbastecimiento));
        return localReq;
    }
}

export async function dbUpdateReplenishmentStatus(id, status, updatedItems = null, comments = "") {
    let targetObj = dbSolicitudesAbastecimiento.find(r => r.id === id);
    if (!targetObj) return null;

    const finalItems = updatedItems || targetObj.items || [];
    const totalRecv = finalItems.reduce((acc, it) => acc + Number(it.recibido || 0), 0);

    const payload = {
        estado: status,
        cantidad_recibida: totalRecv,
        comentarios: comments || targetObj.comentarios,
        items: finalItems
    };

    try {
        const { data, error } = await supabase.from('solicitudes_abastecimiento')
            .update(payload)
            .eq('id', id)
            .select();
        if (error) throw error;
        
        // Sincronizar localmente
        const idx = dbSolicitudesAbastecimiento.findIndex(r => r.id === id);
        if (idx !== -1) {
            dbSolicitudesAbastecimiento[idx] = data[0];
        }

        // Si hay items recibidos en esta transacción, aumentar el stock en el inventario e insertar registro de Inflow
        if (updatedItems !== null) {
            const inflowItems = [];
            for (const item of finalItems) {
                const localEPP = dbInventario.find(i => i.id === item.eppId);
                if (localEPP) {
                    // El incremento real es la cantidad recibida en esta transacción (recibido_ahora)
                    const recvQty = Number(item.recibido_ahora || 0);
                    if (recvQty > 0) {
                        const nuevoStock = localEPP.stock + recvQty;
                        await dbUpdateEPPStock(item.eppId, nuevoStock);
                        inflowItems.push({
                            eppId: item.eppId,
                            nombre: item.nombre || localEPP.nombre,
                            cantidad: recvQty
                        });
                    }
                }
            }

            // Registrar ingreso por guía automático si hay items recibidos
            if (inflowItems.length > 0) {
                await dbInsertInflow({
                    factura: "GUIA-" + targetObj.codigo,
                    proveedor: "Soporte Operacional (Pedido)",
                    fecha: new Date().toISOString(),
                    items: inflowItems,
                    comentarios: "Ingreso automático por recepción de pedido " + targetObj.codigo + ". " + (comments || ""),
                    registrado_por: targetObj.registrado_por || "Operador"
                });
            }
        }
        return data[0];
    } catch (e) {
        console.warn("Fallo actualización en Supabase, procesando localmente en localStorage.", e);
        const idx = dbSolicitudesAbastecimiento.findIndex(r => r.id === id);
        if (idx !== -1) {
            dbSolicitudesAbastecimiento[idx].estado = status;
            dbSolicitudesAbastecimiento[idx].cantidad_recibida = totalRecv;
            dbSolicitudesAbastecimiento[idx].comentarios = comments || targetObj.comentarios;
            dbSolicitudesAbastecimiento[idx].items = finalItems;
            
            // Si hay items recibidos en esta transacción, aumentar el stock local
            if (updatedItems !== null) {
                const inflowItems = [];
                for (const item of finalItems) {
                    const localEPP = dbInventario.find(i => i.id === item.eppId);
                    if (localEPP) {
                        const recvQty = Number(item.recibido_ahora || 0);
                        if (recvQty > 0) {
                            const nuevoStock = localEPP.stock + recvQty;
                            const eppIdx = dbInventario.findIndex(i => i.id === item.eppId);
                            if (eppIdx !== -1) dbInventario[eppIdx].stock = nuevoStock;
                            
                            inflowItems.push({
                                eppId: item.eppId,
                                nombre: item.nombre || localEPP.nombre,
                                cantidad: recvQty
                            });
                        }
                    }
                }

                // Sincronización local del inflow automático
                if (inflowItems.length > 0) {
                    const localInflow = {
                        id: "INF-" + Date.now(),
                        factura: "GUIA-" + targetObj.codigo,
                        proveedor: "Soporte Operacional (Pedido)",
                        fecha: new Date().toISOString(),
                        items: inflowItems,
                        comentarios: "Ingreso automático por recepción de pedido " + targetObj.codigo + ". " + (comments || ""),
                        registrado_por: targetObj.registrado_por || "Operador"
                    };
                    // Asegurar que dbIngresos esté importado o disponible
                    if (typeof dbIngresos !== "undefined" && dbIngresos.unshift) {
                        dbIngresos.unshift(localInflow);
                    }
                }
            }
        }
        localStorage.setItem("db_solicitudes_abastecimiento", JSON.stringify(dbSolicitudesAbastecimiento));
        return dbSolicitudesAbastecimiento[idx];
    }
}

export async function dbUpdateWorkerProfile(rut, data) {
    const { error } = await supabase.from('salidas')
        .update({
            trabajador: data.trabajador,
            area: data.area,
            turno: data.turno
        })
        .eq('rut', rut);
    if (error) {
        console.warn("Fallo actualización de trabajador en Supabase, procesando localmente.", error);
    }

    // Sincronizar en memoria y localStorage
    dbSalidas.forEach(s => {
        if (s.rut === rut) {
            s.trabajador = data.trabajador;
            s.area = data.area;
            s.turno = data.turno;
        }
    });
    localStorage.setItem("db_salidas", JSON.stringify(dbSalidas));
}
export async function dbDeleteReplenishment(id) {
    try {
        const { error } = await supabase.from('solicitudes_abastecimiento')
            .delete()
            .eq('id', id);
        if (error) throw error;
    } catch (e) {
        console.warn("Fallo eliminación en Supabase solicitudes_abastecimiento, eliminando localmente.", e);
    }

    const idx = dbSolicitudesAbastecimiento.findIndex(r => r.id === id);
    if (idx !== -1) {
        dbSolicitudesAbastecimiento.splice(idx, 1);
    }
    localStorage.setItem("db_solicitudes_abastecimiento", JSON.stringify(dbSolicitudesAbastecimiento));
}

// ==========================================================================
// Módulo de Guías de Despacho (Query & Persistence Layer)
// ==========================================================================

export async function dbFetchGuias() {
    try {
        const { data, error } = await supabase
            .from('guias_despacho')
            .select(`
                *,
                items:guia_despacho_items(*)
            `)
            .order('folio', { ascending: false });

        if (error) throw error;
        if (data && data.length > 0) {
            dbGuias = data;
            safeLocalStorageSet("db_guias_despacho", JSON.stringify(dbGuias));
        }
    } catch (e) {
        console.warn("dbFetchGuias fallback local:", e);
        const local = localStorage.getItem("db_guias_despacho");
        if (local) {
            try { dbGuias = JSON.parse(local); } catch(err) {}
        }
    }
    return dbGuias;
}

export async function dbInsertGuia(guiaData, items = [], auditUser = 'Operador') {
    const nextFolio = guiaData.folio || (dbGuias.length > 0 ? Math.max(...dbGuias.map(g => Number(g.folio) || 0)) + 1 : 1);
    const nowIso = new Date().toISOString();

    const newGuiaRecord = {
        folio: nextFolio,
        fecha: guiaData.fecha || nowIso.split('T')[0],
        hora: guiaData.hora || new Date().toTimeString().slice(0, 5),
        razon_social: guiaData.razon_social || 'ProCleanMG SpA',
        rut_empresa: guiaData.rut_empresa || '76801700-K',
        telefono_empresa: guiaData.telefono_empresa || '934068272',
        correo_empresa: guiaData.correo_empresa || 'mandrade@procleanmg.cl',
        direccion_empresa: guiaData.direccion_empresa || 'Procleanmg',
        emisor_nombre: guiaData.emisor_nombre || 'Marco Andrade',
        emisor_rut: guiaData.emisor_rut || '18276074-9',
        emisor_domicilio: guiaData.emisor_domicilio || 'Av. Iquique 3115',
        emisor_ciudad: guiaData.emisor_ciudad || 'Antofagasta',
        emisor_comuna: guiaData.emisor_comuna || 'Antofagasta',
        emisor_telefono: guiaData.emisor_telefono || '934068272',
        transportista_nombre: guiaData.transportista_nombre || guiaData.chofer || 'Transporte Interno',
        vehiculo: guiaData.vehiculo || 'Maxus T60',
        patente: (guiaData.patente || '').toUpperCase().trim(),
        chofer: guiaData.chofer || 'Chofer de Turno',
        lugar_entrega: guiaData.lugar_entrega,
        observaciones: guiaData.observaciones || '',
        estado: guiaData.estado || 'PENDIENTE',
        created_by: auditUser,
        created_at: nowIso,
        updated_at: nowIso
    };

    let insertedId = null;

    try {
        const { data, error } = await supabase
            .from('guias_despacho')
            .insert(newGuiaRecord)
            .select()
            .single();

        if (error) throw error;
        insertedId = data.id;
        newGuiaRecord.id = insertedId;

        // Insert items
        if (items && items.length > 0) {
            const itemsToInsert = items.map(it => ({
                guia_id: insertedId,
                articulo: it.articulo || '',
                descripcion: it.descripcion,
                cantidad: Number(it.cantidad) || 1,
                unidad: it.unidad || 'UN',
                observacion: it.observacion || ''
            }));
            const { error: errItems } = await supabase.from('guia_despacho_items').insert(itemsToInsert);
            if (errItems) console.warn("Error insertando items en Supabase:", errItems);
        }

        // Audit log
        await supabase.from('guias_despacho_audit').insert({
            guia_id: insertedId,
            folio: nextFolio,
            accion: 'CREACION',
            usuario: auditUser,
            detalles: `Guía Folio #${nextFolio} emitida con destino ${guiaData.lugar_entrega} (${items.length} productos).`
        });

    } catch (e) {
        console.warn("Fallo inserción en Supabase guias_despacho, procesando localmente:", e);
        insertedId = Date.now();
        newGuiaRecord.id = insertedId;
    }

    // Attach items locally
    newGuiaRecord.items = items.map((it, idx) => ({
        id: Date.now() + idx,
        guia_id: insertedId,
        articulo: it.articulo || String(idx + 1),
        descripcion: it.descripcion,
        cantidad: Number(it.cantidad) || 1,
        unidad: it.unidad || 'UN',
        observacion: it.observacion || ''
    }));

    dbGuias.unshift(newGuiaRecord);
    safeLocalStorageSet("db_guias_despacho", JSON.stringify(dbGuias));
    return newGuiaRecord;
}

export async function dbUpdateGuia(id, guiaData, items = null, auditUser = 'Operador') {
    const nowIso = new Date().toISOString();
    const updatePayload = { ...guiaData, updated_at: nowIso };

    try {
        const { error } = await supabase
            .from('guias_despacho')
            .update(updatePayload)
            .eq('id', id);

        if (error) throw error;

        if (items && Array.isArray(items)) {
            await supabase.from('guia_despacho_items').delete().eq('guia_id', id);
            const itemsToInsert = items.map(it => ({
                guia_id: id,
                articulo: it.articulo || '',
                descripcion: it.descripcion,
                cantidad: Number(it.cantidad) || 1,
                unidad: it.unidad || 'UN',
                observacion: it.observacion || ''
            }));
            await supabase.from('guia_despacho_items').insert(itemsToInsert);
        }

        await supabase.from('guias_despacho_audit').insert({
            guia_id: id,
            folio: guiaData.folio,
            accion: 'MODIFICACION',
            usuario: auditUser,
            detalles: `Guía #${guiaData.folio} editada y actualizada por ${auditUser}.`
        });
    } catch (e) {
        console.warn("Fallo actualización en Supabase guias_despacho, guardando localmente:", e);
    }

    const idx = dbGuias.findIndex(g => g.id === id);
    if (idx !== -1) {
        dbGuias[idx] = { ...dbGuias[idx], ...updatePayload };
        if (items) {
            dbGuias[idx].items = items;
        }
    }
    safeLocalStorageSet("db_guias_despacho", JSON.stringify(dbGuias));
    return dbGuias[idx];
}

export async function dbDeleteGuia(id, folio, auditUser = 'Operador') {
    try {
        await supabase.from('guia_despacho_items').delete().eq('guia_id', id);
        const { error } = await supabase.from('guias_despacho').delete().eq('id', id);
        if (error) throw error;

        await supabase.from('guias_despacho_audit').insert({
            guia_id: null,
            folio: folio,
            accion: 'ELIMINACION',
            usuario: auditUser,
            detalles: `Guía Folio #${folio} eliminada permanentemente del sistema.`
        });
    } catch (e) {
        console.warn("Fallo eliminación en Supabase guias_despacho, eliminando localmente:", e);
    }

    dbGuias = dbGuias.filter(g => g.id !== id);
    safeLocalStorageSet("db_guias_despacho", JSON.stringify(dbGuias));
}

export async function dbChangeGuiaEstado(id, nuevoEstado, auditUser = 'Operador', motivo = '') {
    const nowIso = new Date().toISOString();
    const updatePayload = { estado: nuevoEstado, updated_at: nowIso };
    if (nuevoEstado === 'ANULADA' && motivo) {
        updatePayload.motivo_anulacion = motivo;
    }

    const target = dbGuias.find(g => g.id === id);
    const folio = target ? target.folio : null;

    try {
        const { error } = await supabase.from('guias_despacho').update(updatePayload).eq('id', id);
        if (error) throw error;

        await supabase.from('guias_despacho_audit').insert({
            guia_id: id,
            folio: folio,
            accion: nuevoEstado === 'ANULADA' ? 'ANULACION' : 'CAMBIO_ESTADO',
            usuario: auditUser,
            detalles: nuevoEstado === 'ANULADA' ? `Guía #${folio} ANULADA. Motivo: ${motivo}` : `Cambio de estado a ${nuevoEstado} por ${auditUser}.`
        });
    } catch (e) {
        console.warn("Fallo cambio de estado en Supabase guias_despacho, actualizando local:", e);
    }

    if (target) {
        Object.assign(target, updatePayload);
        safeLocalStorageSet("db_guias_despacho", JSON.stringify(dbGuias));
    }
}

export async function dbConfirmarEntrega(id, receptorData, auditUser = 'Chofer / Operador') {
    const nowIso = new Date().toISOString();
    const updatePayload = {
        estado: 'ENTREGADA',
        receptor_nombre: receptorData.receptor_nombre,
        receptor_rut: receptorData.receptor_rut || '',
        receptor_fecha: nowIso,
        firma_digital: receptorData.firma_digital || null,
        foto_comprobante: receptorData.foto_comprobante || null,
        updated_at: nowIso
    };

    const target = dbGuias.find(g => g.id === id);
    const folio = target ? target.folio : null;

    try {
        const { error } = await supabase.from('guias_despacho').update(updatePayload).eq('id', id);
        if (error) throw error;

        await supabase.from('guias_despacho_audit').insert({
            guia_id: id,
            folio: folio,
            accion: 'ENTREGA_CONFORME',
            usuario: auditUser,
            detalles: `Entrega Conforme registrada. Recibió: ${receptorData.receptor_nombre} (${receptorData.receptor_rut || 'Sin RUT'}). Firma digital estampada.`
        });
    } catch (e) {
        console.warn("Fallo confirmar entrega en Supabase guias_despacho, actualizando local:", e);
    }

    if (target) {
        Object.assign(target, updatePayload);
        safeLocalStorageSet("db_guias_despacho", JSON.stringify(dbGuias));
    }
}

export async function dbLogGuiaImpresion(id, folio, auditUser = 'Operador') {
    try {
        await supabase.from('guias_despacho_audit').insert({
            guia_id: id,
            folio: folio,
            accion: 'IMPRESION',
            usuario: auditUser,
            detalles: `Documento oficial de Guía #${folio} impreso o exportado a PDF.`
        });
    } catch (e) {
        // silencioso
    }
}

export async function dbAddGuiaCatalogo(tipo, nombre) {
    const item = { tipo, nombre: nombre.trim(), frecuencia: 1 };
    try {
        const { data, error } = await supabase.from('guias_despacho_catalogos').insert(item).select().single();
        if (!error && data) {
            item.id = data.id;
        }
    } catch (e) {
        console.warn("dbAddGuiaCatalogo local fallback:", e);
    }

    if (tipo === 'vehiculo') dbGuiasCatalogos.vehiculos.push(item);
    if (tipo === 'chofer') dbGuiasCatalogos.choferes.push(item);
    if (tipo === 'destino') dbGuiasCatalogos.destinos.push(item);
    return item;
}

export async function dbDeleteGuiaCatalogo(id, tipo, nombre) {
    try {
        if (id) {
            await supabase.from('guias_despacho_catalogos').delete().eq('id', id);
        } else if (tipo && nombre) {
            await supabase.from('guias_despacho_catalogos').delete().eq('tipo', tipo).eq('nombre', nombre);
        }
    } catch (e) {
        console.warn("dbDeleteGuiaCatalogo local fallback:", e);
    }

    if (tipo === 'vehiculo') dbGuiasCatalogos.vehiculos = dbGuiasCatalogos.vehiculos.filter(v => v.id !== id && v.nombre !== nombre);
    if (tipo === 'chofer') dbGuiasCatalogos.choferes = dbGuiasCatalogos.choferes.filter(c => c.id !== id && c.nombre !== nombre);
    if (tipo === 'destino') dbGuiasCatalogos.destinos = dbGuiasCatalogos.destinos.filter(d => d.id !== id && d.nombre !== nombre);
}
