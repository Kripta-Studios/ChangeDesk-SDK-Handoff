import React from "react";
import type { StorefrontAdminClient } from "./client.js";

export function StorefrontRoot({ children }: { children: React.ReactNode }) { return <div className="changedesk-storefront-root">{children}</div>; }
export function StorefrontPreferencesPanel() { return <section aria-label="Storefront preferences" />; }
export function StorefrontAdminReview({ client: _client }: { client: StorefrontAdminClient }) { return <section aria-label="Storefront global proposals" />; }
