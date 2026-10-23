-- Ejecutar después de Guías v3. Permite conductor y vehículo en blanco.
-- Conserva datos, folios, auditoría y las demás validaciones.
BEGIN;

DO $migration$
DECLARE v_source regprocedure; v_definition text; v_updated text;
BEGIN
    v_source := to_regprocedure('public.guias_operar_aplicacion(text,text,jsonb)');
    IF v_source IS NULL THEN
        RAISE EXCEPTION 'Primero instala la actualización de Guías v3.';
    END IF;
    v_definition := pg_get_functiondef(v_source);
    IF position('Completa destino, chofer y vehículo.' IN v_definition) > 0 THEN
        v_updated := regexp_replace(
            v_definition,
            $pattern$(PERFORM[[:space:]]+guia_private\.validar_carga\(v_items\);[[:space:]]*)IF[[:space:]]+.*?RAISE[[:space:]]+EXCEPTION[[:space:]]+'Completa destino, chofer y vehículo\.';[[:space:]]*END[[:space:]]+IF;$pattern$,
            $replacement$\1IF length(btrim(COALESCE(v_g->>'lugar_entrega',''))) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Completa el destino de entrega.'; END IF;$replacement$,
            's'
        );
        IF v_updated = v_definition THEN
            RAISE EXCEPTION 'La validación instalada no coincide con la migración. No se aplicaron cambios.';
        END IF;
        EXECUTE v_updated;
    ELSIF position('Completa el destino de entrega.' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'La función instalada no corresponde a Guías v3/v4.';
    END IF;
END
$migration$;

CREATE OR REPLACE FUNCTION public.guias_modulo_version() RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT 4 $$;
REVOKE ALL ON FUNCTION public.guias_modulo_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guias_modulo_version() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
