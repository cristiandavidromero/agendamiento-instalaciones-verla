-- CreateEnum
CREATE TYPE "public"."accion_cita" AS ENUM ('CREADA', 'MOVIDA', 'REASIGNADA', 'LIBERADA');

-- CreateTable
CREATE TABLE "public"."historial_cita" (
    "id" SERIAL NOT NULL,
    "venta_id" INTEGER NOT NULL,
    "cita_id" INTEGER NOT NULL,
    "accion" "public"."accion_cita" NOT NULL,
    "cuadrilla_anterior_id" INTEGER,
    "inicio_anterior" TIMESTAMPTZ(3),
    "fin_anterior" TIMESTAMPTZ(3),
    "cuadrilla_nueva_id" INTEGER,
    "inicio_nuevo" TIMESTAMPTZ(3),
    "fin_nuevo" TIMESTAMPTZ(3),
    "actor" TEXT NOT NULL,
    "motivo" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_cita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historial_cita_venta_id_creado_en_idx" ON "public"."historial_cita"("venta_id", "creado_en");

-- CreateIndex
CREATE INDEX "historial_cita_creado_en_idx" ON "public"."historial_cita"("creado_en");

-- AddForeignKey
ALTER TABLE "public"."historial_cita" ADD CONSTRAINT "historial_cita_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "public"."venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."historial_cita" ADD CONSTRAINT "historial_cita_cuadrilla_anterior_id_fkey" FOREIGN KEY ("cuadrilla_anterior_id") REFERENCES "public"."cuadrilla"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."historial_cita" ADD CONSTRAINT "historial_cita_cuadrilla_nueva_id_fkey" FOREIGN KEY ("cuadrilla_nueva_id") REFERENCES "public"."cuadrilla"("id") ON DELETE SET NULL ON UPDATE CASCADE;
