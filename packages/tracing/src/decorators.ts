import { trace, SpanStatusCode } from '@opentelemetry/api'

/** Wraps an async service method in an OpenTelemetry span (nested under active HTTP span when present). */
export function Trace(spanName?: string) {
  return function traceDecorator(
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>
    const name = spanName ?? `${target.constructor.name}.${propertyKey}`

    descriptor.value = async function tracedMethodWrapper(this: unknown, ...args: unknown[]) {
      const tracer = trace.getTracer('cosmos')
      return tracer.startActiveSpan(name, async (span) => {
        try {
          const result = await originalMethod.apply(this, args)
          span.setStatus({ code: SpanStatusCode.OK })
          return result
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          })
          span.recordException(error instanceof Error ? error : new Error(String(error)))
          throw error
        } finally {
          span.end()
        }
      })
    }

    return descriptor
  }
}
