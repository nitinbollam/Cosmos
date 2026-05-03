import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'

/** Opt-in telemetry so local dev/tests stay lean. Enables when `COSMOS_OTEL_ENABLED=true`. */
export function bootstrapTelemetry(serviceName: string): NodeSDK | undefined {
  if (process.env.COSMOS_OTEL_ENABLED !== 'true') {
    return undefined
  }

  const endpoint =
    process.env.OPENTELEMETRY_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317'

  const resource = Resource.default().merge(
    new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION ?? '0.0.0',
      'cosmos.environment': process.env.NODE_ENV ?? 'development',
    }),
  )

  const traceExporter = new OTLPTraceExporter({
    url: endpoint,
  })

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': { enabled: true },
        '@opentelemetry/instrumentation-express': { enabled: true },
        '@opentelemetry/instrumentation-nestjs-core': { enabled: true },
      }),
    ],
  })

  sdk.start()

  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0))
  })

  return sdk
}

export * from './decorators'
