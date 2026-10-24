import { defineWidgetConfig } from "@medusajs/admin-sdk";
import type { AdminProduct, DetailWidgetProps } from "@medusajs/framework/types";
import { ChangeDeskLauncher, ChangeDeskProvider } from "@changedesk/react";
import React, { useMemo } from "react";
import { medusaChangeDeskConfig } from "../changedesk-config.js";

const ChangeDeskProductWidget = ({ data }: DetailWidgetProps<AdminProduct>) => {
  const config = useMemo(() => medusaChangeDeskConfig(() => [data.id], "product.details"), [data.id]);
  return <section aria-label="Change Desk" style={{ border: "1px solid #d1d9d5", borderRadius: 8, padding: 18, background: "#fff" }}><div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}><div><strong>Change Desk</strong><p style={{ margin: "4px 0 0", color: "#63736d", fontSize: 13 }}>Crea una acción contextual para este producto.</p></div><ChangeDeskProvider config={config}><ChangeDeskLauncher label="Crear acción"/></ChangeDeskProvider></div></section>;
};

export const config = defineWidgetConfig({ zone: "product.details", id: "changedesk:product-details" });
export default ChangeDeskProductWidget;
