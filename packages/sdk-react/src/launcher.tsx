import React, { useRef, useState } from "react";
import { useChangeDesk } from "./provider.js";
import { ChangeDeskPanel } from "./panel/ChangeDeskPanel.js";
import launcherStyles from "./launcher.css?inline";

export function ChangeDeskLauncher({ label = "Personalizar acciones" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { config } = useChangeDesk();
  return (
    <div className="cd-launcher">
      <style>{launcherStyles}</style>
      <button ref={buttonRef} className="cd-launcher__button" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(true); config.onEvent?.({ type: "panel_opened" }); }}>
        <span aria-hidden="true">✦</span> {label}
      </button>
      {open ? <ChangeDeskPanel onClose={() => { setOpen(false); queueMicrotask(() => buttonRef.current?.focus()); }} /> : null}
    </div>
  );
}
