-- Una cuadrilla tiene como máximo 2 instaladores. El mínimo de 1 se valida en el
-- dominio al crear la cuadrilla (src/dominio/cuadrilla.ts).
CREATE FUNCTION "cuadrilla_max_instaladores"() RETURNS trigger AS $$
BEGIN
  -- Bloquea la cuadrilla para que dos inserciones concurrentes no superen el límite.
  PERFORM 1 FROM "cuadrilla" WHERE "id" = NEW."cuadrilla_id" FOR UPDATE;

  IF (SELECT count(*) FROM "instalador"
      WHERE "cuadrilla_id" = NEW."cuadrilla_id" AND "id" <> NEW."id") >= 2 THEN
    RAISE EXCEPTION 'cuadrilla_max_instaladores: la cuadrilla % ya tiene 2 instaladores', NEW."cuadrilla_id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "instalador_max_por_cuadrilla"
  BEFORE INSERT OR UPDATE OF "cuadrilla_id" ON "instalador"
  FOR EACH ROW EXECUTE FUNCTION "cuadrilla_max_instaladores"();
