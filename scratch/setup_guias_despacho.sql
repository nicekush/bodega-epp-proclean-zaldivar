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
    razon_social TEXT DEFAULT 'ProCleanMG SpA',
    rut_empresa TEXT DEFAULT '76801700-K',
    telefono_empresa TEXT DEFAULT '934068272',
    correo_empresa TEXT DEFAULT 'mandrade@procleanmg.cl',
    direccion_empresa TEXT DEFAULT 'Procleanmg',
    emisor_nombre TEXT DEFAULT 'Marco Andrade',
    emisor_rut TEXT DEFAULT '18276074-9',
    emisor_domicilio TEXT DEFAULT 'Av. Iquique 3115',
    emisor_ciudad TEXT DEFAULT 'Antofagasta',
    emisor_comuna TEXT DEFAULT 'Antofagasta',
    emisor_telefono TEXT DEFAULT '934068272',
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

-- 6. POBLADO DE CONFIGURACION INICIAL
INSERT INTO guias_despacho_config (clave, valor) VALUES ('empresa_razon_social', 'ProCleanMG SPA') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO guias_despacho_config (clave, valor) VALUES ('empresa_rut', '76801700-K') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO guias_despacho_config (clave, valor) VALUES ('empresa_telefono', '934068272') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO guias_despacho_config (clave, valor) VALUES ('empresa_correo', 'mandrade@procleanmg.cl') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO guias_despacho_config (clave, valor) VALUES ('empresa_direccion', 'Procleanmg') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO guias_despacho_config (clave, valor) VALUES ('emisor_nombre', 'Marco Andrade') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO guias_despacho_config (clave, valor) VALUES ('emisor_rut', '18276074-9') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO guias_despacho_config (clave, valor) VALUES ('emisor_domicilio', 'Av. Iquique 3115') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO guias_despacho_config (clave, valor) VALUES ('emisor_ciudad', 'Antofagasta') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO guias_despacho_config (clave, valor) VALUES ('emisor_comuna', 'Antofagasta') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;
INSERT INTO guias_despacho_config (clave, valor) VALUES ('emisor_telefono', '934068272') ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor;

-- 7. POBLADO DE CATALOGOS INICIALES
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('vehiculo', 'Maxus T60') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('vehiculo', 'Toyota Hilux') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('vehiculo', 'Mitsubishi L200') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('vehiculo', 'Volkswagen Delivery') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('vehiculo', 'Camión Hino SCBY16') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('vehiculo', 'Hyundai Porter') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('vehiculo', 'Shineray T50') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('vehiculo', 'Bus Yutong') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('vehiculo', 'Grúa Rescate') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'PWM Chile') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'Oficina ANT') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'Taller GMI') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'Kaufman') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'Derco') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'MPM') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'Salmos sur 107') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'Av. Argentina 2309') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'Av. José Infante, Salamanca') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'Faena Minera') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('destino', 'Faena Zaldívar') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('chofer', 'Marco Andrade') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('chofer', 'Luis Gamboa') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('chofer', 'Pedro Velazquez') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('chofer', 'Robert Gonzalez') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('chofer', 'Manuel Espinosa') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('chofer', 'Santos Jofre') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('chofer', 'Alexis Silva') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('chofer', 'Bruno Castro') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('chofer', 'Ignacio Perez') ON CONFLICT (tipo, nombre) DO NOTHING;
INSERT INTO guias_despacho_catalogos (tipo, nombre) VALUES ('chofer', 'Jhon Diaz') ON CONFLICT (tipo, nombre) DO NOTHING;

-- 8. INICIO SIN GUIAS HISTORICAS
-- Las guías y sus detalles se registran desde la aplicación.
-- Se conservan los catálogos y parámetros iniciales anteriores.

-- 9. AJUSTE DE SECUENCIAS (una tabla vacía comienza con ID 1)
SELECT setval('guias_despacho_id_seq', COALESCE((SELECT MAX(id) FROM guias_despacho), 1), EXISTS (SELECT 1 FROM guias_despacho));
SELECT setval('guia_despacho_items_id_seq', COALESCE((SELECT MAX(id) FROM guia_despacho_items), 1), EXISTS (SELECT 1 FROM guia_despacho_items));
SELECT setval('guias_despacho_audit_id_seq', COALESCE((SELECT MAX(id) FROM guias_despacho_audit), 1), EXISTS (SELECT 1 FROM guias_despacho_audit));
SELECT setval('guias_despacho_catalogos_id_seq', COALESCE((SELECT MAX(id) FROM guias_despacho_catalogos), 1), EXISTS (SELECT 1 FROM guias_despacho_catalogos));
