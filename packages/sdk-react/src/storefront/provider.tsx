import React, { createContext, useContext } from "react";
import type { StorefrontPreferencesResponse } from "../../../contracts/src/storefront.js";
import type { StorefrontClient } from "./client.js";

export interface StorefrontContextValue { readonly client: StorefrontClient; readonly preferences: StorefrontPreferencesResponse | null; }
const Context = createContext<StorefrontContextValue | null>(null);
export function StorefrontProvider({ client, children }: { client: StorefrontClient; children: React.ReactNode }) { return <Context.Provider value={{ client, preferences: null }}>{children}</Context.Provider>; }
export function useStorefront(): StorefrontContextValue { const value = useContext(Context); if (!value) throw new Error("StorefrontProvider is required"); return value; }
