import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

export const migration = readFileSync(new URL('../../scratch/setup_epp_devoluciones.sql', import.meta.url), 'utf8');
export async function createReturnsDatabase({ integerStock = false } = {}) {
    const db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
        CREATE TABLE usuarios(rut text PRIMARY KEY, nombre text, rol text);
        INSERT INTO usuarios VALUES ('11.111.111-1','Bodega de prueba','Bodeguero'),('22.222.222-2','Lectura','Consulta');
        CREATE TABLE inventario(id text PRIMARY KEY, codigo text, nombre text, unidad text, stock ${integerStock ? 'integer' : 'numeric'}, stock_minimo numeric DEFAULT 1, duracion_meses integer DEFAULT 6, tipo_control text DEFAULT 'Consumo', categoria text DEFAULT 'Manos');
        INSERT INTO inventario(id,codigo,nombre,unidad,stock) VALUES ('g','G-01','Guantes de prueba','Par',7),('c','C-01','Casco de prueba','Unidad',8);
        CREATE TABLE salidas(id text PRIMARY KEY, fecha timestamptz, trabajador text, rut text, area text, turno text, items jsonb, firma text, registrado_por text);
        INSERT INTO salidas VALUES ('a','2026-09-01T12:00:00Z','Ana Prueba','33.333.333-3','Operaciones','Turno A','[{"eppId":"g","cantidad":3},{"eppId":"c","cantidad":2}]','Firma Física en Acta Impresa','Bodega');`);
    await db.exec(migration);
    return db;
}
