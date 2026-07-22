-- Habilitar Row Level Security (RLS) en todas las tablas
ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingresos ENABLE ROW LEVEL SECURITY;
ALTER TABLE salidas ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos_mejoras ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_abastecimiento ENABLE ROW LEVEL SECURITY;

-- 1. Políticas para 'categorias'
DROP POLICY IF EXISTS "Lectura pública de categorias" ON categorias;
CREATE POLICY "Lectura pública de categorias" ON categorias FOR SELECT USING (true);

DROP POLICY IF EXISTS "Inserción pública de categorias" ON categorias;
CREATE POLICY "Inserción pública de categorias" ON categorias FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Modificación de categorias" ON categorias;
CREATE POLICY "Modificación de categorias" ON categorias FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Eliminación de categorias" ON categorias;
CREATE POLICY "Eliminación de categorias" ON categorias FOR DELETE USING (true);


-- 2. Políticas para 'areas'
DROP POLICY IF EXISTS "Lectura pública de areas" ON areas;
CREATE POLICY "Lectura pública de areas" ON areas FOR SELECT USING (true);

DROP POLICY IF EXISTS "Inserción pública de areas" ON areas;
CREATE POLICY "Inserción pública de areas" ON areas FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Modificación de areas" ON areas;
CREATE POLICY "Modificación de areas" ON areas FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Eliminación de areas" ON areas;
CREATE POLICY "Eliminación de areas" ON areas FOR DELETE USING (true);


-- 3. Políticas para 'inventario'
DROP POLICY IF EXISTS "Lectura pública de inventario" ON inventario;
CREATE POLICY "Lectura pública de inventario" ON inventario FOR SELECT USING (true);

DROP POLICY IF EXISTS "Modificación de inventario para control de stock" ON inventario;
CREATE POLICY "Modificación de inventario para control de stock" ON inventario FOR ALL USING (true);


-- 4. Políticas para 'ingresos' (Historial de Entradas)
DROP POLICY IF EXISTS "Lectura pública de ingresos" ON ingresos;
CREATE POLICY "Lectura pública de ingresos" ON ingresos FOR SELECT USING (true);

DROP POLICY IF EXISTS "Inserción pública de ingresos" ON ingresos;
CREATE POLICY "Inserción pública de ingresos" ON ingresos FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Eliminación de ingresos" ON ingresos;
CREATE POLICY "Eliminación de ingresos" ON ingresos FOR DELETE USING (true);


-- 5. Políticas para 'salidas' (Historial de Entregas)
DROP POLICY IF EXISTS "Lectura pública de salidas" ON salidas;
CREATE POLICY "Lectura pública de salidas" ON salidas FOR SELECT USING (true);

DROP POLICY IF EXISTS "Inserción pública de salidas" ON salidas;
CREATE POLICY "Inserción pública de salidas" ON salidas FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Eliminación de salidas" ON salidas;
CREATE POLICY "Eliminación de salidas" ON salidas FOR DELETE USING (true);


-- 6. Políticas para 'insumos_mejoras'
DROP POLICY IF EXISTS "Lectura pública de insumos_mejoras" ON insumos_mejoras;
CREATE POLICY "Lectura pública de insumos_mejoras" ON insumos_mejoras FOR SELECT USING (true);

DROP POLICY IF EXISTS "Acceso completo a insumos_mejoras" ON insumos_mejoras;
CREATE POLICY "Acceso completo a insumos_mejoras" ON insumos_mejoras FOR ALL USING (true);


-- 7. Políticas para 'insumos_movimientos'
DROP POLICY IF EXISTS "Lectura pública de insumos_movimientos" ON insumos_movimientos;
CREATE POLICY "Lectura pública de insumos_movimientos" ON insumos_movimientos FOR SELECT USING (true);

DROP POLICY IF EXISTS "Inserción de insumos_movimientos" ON insumos_movimientos;
CREATE POLICY "Inserción de insumos_movimientos" ON insumos_movimientos FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Eliminación de insumos_movimientos" ON insumos_movimientos;
CREATE POLICY "Eliminación de insumos_movimientos" ON insumos_movimientos FOR DELETE USING (true);


-- 8. Políticas para 'usuarios' (Gestión de Operadores, Permisos y Accesos)
DROP POLICY IF EXISTS "Lectura pública de usuarios" ON usuarios;
CREATE POLICY "Lectura pública de usuarios" ON usuarios FOR SELECT USING (true);

DROP POLICY IF EXISTS "Inserción de usuarios" ON usuarios;
CREATE POLICY "Inserción de usuarios" ON usuarios FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Modificación de usuarios" ON usuarios;
CREATE POLICY "Modificación de usuarios" ON usuarios FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Eliminación de usuarios" ON usuarios;
CREATE POLICY "Eliminación de usuarios" ON usuarios FOR DELETE USING (true);


-- 9. Políticas para 'solicitudes_abastecimiento' (Solicitudes de Compra)
DROP POLICY IF EXISTS "Lectura pública de solicitudes_abastecimiento" ON solicitudes_abastecimiento;
CREATE POLICY "Lectura pública de solicitudes_abastecimiento" ON solicitudes_abastecimiento FOR SELECT USING (true);

DROP POLICY IF EXISTS "Inserción pública de solicitudes_abastecimiento" ON solicitudes_abastecimiento;
CREATE POLICY "Inserción pública de solicitudes_abastecimiento" ON solicitudes_abastecimiento FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Modificación de solicitudes_abastecimiento" ON solicitudes_abastecimiento;
CREATE POLICY "Modificación de solicitudes_abastecimiento" ON solicitudes_abastecimiento FOR UPDATE USING (true);

DROP POLICY IF EXISTS "Eliminación de solicitudes_abastecimiento" ON solicitudes_abastecimiento;
CREATE POLICY "Eliminación de solicitudes_abastecimiento" ON solicitudes_abastecimiento FOR DELETE USING (true);


-- 10. Funciones Almacenadas RPC (Fallback de seguridad con SECURITY DEFINER)

CREATE OR REPLACE FUNCTION actualizar_usuario(
    p_rut TEXT,
    p_nombre TEXT,
    p_rol TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE usuarios
    SET nombre = p_nombre,
        rol = p_rol
    WHERE rut = p_rut;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION eliminar_usuario(
    p_rut TEXT
)
RETURNS VOID AS $$
BEGIN
    DELETE FROM usuarios
    WHERE rut = p_rut;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
