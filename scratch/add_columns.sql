-- Script para actualizar la tabla 'insumos_mejoras'
-- Ejecutar en el Editor SQL de Supabase

ALTER TABLE insumos_mejoras 
ADD COLUMN IF NOT EXISTS trabajador TEXT,
ADD COLUMN IF NOT EXISTS rut TEXT,
ADD COLUMN IF NOT EXISTS turno TEXT,
ADD COLUMN IF NOT EXISTS prioridad TEXT DEFAULT 'Media',
ADD COLUMN IF NOT EXISTS evidencia TEXT;
