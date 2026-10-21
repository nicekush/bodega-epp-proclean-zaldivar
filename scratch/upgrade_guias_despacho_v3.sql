-- Ejecutar después de upgrade_guias_despacho_v2.sql.
-- Guías utiliza el usuario activo de la aplicación, sin token ni clave adicional.
-- Conserva guías, artículos, auditoría, catálogos, parámetros y contador de folios.
BEGIN;

CREATE OR REPLACE FUNCTION guia_private.actor_aplicacion(p_rut text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_actor jsonb;
BEGIN
    IF length(btrim(COALESCE(p_rut, ''))) = 0 THEN
        RAISE EXCEPTION 'Inicia sesión en la aplicación antes de operar con guías.' USING ERRCODE = '28000';
    END IF;
    SELECT jsonb_build_object('rut', u.rut, 'nombre', u.nombre, 'rol', u.rol)
    INTO v_actor FROM public.usuarios u
    WHERE regexp_replace(upper(u.rut), '[.[:space:]-]', '', 'g')
        = regexp_replace(upper(p_rut), '[.[:space:]-]', '', 'g');
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'El usuario ya no está disponible. Inicia sesión nuevamente.' USING ERRCODE = '28000';
    END IF;
    RETURN v_actor;
END $$;

-- Reutiliza íntegramente la operación transaccional instalada en v2.
-- Cambia solamente el punto de entrada y la identificación del usuario.
DO $$
DECLARE v_source regprocedure; v_definition text;
BEGIN
    v_source := COALESCE(
        to_regprocedure('public.guias_operar_aplicacion(text,text,jsonb)'),
        to_regprocedure('public.guias_operar(text,text,jsonb)')
    );
    IF v_source IS NULL THEN
        RAISE EXCEPTION 'Primero ejecuta la migración de Guías v2.';
    END IF;
    v_definition := pg_get_functiondef(v_source);
    IF position('guia_private.actor(p_token)' IN v_definition) = 0
       AND position('guia_private.actor_aplicacion(p_rut)' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'La función instalada no coincide con Guías v2/v3.';
    END IF;
    v_definition := replace(v_definition, 'public.guias_operar(', 'public.guias_operar_aplicacion(');
    v_definition := replace(v_definition, 'p_token text', 'p_rut text');
    v_definition := replace(v_definition, 'guia_private.actor(p_token)', 'guia_private.actor_aplicacion(p_rut)');
    EXECUTE v_definition;
END $$;

REVOKE ALL ON FUNCTION guia_private.actor_aplicacion(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guias_operar_aplicacion(text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guias_operar_aplicacion(text,text,jsonb) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.guias_operar(text,text,jsonb);
DROP FUNCTION IF EXISTS public.guias_iniciar_sesion(text,text);
DROP FUNCTION IF EXISTS public.guias_cerrar_sesion(text);
DROP FUNCTION IF EXISTS guia_private.actor(text);
DROP TABLE IF EXISTS guia_private.sessions;

CREATE OR REPLACE FUNCTION public.guias_modulo_version() RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT 3 $$;
REVOKE ALL ON FUNCTION public.guias_modulo_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guias_modulo_version() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
