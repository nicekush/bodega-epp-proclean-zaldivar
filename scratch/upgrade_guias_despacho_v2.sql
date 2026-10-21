-- Guías de Despacho v2. Ejecutar completo una vez en el editor SQL de Supabase.
-- No importa, elimina ni reinicia guías. Conserva los catálogos y parámetros existentes.
BEGIN;

CREATE SCHEMA IF NOT EXISTS guia_private;
REVOKE ALL ON SCHEMA guia_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS guia_private.sessions (
    token_hash text PRIMARY KEY, rut text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS guia_private.folio_counter (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), last_folio integer NOT NULL CHECK (last_folio >= 0)
);
INSERT INTO guia_private.folio_counter (singleton, last_folio)
VALUES (true, (SELECT COALESCE(MAX(folio), 0) FROM public.guias_despacho))
ON CONFLICT (singleton) DO UPDATE SET last_folio = GREATEST(guia_private.folio_counter.last_folio, EXCLUDED.last_folio);

ALTER TABLE public.guias_despacho ADD COLUMN IF NOT EXISTS despachado_at timestamptz;
ALTER TABLE public.guias_despacho ADD COLUMN IF NOT EXISTS request_id uuid;
ALTER TABLE public.guias_despacho ADD COLUMN IF NOT EXISTS request_fingerprint text;
CREATE UNIQUE INDEX IF NOT EXISTS guias_request_id_unique ON public.guias_despacho(request_id) WHERE request_id IS NOT NULL;
ALTER TABLE public.guias_despacho_audit ADD COLUMN IF NOT EXISTS datos_antes jsonb;
ALTER TABLE public.guias_despacho_audit ADD COLUMN IF NOT EXISTS datos_despues jsonb;
CREATE INDEX IF NOT EXISTS guias_audit_guia_fecha ON public.guias_despacho_audit(guia_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION guia_private.actor(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_actor jsonb;
BEGIN
    SELECT jsonb_build_object('rut', u.rut, 'nombre', u.nombre, 'rol', u.rol) INTO v_actor
    FROM guia_private.sessions s JOIN public.usuarios u
      ON regexp_replace(upper(u.rut), '[.[:space:]-]', '', 'g') = regexp_replace(upper(s.rut), '[.[:space:]-]', '', 'g')
    WHERE s.token_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex') AND s.expires_at > clock_timestamp();
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Confirma tu clave para operar en Guías de Despacho.' USING ERRCODE = '28000'; END IF;
    RETURN v_actor;
END $$;

CREATE OR REPLACE FUNCTION public.guias_modulo_version() RETURNS integer
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$ SELECT 2 $$;

CREATE OR REPLACE FUNCTION public.guias_iniciar_sesion(p_rut text, p_password text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_verified jsonb; v_actor jsonb; v_token text; v_expires timestamptz;
BEGIN
    SELECT to_jsonb(v) INTO v_verified FROM public.verificar_credenciales(p_rut, p_password) v LIMIT 1;
    IF NOT COALESCE((v_verified->>'success')::boolean, false) THEN
        RAISE EXCEPTION 'RUT o clave incorrectos.' USING ERRCODE = '28000';
    END IF;
    IF COALESCE((v_verified->>'cambio_clave_pendiente')::boolean, false) THEN
        RAISE EXCEPTION 'Completa el cambio de clave antes de operar con guías.' USING ERRCODE = '28000';
    END IF;
    SELECT jsonb_build_object('rut', u.rut, 'nombre', u.nombre, 'rol', u.rol) INTO v_actor FROM public.usuarios u
    WHERE regexp_replace(upper(u.rut), '[.[:space:]-]', '', 'g') = regexp_replace(upper(v_verified->>'rut'), '[.[:space:]-]', '', 'g');
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Usuario no disponible.' USING ERRCODE = '28000'; END IF;
    v_token := gen_random_uuid()::text || gen_random_uuid()::text;
    v_expires := clock_timestamp() + interval '8 hours';
    DELETE FROM guia_private.sessions WHERE expires_at <= clock_timestamp();
    INSERT INTO guia_private.sessions VALUES (encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), v_actor->>'rut', v_expires);
    RETURN jsonb_build_object('token', v_token, 'expires_at', v_expires, 'user', v_actor);
END $$;

CREATE OR REPLACE FUNCTION public.guias_cerrar_sesion(p_token text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
    DELETE FROM guia_private.sessions WHERE token_hash = encode(sha256(convert_to(COALESCE(p_token, ''), 'UTF8')), 'hex')
$$;

CREATE OR REPLACE FUNCTION guia_private.documento(p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT to_jsonb(g) || jsonb_build_object('items', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id)
      FROM public.guia_despacho_items i WHERE i.guia_id = g.id), '[]'::jsonb))
    FROM public.guias_despacho g WHERE g.id = p_id
$$;

CREATE OR REPLACE FUNCTION guia_private.auditable(p_doc jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
    SELECT (p_doc - 'firma_digital' - 'foto_comprobante' - 'request_fingerprint') ||
      jsonb_build_object('firma_registrada', COALESCE(length(p_doc->>'firma_digital'), 0) > 0)
$$;

CREATE OR REPLACE FUNCTION guia_private.validar_carga(p_items jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE v_item jsonb;
BEGIN
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Indica los artículos de la carga.'; END IF;
    IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'La carga debe contener entre 1 y 500 artículos.'; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        IF length(btrim(COALESCE(v_item->>'descripcion', ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Completa la descripción de cada artículo (máximo 2000 caracteres).'; END IF;
        IF jsonb_typeof(v_item->'cantidad') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'La cantidad debe ser numérica.'; END IF;
        IF (v_item->>'cantidad')::numeric <= 0 OR (v_item->>'cantidad')::numeric > 1000000000 THEN RAISE EXCEPTION 'Las cantidades deben ser positivas y válidas.'; END IF;
        IF COALESCE(v_item->>'unidad', '') NOT IN ('UN','GL','CJ','LT','KG','PAR') THEN RAISE EXCEPTION 'Unidad de carga no válida.'; END IF;
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.guias_operar(p_token text, p_action text, p_payload jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
    v_actor jsonb := guia_private.actor(p_token); v_manager boolean; v_id bigint;
    v_g jsonb; v_items jsonb; v_before jsonb; v_after jsonb; v_config jsonb;
    v_row public.guias_despacho%ROWTYPE; v_folio integer; v_request uuid; v_fingerprint text;
    v_action text; v_details text; v_type text; v_name text; v_catalog jsonb; v_image bytea;
BEGIN
    v_manager := COALESCE(v_actor->>'rol' IN ('Administrador', 'Supervisor'), false);
    IF p_action = 'auditoria' THEN
        v_id := (p_payload->>'id')::bigint;
        RETURN COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC, a.id DESC)
          FROM public.guias_despacho_audit a WHERE a.guia_id = v_id), '[]'::jsonb);
    END IF;
    -- Una misma operación serializa la reserva de folio y la comprobación de reintentos.
    PERFORM pg_advisory_xact_lock(726724, 1);

    IF p_action = 'configurar' THEN
        IF NOT v_manager THEN RAISE EXCEPTION 'Solo supervisores o administradores pueden configurar las guías.' USING ERRCODE = '42501'; END IF;
        IF jsonb_typeof(p_payload->'config') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Configuración inválida.'; END IF;
        FOR v_type, v_name IN SELECT key, value FROM jsonb_each_text(p_payload->'config') LOOP
            IF v_type NOT IN ('empresa_razon_social','empresa_rut','empresa_telefono','empresa_correo','empresa_direccion',
                'emisor_nombre','emisor_rut','emisor_domicilio','emisor_ciudad','emisor_comuna','emisor_telefono') THEN RAISE EXCEPTION 'Parámetro no permitido: %', v_type; END IF;
            IF length(COALESCE(v_name,'')) > 500 THEN RAISE EXCEPTION 'El parámetro es demasiado largo.'; END IF;
            INSERT INTO public.guias_despacho_config(clave,valor) VALUES(v_type,btrim(v_name)) ON CONFLICT(clave) DO UPDATE SET valor=EXCLUDED.valor;
        END LOOP;
        INSERT INTO public.guias_despacho_audit(accion,usuario,detalles) VALUES('CONFIGURACION',v_actor->>'nombre','Parámetros de emisión actualizados.');
        RETURN COALESCE((SELECT jsonb_object_agg(clave,valor) FROM public.guias_despacho_config), '{}'::jsonb);
    END IF;

    IF p_action IN ('catalogo_agregar','catalogo_eliminar') THEN
        IF NOT v_manager THEN RAISE EXCEPTION 'Solo supervisores o administradores pueden modificar los catálogos.' USING ERRCODE = '42501'; END IF;
        IF p_action = 'catalogo_agregar' THEN
            v_type := p_payload->>'tipo'; v_name := btrim(p_payload->>'nombre');
            IF v_type IS NULL OR v_type NOT IN ('vehiculo','chofer','destino') OR COALESCE(length(v_name),0) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Indica un tipo y un nombre válidos.'; END IF;
            IF EXISTS(SELECT 1 FROM public.guias_despacho_catalogos WHERE tipo=v_type AND lower(nombre)=lower(v_name)) THEN RAISE EXCEPTION 'Este nombre ya está registrado en el catálogo.' USING ERRCODE='23505'; END IF;
            INSERT INTO public.guias_despacho_catalogos(tipo,nombre,frecuencia) VALUES(v_type,v_name,1) RETURNING to_jsonb(guias_despacho_catalogos.*) INTO v_catalog;
            v_details := 'Agregado ' || v_type || ': ' || v_name;
        ELSE
            SELECT to_jsonb(c) INTO v_catalog FROM public.guias_despacho_catalogos c WHERE c.id=(p_payload->>'id')::bigint;
            IF v_catalog IS NULL THEN RAISE EXCEPTION 'El elemento de catálogo ya no existe.'; END IF;
            DELETE FROM public.guias_despacho_catalogos WHERE id=(p_payload->>'id')::bigint;
            v_details := 'Retirado ' || (v_catalog->>'tipo') || ': ' || (v_catalog->>'nombre');
        END IF;
        INSERT INTO public.guias_despacho_audit(accion,usuario,detalles) VALUES('CATALOGO',v_actor->>'nombre',v_details);
        RETURN v_catalog;
    END IF;

    IF p_action = 'crear' THEN
        v_request := (p_payload->>'request_id')::uuid;
        IF v_request IS NULL THEN RAISE EXCEPTION 'Falta identificar la solicitud de emisión.'; END IF;
        v_fingerprint := encode(sha256(convert_to((p_payload - 'request_id')::text,'UTF8')),'hex');
        SELECT * INTO v_row FROM public.guias_despacho WHERE request_id=v_request;
        IF FOUND THEN
            IF v_row.request_fingerprint IS DISTINCT FROM v_fingerprint OR v_row.created_by IS DISTINCT FROM v_actor->>'nombre' THEN RAISE EXCEPTION 'Esta solicitud ya fue guardada con otros datos. Actualiza la lista.'; END IF;
            RETURN guia_private.documento(v_row.id);
        END IF;
        v_g := COALESCE(p_payload->'guia','{}'::jsonb); v_items := p_payload->'items';
        IF COALESCE(v_g->>'estado','PENDIENTE') <> 'PENDIENTE' THEN RAISE EXCEPTION 'Las nuevas guías deben comenzar por despachar.'; END IF;
    ELSE
        v_id := (p_payload->>'id')::bigint;
        SELECT * INTO v_row FROM public.guias_despacho WHERE id=v_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'La guía ya no existe. Actualiza la lista.'; END IF;
        v_before := guia_private.documento(v_id);
        IF p_action = 'imprimir' THEN
            INSERT INTO public.guias_despacho_audit(guia_id,folio,accion,usuario,detalles)
            VALUES(v_id,v_row.folio,'SOLICITUD_IMPRESION',v_actor->>'nombre','Se solicitó imprimir o guardar PDF. El navegador no confirma la impresión física.');
            RETURN v_before;
        END IF;
        IF (p_payload->>'expected_updated_at') IS NULL OR (p_payload->>'expected_updated_at')::timestamptz IS DISTINCT FROM v_row.updated_at THEN
            RAISE EXCEPTION 'Otra persona actualizó esta guía. Actualiza la lista antes de guardar.' USING ERRCODE='40001';
        END IF;
    END IF;

    IF p_action IN ('crear','editar') THEN
        IF p_action='editar' THEN
            IF v_row.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'Solo se puede editar una guía por despachar.'; END IF;
            v_g := p_payload->'guia'; v_items := p_payload->'items';
            IF v_g ? 'folio' AND (v_g->>'folio')::integer IS DISTINCT FROM v_row.folio THEN RAISE EXCEPTION 'El folio no se puede modificar.'; END IF;
            IF v_g ? 'estado' AND v_g->>'estado' IS DISTINCT FROM v_row.estado THEN RAISE EXCEPTION 'Utiliza las acciones de ruta, recepción o anulación para cambiar el estado.'; END IF;
        END IF;
        PERFORM guia_private.validar_carga(v_items);
        IF length(btrim(COALESCE(v_g->>'lugar_entrega',''))) NOT BETWEEN 1 AND 500 OR length(btrim(COALESCE(v_g->>'chofer','')))=0 OR length(btrim(COALESCE(v_g->>'vehiculo','')))=0 THEN RAISE EXCEPTION 'Completa destino, chofer y vehículo.'; END IF;
        IF COALESCE(v_g->>'fecha','') !~ '^\d{4}-\d{2}-\d{2}$' OR COALESCE(v_g->>'hora','') !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN RAISE EXCEPTION 'Indica fecha y hora válidas.'; END IF;
        IF p_action='crear' THEN
            SELECT COALESCE(jsonb_object_agg(clave,valor),'{}'::jsonb) INTO v_config FROM public.guias_despacho_config;
            UPDATE guia_private.folio_counter SET last_folio=last_folio+1 WHERE singleton RETURNING last_folio INTO v_folio;
            INSERT INTO public.guias_despacho(folio,fecha,hora,lugar_entrega,chofer,vehiculo,patente,observaciones,emisor_nombre,
                razon_social,rut_empresa,telefono_empresa,correo_empresa,direccion_empresa,emisor_rut,emisor_domicilio,emisor_ciudad,emisor_comuna,emisor_telefono,
                transportista_nombre,estado,created_by,request_id,request_fingerprint,created_at,updated_at)
            VALUES(v_folio,(v_g->>'fecha')::date,v_g->>'hora',btrim(v_g->>'lugar_entrega'),btrim(v_g->>'chofer'),btrim(v_g->>'vehiculo'),upper(btrim(COALESCE(v_g->>'patente',''))),COALESCE(v_g->>'observaciones',''),
                COALESCE(NULLIF(btrim(v_g->>'emisor_nombre'),''),NULLIF(v_config->>'emisor_nombre',''),v_actor->>'nombre'),
                COALESCE(NULLIF(v_config->>'empresa_razon_social',''),'ProCleanMG SpA'),v_config->>'empresa_rut',v_config->>'empresa_telefono',v_config->>'empresa_correo',v_config->>'empresa_direccion',
                v_config->>'emisor_rut',v_config->>'emisor_domicilio',v_config->>'emisor_ciudad',v_config->>'emisor_comuna',v_config->>'emisor_telefono',btrim(v_g->>'chofer'),
                'PENDIENTE',v_actor->>'nombre',v_request,v_fingerprint,clock_timestamp(),clock_timestamp()) RETURNING * INTO v_row;
            v_id:=v_row.id; v_action:='CREACION'; v_details:='Guía emitida con ' || jsonb_array_length(v_items) || ' artículos.';
        ELSE
            UPDATE public.guias_despacho SET fecha=(v_g->>'fecha')::date,hora=v_g->>'hora',lugar_entrega=btrim(v_g->>'lugar_entrega'),
                chofer=btrim(v_g->>'chofer'),vehiculo=btrim(v_g->>'vehiculo'),patente=upper(btrim(COALESCE(v_g->>'patente',''))),
                observaciones=COALESCE(v_g->>'observaciones',''),updated_at=clock_timestamp() WHERE id=v_id RETURNING * INTO v_row;
            DELETE FROM public.guia_despacho_items WHERE guia_id=v_id;
            v_action:='MODIFICACION'; v_details:='Datos y carga actualizados antes del despacho.';
        END IF;
        INSERT INTO public.guia_despacho_items(guia_id,articulo,descripcion,cantidad,unidad,observacion)
        SELECT v_id,COALESCE(NULLIF(item->>'articulo',''),ordinality::text),btrim(item->>'descripcion'),(item->>'cantidad')::numeric,item->>'unidad',COALESCE(item->>'observacion','')
        FROM jsonb_array_elements(v_items) WITH ORDINALITY AS x(item,ordinality);
    ELSIF p_action='ruta' THEN
        IF v_row.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'Solo una guía por despachar puede iniciar ruta.'; END IF;
        UPDATE public.guias_despacho SET estado='EN_TRANSITO',despachado_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=v_id;
        v_action:='INICIO_RUTA'; v_details:='Carga despachada e inicio de ruta registrado.';
    ELSIF p_action='entregar' THEN
        IF v_row.estado <> 'EN_TRANSITO' THEN RAISE EXCEPTION 'La guía debe estar en ruta para registrar la recepción.'; END IF;
        IF length(btrim(COALESCE(p_payload->>'receptor_nombre',''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'Indica el nombre de quien recibe.'; END IF;
        IF COALESCE(p_payload->>'firma_digital','') !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' OR length(p_payload->>'firma_digital') NOT BETWEEN 100 AND 1000000 THEN RAISE EXCEPTION 'Registra una firma válida antes de confirmar la recepción.'; END IF;
        v_image:=decode(split_part(p_payload->>'firma_digital',',',2),'base64');
        IF octet_length(v_image)<24 OR encode(substring(v_image FROM 1 FOR 8),'hex')<>'89504e470d0a1a0a' OR encode(substring(v_image FROM 13 FOR 4),'hex')<>'49484452' THEN
            RAISE EXCEPTION 'La firma debe ser una imagen PNG válida.';
        END IF;
        UPDATE public.guias_despacho SET estado='ENTREGADA',receptor_nombre=btrim(p_payload->>'receptor_nombre'),receptor_rut=btrim(COALESCE(p_payload->>'receptor_rut','')),
            receptor_fecha=clock_timestamp()::text,firma_digital=p_payload->>'firma_digital',updated_at=clock_timestamp() WHERE id=v_id;
        v_action:='ENTREGA_CONFORME'; v_details:='Recepción registrada por ' || btrim(p_payload->>'receptor_nombre') || ' con firma digital.';
    ELSIF p_action='anular' THEN
        IF NOT v_manager THEN RAISE EXCEPTION 'Solo supervisores o administradores pueden anular guías.' USING ERRCODE='42501'; END IF;
        IF v_row.estado NOT IN ('PENDIENTE','EN_TRANSITO') THEN RAISE EXCEPTION 'Esta guía ya está cerrada y no se puede anular.'; END IF;
        IF length(btrim(COALESCE(p_payload->>'motivo',''))) NOT BETWEEN 5 AND 2000 THEN RAISE EXCEPTION 'Explica el motivo de anulación (entre 5 y 2000 caracteres).'; END IF;
        UPDATE public.guias_despacho SET estado='ANULADA',motivo_anulacion=btrim(p_payload->>'motivo'),updated_at=clock_timestamp() WHERE id=v_id;
        v_action:='ANULACION'; v_details:='Motivo: ' || btrim(p_payload->>'motivo');
    ELSIF p_action='eliminar' THEN
        IF NOT v_manager THEN RAISE EXCEPTION 'Solo supervisores o administradores pueden eliminar guías.' USING ERRCODE='42501'; END IF;
        IF v_row.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'Solo se puede eliminar una guía por despachar; las guías en ruta deben anularse.'; END IF;
        INSERT INTO public.guias_despacho_audit(guia_id,folio,accion,usuario,detalles,datos_antes)
        VALUES(NULL,v_row.folio,'ELIMINACION',v_actor->>'nombre','Guía por despachar eliminada; folio no reutilizable.',guia_private.auditable(v_before));
        DELETE FROM public.guias_despacho WHERE id=v_id;
        RETURN jsonb_build_object('id',v_id,'folio',v_row.folio,'deleted',true);
    ELSE
        RAISE EXCEPTION 'Operación de guías no permitida.';
    END IF;
    v_after:=guia_private.documento(v_id);
    INSERT INTO public.guias_despacho_audit(guia_id,folio,accion,usuario,detalles,datos_antes,datos_despues)
    VALUES(v_id,(v_after->>'folio')::integer,v_action,v_actor->>'nombre',v_details,guia_private.auditable(v_before),guia_private.auditable(v_after));
    RETURN v_after;
END $$;

CREATE OR REPLACE FUNCTION guia_private.proteger_auditoria() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN RAISE EXCEPTION 'Los eventos de auditoría no se pueden modificar ni eliminar.' USING ERRCODE='42501'; END $$;
DROP TRIGGER IF EXISTS guias_audit_inmutable ON public.guias_despacho_audit;
CREATE TRIGGER guias_audit_inmutable BEFORE UPDATE OR DELETE ON public.guias_despacho_audit FOR EACH ROW EXECUTE FUNCTION guia_private.proteger_auditoria();

-- Las mutaciones se autorizan exclusivamente mediante las RPC anteriores.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.guias_despacho, public.guia_despacho_items,
    public.guias_despacho_catalogos, public.guias_despacho_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.guias_despacho_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA guia_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA guia_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guias_operar(text,text,jsonb), public.guias_iniciar_sesion(text,text),
    public.guias_cerrar_sesion(text), public.guias_modulo_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guias_operar(text,text,jsonb), public.guias_iniciar_sesion(text,text),
    public.guias_cerrar_sesion(text), public.guias_modulo_version() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
