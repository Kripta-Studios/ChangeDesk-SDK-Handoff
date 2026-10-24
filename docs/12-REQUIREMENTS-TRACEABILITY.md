# Trazabilidad de requisitos y pruebas

Cada fila traduce un requisito del usuario en una pieza implementable y una comprobación. Los IDs ACC están definidos en [TDD y CI](06-TDD-CI-AND-ACCEPTANCE.md). No representan tests ya ejecutados.

| Requisito | Diseño responsable | Fases | Gates |
|---|---|---|---|
| SDK insertable con poco trabajo | Provider React, extension Medusa y adapter host; contar todos los cambios | P0,P2,P7,P8 | ACC-001,002,018 |
| Pedir funciones desde chat | Provider planner neutral + IR cerrado + aclaraciones | P5 | ACC-004,005,016 |
| Interfaz personalizada útil | Acción/formulario/tabla de componentes permitidos | P2,P5 | ACC-002,014 |
| Combinar backend existente | Capacidades verificadas y dos asociaciones nativas | P0,P2 | ACC-005,007 |
| Usuarios con peticiones diferentes | Ocho cuentas, tres recetas y permisos separados | P3,P5 | ACC-003,006,007 |
| Reutilizar entre clientes y ofrecerlo | Publicación opt-in, matching autorizado, oferta, instalación admin | P4 | ACC-010,011,012 |
| No copiar app/contenedor por usuario | Artefacto inmutable + instalación privada + pool acotado | P4,P7 | ACC-011,015 |
| Bajo coste | Reuse antes de generar, budgets, runner sin LLM, retención | P4,P7 | ACC-015,016,017 |
| No romper sistema/app | Permisos host, preview, límite de efectos, readback y recuperación | P0,P3 | ACC-006,007,008,009,018 |
| Seguridad frente prompt injection | Modelos sin autoridad, parser, políticas y harness adversarial | P3,P6 | ACC-004,010,013,014,016 |
| Bend laws y ataques por cambios | Proof adapter experimental, dependencias de evidencia y delta suites | P6 | ACC-013,016,017 |
| TDD tests y CI | Red/green, propiedad, integración real, E2E, recovery y CI pinneada | P1–P8 | Todos los `ACC-*` definidos y aplicables |
| Swarm que termine en otra sesión | Modelo/rol, ownership, taskboard, fases y council | Todas | Revisión final + FINAL-REPORT |

## Qué cuenta como demostración

Una captura del chat no prueba efectos backend. Un test del adapter fake no prueba Medusa. Un backend real con planner fake no prueba generación live. Una prueba Bend no prueba correspondencia automática con el código ni la API. El informe debe mantener separadas estas evidencias y enlazar cada afirmación al gate correcto.

## Escenarios de producto mínimos

1. Requester Atlas solicita preparar campaña y solo obtiene preview. Admin habilita el artefacto validado; Operator inicia su propio plan, revisa y aprueba. No se transfieren conversaciones ni permisos implícitamente.
2. Admin Atlas publica plantilla saneada. Requester Boreal recibe oferta; Admin Boreal instala con bindings locales. Operator Boreal revisa un nuevo plan y ejecuta. Mismo artefacto, distintos datos.
3. Usuario solicita solo categoría y otro solo canal; las funciones respetan exactamente esos efectos. Una función campaña no se reutiliza como equivalente sin adaptar y validar.
4. Viewer intenta ejecutar por chat y por API nativa: denegado. Cambiar tenant o IDs en browser no cambia su autoridad.
5. La descripción de un producto incluye instrucciones maliciosas. No cambia selección/efectos; la UI escapa HTML y el runner no tiene egress arbitrario.
6. Timeout después de efecto y caída worker: readback identifica lo ya hecho; resultado parcial/unknown es explícito y no se repiten efectos confirmados.
7. Cambio en receta/política/adapter: se invalidan evidencias necesarias y se generan/regeneran pruebas afectadas; lo no medido no se marca verificado.

## Estado inicial

Todos los tests de producto empiezan `NOT_RUN`. El único informe generado al preparar esta carpeta es de integridad del paquete documental. La checklist de release no se marca por la presencia de documentos o ejemplos JSON.
