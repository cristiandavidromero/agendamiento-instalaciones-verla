-- CreateEnum
CREATE TYPE "public"."estado_venta" AS ENUM ('ABIERTA', 'CERRADA', 'AGENDADA');

-- CreateTable
CREATE TABLE "public"."ciudad" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "ciudad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contratista" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "contratista_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."contratista_ciudad" (
    "contratista_id" INTEGER NOT NULL,
    "ciudad_id" INTEGER NOT NULL,

    CONSTRAINT "contratista_ciudad_pkey" PRIMARY KEY ("contratista_id","ciudad_id")
);

-- CreateTable
CREATE TABLE "public"."cuadrilla" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "contratista_id" INTEGER NOT NULL,
    "capacidad_diaria" INTEGER NOT NULL,

    CONSTRAINT "cuadrilla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."instalador" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "cuadrilla_id" INTEGER NOT NULL,

    CONSTRAINT "instalador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."disponibilidad_cuadrilla" (
    "id" SERIAL NOT NULL,
    "cuadrilla_id" INTEGER NOT NULL,
    "dia_semana" INTEGER NOT NULL,
    "minuto_inicio" INTEGER NOT NULL,
    "minuto_fin" INTEGER NOT NULL,

    CONSTRAINT "disponibilidad_cuadrilla_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tipo_servicio" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "duracion_min" INTEGER NOT NULL,

    CONSTRAINT "tipo_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."venta" (
    "id" SERIAL NOT NULL,
    "ciudad_id" INTEGER NOT NULL,
    "tipo_servicio_id" INTEGER NOT NULL,
    "estado" "public"."estado_venta" NOT NULL DEFAULT 'ABIERTA',
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."cita" (
    "id" SERIAL NOT NULL,
    "venta_id" INTEGER NOT NULL,
    "cuadrilla_id" INTEGER NOT NULL,
    "inicio" TIMESTAMPTZ(3) NOT NULL,
    "fin" TIMESTAMPTZ(3) NOT NULL,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ciudad_nombre_key" ON "public"."ciudad"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "contratista_nombre_key" ON "public"."contratista"("nombre");

-- CreateIndex
CREATE INDEX "contratista_ciudad_ciudad_id_idx" ON "public"."contratista_ciudad"("ciudad_id");

-- CreateIndex
CREATE UNIQUE INDEX "cuadrilla_contratista_id_nombre_key" ON "public"."cuadrilla"("contratista_id", "nombre");

-- CreateIndex
CREATE INDEX "instalador_cuadrilla_id_idx" ON "public"."instalador"("cuadrilla_id");

-- CreateIndex
CREATE INDEX "disponibilidad_cuadrilla_cuadrilla_id_dia_semana_idx" ON "public"."disponibilidad_cuadrilla"("cuadrilla_id", "dia_semana");

-- CreateIndex
CREATE UNIQUE INDEX "tipo_servicio_nombre_key" ON "public"."tipo_servicio"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "cita_venta_id_key" ON "public"."cita"("venta_id");

-- CreateIndex
CREATE INDEX "cita_cuadrilla_id_inicio_idx" ON "public"."cita"("cuadrilla_id", "inicio");

-- AddForeignKey
ALTER TABLE "public"."contratista_ciudad" ADD CONSTRAINT "contratista_ciudad_contratista_id_fkey" FOREIGN KEY ("contratista_id") REFERENCES "public"."contratista"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."contratista_ciudad" ADD CONSTRAINT "contratista_ciudad_ciudad_id_fkey" FOREIGN KEY ("ciudad_id") REFERENCES "public"."ciudad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cuadrilla" ADD CONSTRAINT "cuadrilla_contratista_id_fkey" FOREIGN KEY ("contratista_id") REFERENCES "public"."contratista"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."instalador" ADD CONSTRAINT "instalador_cuadrilla_id_fkey" FOREIGN KEY ("cuadrilla_id") REFERENCES "public"."cuadrilla"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."disponibilidad_cuadrilla" ADD CONSTRAINT "disponibilidad_cuadrilla_cuadrilla_id_fkey" FOREIGN KEY ("cuadrilla_id") REFERENCES "public"."cuadrilla"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."venta" ADD CONSTRAINT "venta_ciudad_id_fkey" FOREIGN KEY ("ciudad_id") REFERENCES "public"."ciudad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."venta" ADD CONSTRAINT "venta_tipo_servicio_id_fkey" FOREIGN KEY ("tipo_servicio_id") REFERENCES "public"."tipo_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cita" ADD CONSTRAINT "cita_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."cita" ADD CONSTRAINT "cita_cuadrilla_id_fkey" FOREIGN KEY ("cuadrilla_id") REFERENCES "public"."cuadrilla"("id") ON DELETE CASCADE ON UPDATE CASCADE;
