-- Script para actualizar la tabla 'inventario'
-- Ejecutar en el Editor SQL de Supabase

ALTER TABLE inventario 
ADD COLUMN IF NOT EXISTS duracion_meses INT DEFAULT 6;
