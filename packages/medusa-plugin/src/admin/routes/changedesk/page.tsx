import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChangeDeskLauncher, ChangeDeskProvider } from "@changedesk/react";
import React, { useMemo, useState } from "react";
import { medusaChangeDeskConfig } from "../../changedesk-config.js";
import { ProductSelector } from "../../components/product-selector.js";
import routeStyles from "./route.css?inline";

const ChangeDeskPage = () => {
  const [selected, setSelected] = useState<string[]>([]);
  const config = useMemo(() => medusaChangeDeskConfig(() => selected, "changedesk.route"), [selected]);
  return <><style>{routeStyles}</style><main className="cd-host-page"><header><p>CHANGE DESK / CATÁLOGO</p><h1>Prepara cambios de catálogo</h1><span>Selecciona productos y revisa el resultado antes de ejecutar.</span></header>{config ? <section className="cd-host-workspace"><div className="cd-host-selection"><div><h2>Elige los productos</h2><p>Máximo 100. La selección no concede permisos ni aplica cambios.</p></div><ProductSelector value={selected} onChange={setSelected}/></div><aside className="cd-host-next"><span>PASO SIGUIENTE</span><strong>{selected.length ? `${selected.length} seleccionados` : "Selecciona al menos uno"}</strong><ChangeDeskProvider config={config}><ChangeDeskLauncher label="Revisar y preparar acción"/></ChangeDeskProvider></aside></section> : <section role="status" className="cd-host-disabled"><h2>Change Desk está desactivado</h2><p>Configura el endpoint permitido para habilitar esta integración. Medusa continúa disponible con normalidad.</p></section>}</main></>;
};

export const config = defineRouteConfig({ label: "Change Desk" });
export default ChangeDeskPage;
