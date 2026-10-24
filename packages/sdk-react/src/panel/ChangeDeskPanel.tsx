import React, { Suspense, lazy } from "react";
import { PanelErrorBoundary } from "../error-boundary.js";
import { useChangeDesk } from "../provider.js";

const LazyPanel = lazy(() => import("./InternalPanel.js"));

export function ChangeDeskPanel({ onClose, initialInstallationId }: { onClose?: (() => void) | undefined; initialInstallationId?: string | undefined }) {
  const { client } = useChangeDesk();
  return (
    <PanelErrorBoundary onReset={client.clearSession}>
      <Suspense fallback={<div className="cd-loading" role="status">Cargando Change Desk…</div>}>
        <LazyPanel onClose={onClose} initialInstallationId={initialInstallationId} />
      </Suspense>
    </PanelErrorBoundary>
  );
}
