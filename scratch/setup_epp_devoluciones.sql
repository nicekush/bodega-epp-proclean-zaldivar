-- Ejecutar en el editor SQL de Supabase. No modifica actas ni stock existentes.
-- Usa el contrato de usuario por RUT de la aplicación (igual que Guías v3).
BEGIN;

CREATE TABLE IF NOT EXISTS public.epp_devoluciones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL UNIQUE,
    salida_id text NOT NULL,
    fecha timestamptz NOT NULL DEFAULT clock_timestamp(),
    trabajador text NOT NULL,
    rut text NOT NULL,
    area text NOT NULL,
    turno text NOT NULL,
    motivo text NOT NULL CHECK (length(btrim(motivo)) BETWEEN 1 AND 500),
    notas text NOT NULL DEFAULT '',
    condicion text NOT NULL DEFAULT 'SIN_USO_APTO' CHECK (condicion = 'SIN_USO_APTO'),
    registrado_por text NOT NULL,
    registrado_por_rut text NOT NULL,
    items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) > 0),
    solicitud jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS epp_devoluciones_salida_idx ON public.epp_devoluciones(salida_id);
ALTER TABLE public.epp_devoluciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS epp_devoluciones_lectura ON public.epp_devoluciones;
CREATE POLICY epp_devoluciones_lectura ON public.epp_devoluciones FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.epp_devoluciones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.epp_devoluciones TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.epp_registrar_devolucion(
    p_rut text, p_salida_id text, p_items jsonb, p_motivo text, p_notas text, p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_actor public.usuarios%ROWTYPE;
    v_salida public.salidas%ROWTYPE;
    v_existing public.epp_devoluciones%ROWTYPE;
    v_record public.epp_devoluciones%ROWTYPE;
    v_item jsonb; v_original jsonb; v_items jsonb := '[]'::jsonb;
    v_line integer; v_seen integer[] := ARRAY[]::integer[];
    v_quantity numeric; v_returned numeric; v_delivered numeric; v_stock numeric;
    v_product text; v_product_row public.inventario%ROWTYPE;
    v_request jsonb;
BEGIN
    SELECT * INTO v_actor FROM public.usuarios u
    WHERE regexp_replace(upper(u.rut), '[^0-9K]', '', 'g') = regexp_replace(upper(p_rut), '[^0-9K]', '', 'g');
    IF v_actor.rut IS NULL OR COALESCE(v_actor.rol, '') NOT IN ('Administrador', 'Supervisor', 'Bodeguero') THEN
        RAISE EXCEPTION 'Inicia sesión con un usuario autorizado para recibir devoluciones.' USING ERRCODE = '42501';
    END IF;
    IF p_request_id IS NULL OR p_salida_id IS NULL OR p_motivo IS NULL OR length(btrim(p_motivo)) NOT BETWEEN 1 AND 500
       OR length(COALESCE(p_notas, '')) > 4000 THEN
        RAISE EXCEPTION 'Completa el acta, motivo y referencia de la devolución.';
    END IF;
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Selecciona artículos para devolver.'; END IF;
    IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Selecciona entre 1 y 500 artículos.'; END IF;
    v_request := jsonb_build_object('salida_id', p_salida_id, 'items', p_items, 'motivo', btrim(p_motivo), 'notas', btrim(COALESCE(p_notas, '')));
    PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
    SELECT * INTO v_existing FROM public.epp_devoluciones WHERE request_id = p_request_id;
    IF FOUND THEN
        IF v_existing.solicitud <> v_request OR v_existing.registrado_por_rut <> v_actor.rut THEN
            RAISE EXCEPTION 'Esta solicitud ya fue registrada con otros datos. Abre una nueva devolución.';
        END IF;
        RETURN to_jsonb(v_existing);
    END IF;
    SELECT * INTO v_salida FROM public.salidas WHERE id::text = p_salida_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'El acta original ya no existe.'; END IF;
    IF v_salida.fecha::timestamptz > clock_timestamp() THEN RAISE EXCEPTION 'El acta tiene una fecha futura. Revisa el registro original.'; END IF;
    -- El orden estable evita interbloqueos entre devoluciones de distintos SKU.
    PERFORM 1 FROM public.inventario i WHERE i.id::text IN (
        SELECT v_salida.items::jsonb -> ((x->>'linea')::integer) ->> 'eppId'
        FROM jsonb_array_elements(p_items) x
        WHERE jsonb_typeof(x->'linea') = 'number' AND (x->>'linea') ~ '^[0-9]{1,6}$'
    ) ORDER BY i.id::text FOR UPDATE;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        IF jsonb_typeof(v_item->'linea') IS DISTINCT FROM 'number' OR (v_item->>'linea') !~ '^[0-9]{1,6}$'
           OR jsonb_typeof(v_item->'cantidad') IS DISTINCT FROM 'number' THEN
            RAISE EXCEPTION 'Línea o cantidad no válida.';
        END IF;
        v_line := (v_item->>'linea')::integer;
        IF v_line = ANY(v_seen) THEN RAISE EXCEPTION 'La línea está repetida.'; END IF;
        v_seen := array_append(v_seen, v_line);
        v_original := v_salida.items::jsonb -> v_line;
        IF v_original IS NULL THEN RAISE EXCEPTION 'La línea no pertenece al acta.'; END IF;
        IF jsonb_typeof(v_original->'cantidad') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'La entrega original no tiene una cantidad válida.'; END IF;
        v_product := v_original->>'eppId';
        IF v_item->>'eppId' IS DISTINCT FROM v_product
           OR v_item->'entregado' IS DISTINCT FROM v_original->'cantidad' THEN
            RAISE EXCEPTION 'La entrega original cambió. Cierra y actualiza la página antes de recibir el material.';
        END IF;
        v_quantity := (v_item->>'cantidad')::numeric;
        v_delivered := (v_original->>'cantidad')::numeric;
        SELECT COALESCE(sum((detail->>'cantidad')::numeric), 0) INTO v_returned
        FROM public.epp_devoluciones d CROSS JOIN LATERAL jsonb_array_elements(d.items) detail
        WHERE d.salida_id = p_salida_id AND (detail->>'linea')::integer = v_line;
        IF v_delivered IS NULL OR v_quantity <= 0 OR v_quantity > v_delivered - v_returned THEN
            RAISE EXCEPTION 'La cantidad supera el saldo por devolver o no es positiva. Actualiza el acta.';
        END IF;
        SELECT * INTO v_product_row FROM public.inventario WHERE id::text = v_product;
        IF NOT FOUND THEN RAISE EXCEPTION 'El producto ya no existe en inventario.'; END IF;
        IF to_jsonb(v_product_row)->>'tipo_control' = 'Préstamo' THEN RAISE EXCEPTION 'Usa el módulo de préstamos para este producto.'; END IF;
        v_stock := v_product_row.stock;
        IF v_stock IS NULL THEN RAISE EXCEPTION 'El producto no tiene un stock válido.'; END IF;
        UPDATE public.inventario SET stock = stock + v_quantity WHERE id::text = v_product RETURNING * INTO v_product_row;
        IF v_product_row.stock - v_stock <> v_quantity THEN
            RAISE EXCEPTION 'La cantidad no es compatible con la precisión del stock de este producto.';
        END IF;
        v_items := v_items || jsonb_build_array(jsonb_build_object(
            'linea', v_line, 'eppId', v_product, 'cantidad', v_quantity,
            'codigo', v_product_row.codigo, 'nombre', v_product_row.nombre,
            'unidad', COALESCE(to_jsonb(v_product_row)->>'unidad', 'u.'),
            'stock_anterior', v_stock, 'stock_nuevo', v_stock + v_quantity
        ));
    END LOOP;
    INSERT INTO public.epp_devoluciones(request_id, salida_id, trabajador, rut, area, turno,
        motivo, notas, registrado_por, registrado_por_rut, items, solicitud)
    VALUES(p_request_id, p_salida_id, COALESCE(v_salida.trabajador, ''), COALESCE(v_salida.rut, ''),
        COALESCE(v_salida.area, ''), COALESCE(to_jsonb(v_salida)->>'turno', ''),
        btrim(p_motivo), btrim(COALESCE(p_notas, '')), v_actor.nombre, v_actor.rut, v_items, v_request)
    RETURNING * INTO v_record;
    RETURN to_jsonb(v_record);
END $$;
REVOKE ALL ON FUNCTION public.epp_registrar_devolucion(text,text,jsonb,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.epp_registrar_devolucion(text,text,jsonb,text,text,uuid) TO anon, authenticated;

-- Protege el documento origen y su identidad; el perfil se podrá editar en actas sin devoluciones.
CREATE OR REPLACE FUNCTION public.epp_proteger_acta_devuelta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF EXISTS(SELECT 1 FROM public.epp_devoluciones WHERE salida_id = OLD.id::text) THEN
        IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'El acta tiene devoluciones y debe conservarse.'; END IF;
        IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
            RAISE EXCEPTION 'No se puede modificar una entrega con devoluciones.';
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.epp_proteger_acta_devuelta() FROM PUBLIC;
DROP TRIGGER IF EXISTS epp_acta_devuelta_protegida ON public.salidas;
CREATE TRIGGER epp_acta_devuelta_protegida BEFORE UPDATE OR DELETE ON public.salidas
FOR EACH ROW EXECUTE FUNCTION public.epp_proteger_acta_devuelta();

NOTIFY pgrst, 'reload schema';
COMMIT;
