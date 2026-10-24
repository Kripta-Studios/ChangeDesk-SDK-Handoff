import { defineRouteConfig } from "@medusajs/admin-sdk";
import { ChangeDeskLauncher, ChangeDeskProvider } from "@changedesk/react";
import React, { useMemo, useState } from "react";
import { medusaChangeDeskConfig } from "../../changedesk-config.js";
import { ProductSelector } from "../../components/product-selector.js";
import "./route.css";

const ChangeDeskPage = () => {
  const [selected, setSelected] = useState<string[]>([]);
  const config = useMemo(() => medusaChangeDeskConfig(() => selected, "changedesk.route"), [selected]);
  return <main className="cd-host-page"><header><p>CHANGE DESK / CATÁLOGO</p><h1>Acciones de catálogo, con revisión antes de ejecutar</h1><span>Selecciona hasta 100 productos. Ninguna selección concede permisos ni ejecuta cambios.</span></header><section><ProductSelector value={selected} onChange={setSelected}/><ChangeDeskProvider config={config}><ChangeDeskLauncher label="Crear acción con esta selección"/></ChangeDeskProvider></section></main>;
};

export const config = defineRouteConfig({ label: "Change Desk" });
export default ChangeDeskPage;
