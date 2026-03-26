// instrumentation.ts
// Next.js built-in instrumentation hook — runs once on server startup
// Azure Monitor SDK wires up before any requests are handled

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
      const { useAzureMonitor } = await import('@azure/monitor-opentelemetry')
      useAzureMonitor({
        azureMonitorExporterOptions: {
          connectionString: process.env.APPLICATIONINSIGHTS_CONNECTION_STRING,
        },
      })
    }
  }
}
