import React, { useEffect, useState } from "react";

type Product = { id: string; title: string; status: string };

export const ProductSelector = ({ value, onChange }: { value: readonly string[]; onChange: (ids: string[]) => void }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    fetch("/admin/products?limit=50&fields=id,title,status", { credentials: "same-origin", signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<{ products: Product[] }>; })
      .then((payload) => setProducts(payload.products))
      .catch((reason) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setError("No se pudieron cargar los productos autorizados."); });
    return () => controller.abort();
  }, []);
  return <fieldset className="cd-host-selector"><legend>Productos ({value.length}/100)</legend>{error ? <p role="alert">{error}</p> : null}<div>{products.map((product) => <label key={product.id}><input type="checkbox" value={product.id} data-product-id={product.id} checked={value.includes(product.id)} disabled={!value.includes(product.id) && value.length >= 100} onChange={(event) => onChange(event.target.checked ? [...value, product.id] : value.filter((id) => id !== product.id))}/><span>{product.title}</span><small>{product.status}</small></label>)}</div></fieldset>;
};
