# Agendamiento automático de instalaciones

Prueba técnica. Al cerrarse una venta, el sistema asigna automáticamente la **cuadrilla** y la **franja horaria más próxima** de los próximos 14 días, sin dobles reservas aunque muchas ventas se cierren al mismo tiempo.

**Stack:** Next.js 15 (App Router) + TypeScript · Prisma 6 · PostgreSQL 16 (docker-compose) · Zod · Vitest · Playwright.

## Puesta en marcha

Requisitos: Node 20+ y Docker.

```bash
cp .env.example .env
npm install
npm run db:up          # PostgreSQL en localhost:5433 (crea también la BD agenda_test)
npm run db:migrate     # aplica las migraciones a la BD de desarrollo
npm run db:seed        # 2 ciudades, 3 contratistas, 5 cuadrillas, 3 tipos de servicio
npm run dev            # http://localhost:3000
```

- `/` — cerrar una venta (ciudad + tipo de servicio) y ver la cita asignada.
- `/agenda` — agenda de cada cuadrilla agrupada por día.
- `/admin` — bandeja de administración: mover, reasignar y liberar citas, agendar ventas pendientes e historial de cambios.

## Scripts

| Script | Qué hace |
|---|---|
| `npm run test:unit` | Motor de disponibilidad, utilidades de tiempo y reglas de dominio (sin BD). |
| `npm run test:int` | Restricciones de la BD, reserva, concurrencia y API contra `agenda_test`. |
| `npm run test:e2e` | Playwright: levanta Next en el puerto 3101 contra `agenda_test`. |
| `npm run demo:concurrencia` | Demo de 20 ventas simultáneas por el mismo cupo (usa `agenda_test`). |
| `npm run typecheck` / `npm run lint` / `npm run build` | Verificaciones estáticas y build. |

`test:int`, `test:e2e` y la demo reinician `agenda_test`: no los ejecutes a la vez. La BD de desarrollo nunca se toca desde las pruebas.

## Diseño

```
cerrar venta ──▶ buscarCandidatas ──▶ calcularCandidatas (puro) ──▶ reservarPrimeraDisponible
                 (lee venta, cuadrillas      franjas ordenadas          por cada franja: transacción
                  de la ciudad y citas)      de mejor a peor            FOR UPDATE → revalidar → INSERT
                                                                        └─ la BD rechaza solapes (EXCLUDE)
```

### Modelo de datos

- **Contratista** opera en una o más **ciudades** y tiene **cuadrillas**.
- **Cuadrilla**: `capacidad_diaria` (máximo de citas por día) y 1 o 2 **instaladores**.
- **Disponibilidad**: bloques semanales (día de la semana, minuto de inicio y fin en hora local).
- **Tipo de servicio**: define la duración de la instalación.
- **Venta**: `ABIERTA` → `AGENDADA`, o `CERRADA` si no hubo cupo (queda pendiente de agenda).
- **Cita**: una por venta, en un rango `[inicio, fin)`.
- **Historial de cita**: registro inmutable de cada cambio (`CREADA`, `MOVIDA`, `REASIGNADA`, `LIBERADA`) con cuadrilla y horario antes y después, responsable y motivo.

### Motor de disponibilidad — [`src/dominio/disponibilidad.ts`](src/dominio/disponibilidad.ts)

Función pura `calcularCandidatas`, sin BD, probada regla por regla:

1. Toma la duración del tipo de servicio y las cuadrillas de los contratistas de la ciudad.
2. Para cada día desde hoy hasta un horizonte de **14 días**, genera franjas de **30 min** dentro de cada bloque de disponibilidad (bloques contiguos se unen).
3. Descarta la franja si ya pasó, si **se cruza con otra cita**, si **no cabe la duración completa** o si la cuadrilla **llegó a su capacidad del día**.
4. Ordena por **franja más próxima**; si empatan, gana la cuadrilla con **menos carga** del día, luego del horizonte, luego por id.

Devuelve **todas** las candidatas ordenadas, no solo la primera, para que la reserva pueda pasar a la siguiente si pierde una.

### Reserva exclusiva — [`src/servicios/agendar.ts`](src/servicios/agendar.ts)

Por cada candidata, en una **transacción**:

1. `SELECT ... FROM cuadrilla WHERE id = $1 FOR UPDATE` — serializa las reservas de esa cuadrilla.
2. **Revalida** cruce y capacidad del día. En `READ COMMITTED` esta consulta ve todo lo que confirmó quien tuvo el bloqueo antes.
3. Inserta la cita y marca la venta `AGENDADA`.

Si la franja ya no está libre, o la inserción choca con la restricción de la BD, prueba la siguiente. Sin candidatas: `SIN_CUPO`. Es idempotente: cerrar dos veces devuelve la misma cita.

**Red de seguridad en la BD** — [migración](prisma/migrations/20261104200612_restricciones_citas/migration.sql):

```sql
ALTER TABLE cita ADD CONSTRAINT cita_sin_solapamiento
  EXCLUDE USING gist (cuadrilla_id WITH =, tstzrange(inicio, fin, '[)') WITH &&);
```

Aunque el código fallara, PostgreSQL nunca acepta dos citas cruzadas de la misma cuadrilla.

### Administración con trazabilidad — [`src/servicios/administrar.ts`](src/servicios/administrar.ts)

- **Mover** (otra franja, misma cuadrilla) y **reasignar** (otra cuadrilla de la ciudad) usan la misma defensa que la reserva automática: se bloquean la cita y la cuadrilla destino con `FOR UPDATE`, la franja se valida con el motor de disponibilidad (sin contar la propia cita) y la restricción de la BD sigue como red de seguridad. Una cita puede moverse media hora aunque se solape con su propio horario, y moverse dentro del mismo día aunque la cuadrilla esté en su capacidad.
- **Liberar** elimina la cita y la venta vuelve a `CERRADA` (pendiente). Desde la bandeja se puede reagendar en la franja más próxima.
- Cada cambio exige un **responsable** y deja un registro en `historial_cita` en la misma transacción. El agendamiento automático registra `CREADA` con actor `sistema`. El historial no tiene FK a la cita, así que sobrevive a las citas liberadas.
- Prueba de concurrencia propia: 10 movimientos simultáneos al mismo cupo, solo 1 lo obtiene.

No hay autenticación: el responsable se escribe en la bandeja, que lo recuerda en el navegador. En producción vendría de la sesión del usuario.

### La prueba de concurrencia — [`tests/integration/concurrencia.test.ts`](tests/integration/concurrencia.test.ts)

20 ventas calculan sus candidatas a la vez (todas ven el mismo único cupo) y luego reservan en paralelo contra PostgreSQL real:

| Variante | Agendadas | Sin cupo | Solapes | Choques con la restricción |
|---|---|---|---|---|
| Con `FOR UPDATE` (diseño final) | 1 | 19 | 0 | **0** — las perdedoras descartan el cupo al revalidar |
| Control sin `FOR UPDATE`, caso típico | 1 | 19 | 0 | **19** — la restricción de la BD las detiene |
| Control sin `FOR UPDATE`, peor caso | **0** | 9 | 0 | 9 deadlocks y **11 transacciones vencidas** |

**Por qué el bloqueo es necesario, no solo una optimización.** Sin él, las 20 inserciones se vigilan mutuamente en la restricción de exclusión y caen en *deadlocks* (`40P01`). PostgreSQL los resuelve de uno en uno, y cada detección espera `deadlock_timeout` (1 s). En una cascada, algunas transacciones superan su timeout de 10 s. En 2 de 30 corridas **nadie obtuvo el cupo**, aunque estaba libre.

- La restricción de la BD garantiza la **seguridad**: nunca hay dos citas cruzadas.
- El `FOR UPDATE` garantiza el **progreso**: exactamente una venta gana, en milisegundos y sin choques.

La reserva trata un deadlock como franja perdida, porque PostgreSQL aborta solo a una parte del ciclo.

Otro caso de la suite agenda 20 ventas sobre 3 cuadrillas y verifica 0 cruces y que ninguna cuadrilla pase su capacidad diaria. La suite se ejecutó 30 veces seguidas sin fallos.

## API

| Método y ruta | Respuesta |
|---|---|
| `POST /api/ventas` `{ ciudadId, tipoServicioId }` | `201` venta `ABIERTA` · `400` entrada inválida · `422` ciudad o tipo inexistente |
| `POST /api/ventas/:id/cerrar` | `200 { estado: "AGENDADA", cita }` (con cuadrilla) · `409 SIN_CUPO` · `404` |
| `GET /api/ventas/:id` | Venta con ciudad, tipo de servicio y cita · `404` |
| `GET /api/cuadrillas/:id/citas` | Citas de la cuadrilla en orden cronológico · `404` |
| `GET /api/citas/:id/opciones` | Cuadrillas de la ciudad y franjas libres para mover o reasignar |
| `POST /api/citas/:id/reprogramar` `{ cuadrillaId, inicio, actor, motivo? }` | `200` cita actualizada · `409 FRANJA_NO_DISPONIBLE` · `422 CUADRILLA_FUERA_DE_CIUDAD` · `404` |
| `POST /api/citas/:id/liberar` `{ actor, motivo? }` | `200` venta pendiente (`CERRADA`) · `404` |

`GET /api/ventas/:id` incluye además el historial de la venta.

Los errores siguen el formato `{ "error": { "codigo", "mensaje", "detalles?" } }`.

## Supuestos

- Zona horaria de negocio **America/Bogota**; en la BD todo es `timestamptz` (UTC). La capacidad se cuenta por día local.
- "Carga" para el desempate = citas de la cuadrilla en ese día.
- Una franja no puede extenderse sobre una pausa (por ejemplo, el almuerzo); bloques contiguos sí se unen.
- Una cuadrilla de un contratista que atiende varias ciudades comparte su agenda entre ellas; no se modelan tiempos de traslado.
- Mínimo de 1 instalador validado en el dominio; el máximo de 2 también lo garantiza un trigger en la BD.

## Estructura

```
app/                      páginas (/ y /agenda) y rutas de la API
src/dominio/              lógica pura: disponibilidad, tiempo local, reglas de cuadrilla
src/servicios/agendar.ts  búsqueda de candidatas y reserva exclusiva
src/servicios/administrar.ts  mover, reasignar y liberar citas con historial
src/api/                  validación (Zod) y formato de errores
prisma/                   esquema, migraciones (incluye SQL manual) y seed
tests/unit, tests/integration, e2e/
scripts/demo-concurrencia.ts
```
