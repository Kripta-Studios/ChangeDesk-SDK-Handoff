import React, { Suspense, lazy } from "react";

const LazyPanel = lazy(() => import("./InternalPanel.js"));

export function ChangeDeskPanel({ onClose, initialInstallationId }: { onClose?: (() => void) | undefined; initialInstallationId?: string | undefined }) {
  return (
    <Suspense fallback={<div className="cd-loading" role="status">Cargando Change Desk…</div>}>
      <LazyPanel onClose={onClose} initialInstallationId={initialInstallationId} />
    </Suspense>
  );
}
