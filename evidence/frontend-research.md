# Frontend API and dependency research

Date: 2026-10-24

- Medusa 2.22.1 package registry metadata: `@medusajs/dashboard@2.22.1` declares React and ReactDOM `^18.3.1`; the SDK peer is therefore constrained to `>=18.3.1 <19`. Registry: https://registry.npmjs.org/@medusajs/dashboard/2.22.1
- Medusa's official v2 admin customization documentation specifies `defineRouteConfig`, `defineWidgetConfig`, arrow-function components, literal widget zones and routes under `src/admin/routes`. Source: https://docs.medusajs.com/learn/introduction/from-v1-to-v2
- The official injection-zone reference confirms `product.list` and `product.details`; only the detail zone supplies an `AdminProduct`. Source: https://docs.medusajs.com/resources/admin-widget-injection-zones
- The official routing guide confirms internal admin links omit the `/app` prefix. Source: https://docs.medusajs.com/learn/fundamentals/admin/routing
- React 18.3.1 is MIT-licensed. Registry metadata: https://registry.npmjs.org/react/18.3.1
- Vite 7.3.7 is MIT-licensed and supports Node 22. Registry metadata: https://registry.npmjs.org/vite/7.3.7

Context7's callable documentation tools were unavailable in this runtime. The fallback used only official Medusa documentation and package-registry metadata; no unverified community examples were used.
