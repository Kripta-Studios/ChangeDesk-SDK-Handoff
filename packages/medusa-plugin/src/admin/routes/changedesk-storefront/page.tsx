import { defineRouteConfig } from "@medusajs/admin-sdk";
import { createStorefrontAdminClient, StorefrontAdminPanel } from "@changedesk/react/storefront";
import React, { useEffect, useMemo } from "react";
import { medusaChangeDeskConfig } from "../../changedesk-config.js";
import "./route.css";

const StorefrontReviewPage = () => {
  const config = useMemo(() => medusaChangeDeskConfig(() => [], "changedesk.storefront.admin"), []);
  const client = useMemo(() => config ? createStorefrontAdminClient({ endpoint: config.endpoint, getSession: config.getSession }) : null, [config]);
  useEffect(() => () => client?.clearSession(), [client]);
  return <main className="cd-storefront-admin-page">
    <header><p>CHANGE DESK / STOREFRONT</p><h1>Revisa cambios globales propuestos por compradores</h1><span>La aprobación aplica solo la configuración global. Los overrides personales se conservan.</span></header>
    {client ? <StorefrontAdminPanel client={client} /> : <section role="status" className="cd-storefront-admin-disabled"><h2>Change Desk está desactivado</h2><p>Configura el endpoint permitido para revisar propuestas storefront.</p></section>}
  </main>;
};

export const config = defineRouteConfig({ label: "Storefront Change Desk" });
export default StorefrontReviewPage;
