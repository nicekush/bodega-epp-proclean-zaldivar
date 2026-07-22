-- Crear tabla de turnos en Supabase
-- Ejecutar en el Editor SQL de Supabase

CREATE TABLE IF NOT EXISTS turnos (
    id BIGSERIAL PRIMARY KEY,
    nombre TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS
ALTER TABLE turnos ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS
DROP POLICY IF EXISTS "Lectura pública de turnos" ON turnos;
CREATE POLICY "Lectura pública de turnos" ON turnos FOR SELECT USING (true);

DROP POLICY IF EXISTS "Inserción pública de turnos" ON turnos;
CREATE POLICY "Inserción pública de turnos" ON turnos FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Eliminación de turnos" ON turnos;
CREATE POLICY "Eliminación de turnos" ON turnos FOR DELETE USING (true);

-- Insertar turnos iniciales por defecto
INSERT INTO turnos (nombre) VALUES 
('Turno A'),
('Turno B'),
('Turno C'),
('Turno D'),
('Día'),
('Noche')
ON CONFLICT (nombre) DO NOTHING;
