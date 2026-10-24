import { defineWidgetConfig } from "@medusajs/admin-sdk";
import React from "react";
import { Link } from "react-router-dom";

const ChangeDeskProductListWidget = () => <aside aria-label="Change Desk" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, border: "1px solid #11241f", borderLeft: "6px solid #efff7a", padding: 16, background: "#fff" }}><div><strong>¿Trabajar con varios productos?</strong><p style={{ margin: "3px 0 0", color: "#63736d", fontSize: 13 }}>Usa el selector propio de Change Desk sin alterar la tabla de Medusa.</p></div><Link to="/changedesk" style={{ color: "#3d2aa3", fontWeight: 700 }}>Abrir selector</Link></aside>;

export const config = defineWidgetConfig({ zone: "product.list", id: "changedesk:product-list" });
export default ChangeDeskProductListWidget;
