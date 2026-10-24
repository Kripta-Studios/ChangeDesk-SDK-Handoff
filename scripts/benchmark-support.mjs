export function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("percentile requires at least one sample");
  if (!(fraction > 0 && fraction <= 1)) throw new Error("percentile fraction must be in (0, 1]");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

export function summarize(values, errors = 0) {
  return {
    samples: values.length,
    errors,
    unit: "ms",
    min: percentile(values, 0.01),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: percentile(values, 1)
  };
}

export function requireBenchmarkEnvironment(environment = process.env) {
  const migratorDatabaseUrl = environment.CHANGEDESK_MIGRATOR_DATABASE_URL;
  const runtimeDatabaseUrl = environment.CHANGEDESK_RUNTIME_DATABASE_URL;
  if (!migratorDatabaseUrl || !runtimeDatabaseUrl) {
    throw new Error("BLOCKED: CHANGEDESK_MIGRATOR_DATABASE_URL and CHANGEDESK_RUNTIME_DATABASE_URL are required for the real PostgreSQL benchmark");
  }
  return { migratorDatabaseUrl, runtimeDatabaseUrl };
}

export function benchmarkStatus(catalog, admission) {
  return catalog.errors === 0 && catalog.p95 <= 250 && admission.errors === 0 && admission.p95 <= 300 ? "PASS" : "FAIL";
}
