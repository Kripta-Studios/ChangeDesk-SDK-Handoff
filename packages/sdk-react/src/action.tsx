import React, { useState } from "react";
import { ChangeDeskPanel } from "./panel/ChangeDeskPanel.js";

export function ChangeDeskAction({ installationId, label }: { installationId: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="cd-button cd-button--secondary" type="button" data-installation-id={installationId} onClick={() => setOpen(true)}>{label}</button>
      {open ? <ChangeDeskPanel initialInstallationId={installationId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
