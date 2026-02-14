import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { trace, context, SpanStatusCode, type Attributes } from '@opentelemetry/api';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

let initialized = false;

const initTracing = (): void => {
  if (initialized) {
    return;
  }

  const provider = new NodeTracerProvider({
    spanProcessors: [new BatchSpanProcessor(new TraceExporter())],
  });
  provider.register();
  initialized = true;
};

export const currentTraceId = (): string | undefined => {
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();
  return spanContext?.traceId;
};

export const runWithSpan = async <T>(
  spanName: string,
  attributes: Attributes,
  fn: () => Promise<T> | T,
): Promise<T> => {
  initTracing();
  const tracer = trace.getTracer('serverless-felix');

  return tracer.startActiveSpan(spanName, { attributes }, async (span) => {
    try {
      return await context.with(trace.setSpan(context.active(), span), fn);
    } catch (error) {
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
};
