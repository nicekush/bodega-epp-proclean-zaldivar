-- ==========================================================================
-- SCRIPT DE INSTALACION Y MIGRACION: MODULO GUIAS DE DESPACHO (PROCLEANMG)
-- Ejecutar este script completo en el Editor SQL de Supabase
-- ==========================================================================

-- 1. TABLA MAESTRA DE GUIAS DE DESPACHO
CREATE TABLE IF NOT EXISTS guias_despacho (
    id BIGSERIAL PRIMARY KEY,
    folio INTEGER UNIQUE NOT NULL,
    fecha DATE NOT NULL,
    hora TEXT DEFAULT '09:00',
    razon_social TEXT,
    rut_empresa TEXT,
    telefono_empresa TEXT,
    correo_empresa TEXT,
    direccion_empresa TEXT,
    emisor_nombre TEXT,
    emisor_rut TEXT,
    emisor_domicilio TEXT,
    emisor_ciudad TEXT,
    emisor_comuna TEXT,
    emisor_telefono TEXT,
    transportista_nombre TEXT,
    vehiculo TEXT,
    patente TEXT,
    chofer TEXT,
    lugar_entrega TEXT NOT NULL,
    observaciones TEXT,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE', -- PENDIENTE, EN_TRANSITO, ENTREGADA, ANULADA
    motivo_anulacion TEXT,
    receptor_nombre TEXT,
    receptor_rut TEXT,
    receptor_fecha TEXT,
    firma_digital TEXT,
    foto_comprobante TEXT,
    created_by TEXT DEFAULT 'Operador',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. TABLA DE ITEMS / CARGA DE LA GUIA
CREATE TABLE IF NOT EXISTS guia_despacho_items (
    id BIGSERIAL PRIMARY KEY,
    guia_id BIGINT NOT NULL REFERENCES guias_despacho(id) ON DELETE CASCADE,
    articulo TEXT,
    descripcion TEXT NOT NULL,
    cantidad NUMERIC NOT NULL DEFAULT 1,
    unidad TEXT DEFAULT 'UN',
    observacion TEXT
);

-- 3. TABLA DE AUDITORIA Y TRAZABILIDAD
CREATE TABLE IF NOT EXISTS guias_despacho_audit (
    id BIGSERIAL PRIMARY KEY,
    guia_id BIGINT,
    folio INTEGER,
    accion TEXT NOT NULL,
    usuario TEXT DEFAULT 'Operador',
    detalles TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. TABLA DE CATALOGOS (VEHICULOS, CHOFERES, DESTINOS)
CREATE TABLE IF NOT EXISTS guias_despacho_catalogos (
    id BIGSERIAL PRIMARY KEY,
    tipo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    frecuencia INTEGER DEFAULT 1,
    UNIQUE(tipo, nombre)
);

-- 5. TABLA DE CONFIGURACION
CREATE TABLE IF NOT EXISTS guias_despacho_config (
    clave TEXT PRIMARY KEY,
    valor TEXT
);

-- HABILITAR ROW LEVEL SECURITY (RLS)
ALTER TABLE guias_despacho ENABLE ROW LEVEL SECURITY;
ALTER TABLE guia_despacho_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE guias_despacho_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE guias_despacho_catalogos ENABLE ROW LEVEL SECURITY;
ALTER TABLE guias_despacho_config ENABLE ROW LEVEL SECURITY;

-- POLITICAS RLS (Lectura, Insercion, Modificacion y Eliminacion)
DROP POLICY IF EXISTS "Acceso total guias_despacho" ON guias_despacho;
CREATE POLICY "Acceso total guias_despacho" ON guias_despacho FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total guia_despacho_items" ON guia_despacho_items;
CREATE POLICY "Acceso total guia_despacho_items" ON guia_despacho_items FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total guias_despacho_audit" ON guias_despacho_audit;
CREATE POLICY "Acceso total guias_despacho_audit" ON guias_despacho_audit FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total guias_despacho_catalogos" ON guias_despacho_catalogos;
CREATE POLICY "Acceso total guias_despacho_catalogos" ON guias_despacho_catalogos FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total guias_despacho_config" ON guias_despacho_config;
CREATE POLICY "Acceso total guias_despacho_config" ON guias_despacho_config FOR ALL USING (true) WITH CHECK (true);

-- 6. CONFIGURACIÓN ADMINISTRADA DESDE LA APLICACIÓN
-- Las instalaciones nuevas parten con empresa, emisor y catálogos vacíos.
-- Los datos se agregan en Guías de Despacho > Configuración.
-- Reejecutar este archivo conserva los valores previamente configurados.

-- 8. INICIO SIN GUIAS HISTORICAS
-- Las guías y sus detalles se registran desde la aplicación.
-- Se conservan los catálogos y parámetros existentes.

-- 9. AJUSTE DE SECUENCIAS (una tabla vacía comienza con ID 1)
SELECT setval('guias_despacho_id_seq', COALESCE((SELECT MAX(id) FROM guias_despacho), 1), EXISTS (SELECT 1 FROM guias_despacho));
SELECT setval('guia_despacho_items_id_seq', COALESCE((SELECT MAX(id) FROM guia_despacho_items), 1), EXISTS (SELECT 1 FROM guia_despacho_items));
SELECT setval('guias_despacho_audit_id_seq', COALESCE((SELECT MAX(id) FROM guias_despacho_audit), 1), EXISTS (SELECT 1 FROM guias_despacho_audit));
SELECT setval('guias_despacho_catalogos_id_seq', COALESCE((SELECT MAX(id) FROM guias_despacho_catalogos), 1), EXISTS (SELECT 1 FROM guias_despacho_catalogos));
