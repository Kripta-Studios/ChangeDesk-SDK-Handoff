import React from "react";

export class PanelErrorBoundary extends React.Component<{ children: React.ReactNode; onReset: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* Host logs are intentionally not given payloads or tokens. */ }
  render() {
    if (!this.state.failed) return this.props.children;
    return <section role="alert"><h2>No pudimos mostrar Change Desk</h2><p>Tu sesión se ha limpiado. Vuelve a abrir el panel.</p><button type="button" onClick={() => { this.props.onReset(); this.setState({ failed: false }); }}>Reintentar</button></section>;
  }
}
