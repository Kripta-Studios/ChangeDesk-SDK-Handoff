# Riesgos, límites y criterio de cierre

## Afirmaciones permitidas

Se podrá decir «el SDK funciona en las dos Medusa de prueba» solo con E2E real. «Se reutiliza entre clientes» exige mismo artefacto compatible y configuraciones/autoridades separadas. «Bajo overhead» exige medición, baseline y entorno. «Integración sencilla» exige integración limpia reproducida contando plugin/guard y configuración, no únicamente el widget.

Nunca afirmar: inmune a prompt injection; imposible romper el backend; prueba formal end-to-end; todas las apps compatibles sin integración; exactly-once remoto; ahorro garantizado o SOTA. Una suite finita sin fallos solo acredita el corpus y configuración medidos.

## Riesgos principales y respuesta

| Riesgo | Qué lo revela | Respuesta exigida |
|---|---|---|
| Medusa API/extension cambia | Spike falla en versión fijada | ADR y actualización de adapter/contracts/tests; no seguir ejemplos viejos |
| Roles solo cosméticos | Requester escribe por ruta nativa | Guard de host obligatorio y pruebas de bypass |
| Carrera status/relaciones | Producto cambia entre preview y efecto | Guard/serialización compartida con rutas relevantes o bloqueo del caso; garantía reducida explícita |
| Worker vencido sigue vivo | Escritura tardía tras lease | Ledger fencing + autorización host + reconciliación; no confiar lease como fence remoto |
| Reutilización filtra información | Búsqueda muestra recurso/metadata privado | ACL-first, partición de cachés, manifiestos genéricos, test tenant adversarial |
| Plantilla compartida maliciosa | Description/UI contiene instrucciones, URLs o PII | Parser/UI cerrados, revisión publicación, política de capacidades, revocación |
| LLM se equivoca o obedece datos | Plan fuera de capacidades o alcance | Rechazo previo a ejecución, aprobación materializada, permisos externos al modelo |
| Aprobación obsoleta | Datos/política cambian | Expirar/replanificar/reaprobar; nunca añadir nuevas filas silenciosamente |
| Bajo coste solo aparente | Reintentos, logs o tokens no medidos | Contabilidad por request/plan/ejecución, retención y budgets |
| Test fake oculto | Demo solo usa fixture planner | Gate live distinto; etiquetas y evidencia obligatorias |
| Bend no disponible/modelo incorrecto | Verificador ausente o pruebas solo triviales | Gate experimental blocked, fixture falsa, frontera/traducción explícitas |
| Dependencias externas indisponibles | Docker/proveedor no responde | Completar trabajo independiente; indicar blocked y procedimiento exacto |

## Estados de entrega

| Estado | Significado |
|---|---|
| SPEC_READY | Este paquete documental revisado; ningún SDK ejecutado |
| LOCAL_VERIFIED | SDK + Medusa real + tests locales + provider fake; no acredita generación live |
| LIVE_VERIFIED | Gates anteriores y planificación/reuse/adversarial con proveedor real y métricas |
| PILOT_COMPLETE | Gates de acceptance aplicables, live, perf, integración limpia y experimental Bend ejecutado o limitación formalmente aceptada y separada |

Una limitación no aceptada no puede rebautizarse como defer para cerrar. Si el verificador Bend no puede ejecutarse, entregar la parte implementada con gate blocked y precisar que la solicitud completa permanece pendiente. MCP fachada, móvil, marketplace y producción son roadmap explícito, no gates de este piloto.

## Checklist final verificable

- [ ] Atlas y Boreal arrancan desde instrucciones sin dependencia de rutas personales.
- [ ] Mock data reproducible; ocho actores y tres clases de petición.
- [ ] Chat integrado vía extensión soportada, no modificación DOM externa.
- [ ] API key privilegiada ausente de navegador, bundles, logs y fixtures.
- [ ] Autorización por servidor y rutas nativas; cross-tenant denegado.
- [ ] Preview y aprobación vinculados al plan; stale/expirado bloqueado.
- [ ] Runner durable; unknown/parcial/cancelación/revocación con readback.
- [ ] Acción persistente sin LLM en ejecución repetida.
- [ ] Publicación y oferta explícitas; mismo artefacto, bindings privados.
- [ ] Pruebas generadas por cambios y benchmark clean/attack con oráculo independiente.
- [ ] Bend ejecuta leyes y rechaza una ley falsa; alcance de prueba visible.
- [ ] CI real, lockfiles/digests, tarball SDK smoke probado en app limpia.
- [ ] Coste/overhead/latencia e integración medidos, no estimados como hechos.
- [ ] Capturas/demo, versiones, comandos y reporte con resultados PASS/FAIL/BLOCKED/NOT_RUN.
- [ ] Council final inspecciona diffs y evidencia; objeciones críticas resueltas.

## Seguridad operacional del laboratorio

Solo localhost, datos sintéticos, salida externa restringida a proveedor/documentación explícitamente configurados durante desarrollo. La ejecución de recetas no necesita internet genérico. Credenciales generadas por instalación en almacén local ignorado por Git; nunca documentarlas con valores reales. Usar IDs namespace por run y reset scoped. No montar Docker socket dentro del runner ni directorio padre con otros proyectos. No ejecutar gastos, mensajes o servicios de producción para demostrar la demo.
