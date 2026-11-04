-- Red de seguridad de la reserva exclusiva: dos citas de la misma cuadrilla
-- nunca pueden cruzarse. El rango es [inicio, fin): citas contiguas sí se permiten.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "cita"
  ADD CONSTRAINT "cita_fin_posterior_inicio" CHECK ("fin" > "inicio"),
  ADD CONSTRAINT "cita_sin_solapamiento"
    EXCLUDE USING gist ("cuadrilla_id" WITH =, tstzrange("inicio", "fin", '[)') WITH &&);

-- Rangos válidos del resto del modelo.
ALTER TABLE "cuadrilla"
  ADD CONSTRAINT "cuadrilla_capacidad_positiva" CHECK ("capacidad_diaria" > 0);

ALTER TABLE "tipo_servicio"
  ADD CONSTRAINT "tipo_servicio_duracion_positiva" CHECK ("duracion_min" > 0);

ALTER TABLE "disponibilidad_cuadrilla"
  ADD CONSTRAINT "disponibilidad_dia_valido" CHECK ("dia_semana" BETWEEN 0 AND 6),
  ADD CONSTRAINT "disponibilidad_rango_valido"
    CHECK ("minuto_inicio" >= 0 AND "minuto_inicio" < "minuto_fin" AND "minuto_fin" <= 1440);
