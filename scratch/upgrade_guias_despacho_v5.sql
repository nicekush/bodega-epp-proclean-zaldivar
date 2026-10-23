-- Ejecutar después de Guías v4. Habilita la descripción opcional del encabezado.
-- No incorpora textos predeterminados ni modifica las guías existentes.
BEGIN;

DO $migration$
DECLARE v_source regprocedure; v_definition text; v_updated text;
BEGIN
    v_source := to_regprocedure('public.guias_operar_aplicacion(text,text,jsonb)');
    IF v_source IS NULL OR public.guias_modulo_version() NOT IN (4, 5) THEN
        RAISE EXCEPTION 'Primero instala la actualización de Guías v4.';
    END IF;
    v_definition := pg_get_functiondef(v_source);
    IF position('''empresa_descripcion''' IN v_definition) = 0 THEN
        v_updated := regexp_replace(
            v_definition,
            $pattern$(IF[[:space:]]+v_type[[:space:]]+NOT[[:space:]]+IN[[:space:]]*\()$pattern$,
            $replacement$\1'empresa_descripcion', $replacement$
        );
        IF v_updated = v_definition THEN
            RAISE EXCEPTION 'No se encontró la validación de configuración. No se aplicaron cambios.';
        END IF;
        EXECUTE v_updated;
    END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION public.guias_modulo_version() RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT 5 $$;
REVOKE ALL ON FUNCTION public.guias_modulo_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guias_modulo_version() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
