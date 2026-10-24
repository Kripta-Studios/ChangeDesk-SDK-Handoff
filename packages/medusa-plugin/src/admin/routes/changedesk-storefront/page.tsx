import { defineRouteConfig } from "@medusajs/admin-sdk";
import { createStorefrontAdminClient, StorefrontAdminPanel } from "@changedesk/react/storefront";
import React, { useEffect, useMemo, useState } from "react";
import { medusaChangeDeskConfig } from "../../changedesk-config.js";
import "./route.css";

const StorefrontReviewPage = () => {
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const config = useMemo(() => medusaChangeDeskConfig(() => [], "changedesk.storefront.admin"), []);
  const client = useMemo(() => config ? createStorefrontAdminClient({ endpoint: config.endpoint, getSession: config.getSession }) : null, [config, sessionEpoch]);
  useEffect(() => () => client?.clearSession(), [client]);
  useEffect(() => {
    // Admin SDK 2.22.1 exposes no supported user/session identity hook to extensions.
    // Re-entering the host (plus a bounded visible-page interval) therefore forces a
    // fresh server-authenticated /admin/changedesk/session bootstrap without reading tokens.
    const revalidate = () => setSessionEpoch((current) => current + 1);
    const revalidateWhenVisible = () => { if (document.visibilityState === "visible") revalidate(); };
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    document.addEventListener("visibilitychange", revalidateWhenVisible);
    const interval = window.setInterval(revalidateWhenVisible, 60_000);
    return () => {
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      document.removeEventListener("visibilitychange", revalidateWhenVisible);
      window.clearInterval(interval);
    };
  }, []);
  return <main className="cd-storefront-admin-page">
    <header><p>CHANGE DESK / STOREFRONT</p><h1>Revisa cambios globales propuestos por compradores</h1><span>La aprobación aplica solo la configuración global. Los overrides personales se conservan.</span></header>
    {client ? <StorefrontAdminPanel client={client} sessionKey={sessionEpoch} /> : <section role="status" className="cd-storefront-admin-disabled"><h2>Change Desk está desactivado</h2><p>Configura el endpoint permitido para revisar propuestas storefront.</p></section>}
  </main>;
};

export const config = defineRouteConfig({ label: "Storefront Change Desk" });
export default StorefrontReviewPage;
