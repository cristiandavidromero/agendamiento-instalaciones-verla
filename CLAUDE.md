# CLAUDE.md

Prueba técnica: **agendamiento automático de instalaciones**. Cuando se cierra una venta, el sistema asigna automáticamente la cuadrilla y la franja horaria más próxima disponible.

## Stack

- **Next.js + TypeScript** (app y API)
- **Prisma** como ORM
- **PostgreSQL** levantado con `docker-compose`
- **Vitest** para pruebas unitarias e de integración
- **Playwright** para pruebas end-to-end

## Modelo de datos

- Cada **contratista** opera en una o más **ciudades** y tiene **cuadrillas**.
- Cada **cuadrilla** tiene una capacidad diaria (`capacidad_diaria`) y **1 o 2 instaladores**.
- Cada **tipo de servicio** define la **duración** de la instalación.
- Cada **cita** pertenece a una cuadrilla y ocupa un intervalo `[inicio, fin)`.

## Motor de disponibilidad

1. Al cerrarse la venta se toman la **ciudad** y la **duración** correspondiente a su tipo de servicio.
2. Se buscan las cuadrillas de los contratistas de esa ciudad.
3. Para cada día, desde **hoy** hasta un **horizonte de 14 días**, se generan **franjas de 30 min** dentro de la disponibilidad de cada cuadrilla.
4. Se **descarta** una franja si:
   - se cruza con otra cita de la cuadrilla,
   - no cabe la duración completa dentro de la disponibilidad, o
   - la cuadrilla ya llegó a su `capacidad_diaria` ese día.
5. Se elige la **franja más próxima**. Si dos cuadrillas empatan, gana la que tenga **menos carga**.

## Reserva exclusiva

- Todo ocurre en **una transacción**:
  1. `SELECT ... FOR UPDATE` sobre la fila de la cuadrilla.
  2. Se **vuelve a validar** el cupo (solapamiento y capacidad diaria).
  3. Se inserta la cita.
- **Red de seguridad en la BD**: una restricción de exclusión impide que dos citas de la misma cuadrilla se crucen, p. ej.:

  ```sql
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE cita ADD CONSTRAINT cita_sin_solapamiento
    EXCLUDE USING gist (cuadrilla_id WITH =, tstzrange(inicio, fin, '[)') WITH &&);
  ```

  Prisma no modela esta restricción: va en una migración SQL manual.
- Si la inserción choca (violación de la restricción), se **intenta con la siguiente franja**.

### Prueba de concurrencia (punto clave de la exposición)

La prueba lanza **20 ventas simultáneas por el mismo cupo** y verifica que **solo 1** lo obtiene; las demás deben quedar en otra franja o sin asignación, nunca con citas solapadas. Esta prueba debe correr contra PostgreSQL real (no mocks).

## Convenciones

- **Commits pequeños** y enfocados, uno por cambio lógico.
- **Pruebas para cada regla de negocio**: horizonte de 14 días, franjas de 30 min, solapamiento, duración que no cabe, capacidad diaria, desempate por menor carga, reintento ante choque y concurrencia.
- La lógica del motor de disponibilidad debe ser pura y testeable sin BD; la reserva se prueba en integración con la BD.
