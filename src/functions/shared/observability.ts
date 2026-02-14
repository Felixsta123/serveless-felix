import crypto from 'node:crypto';
import type { CloudEvent, HttpFunction } from '@google-cloud/functions-framework';
import { trace } from '@opentelemetry/api';
import { currentTraceId } from './tracing.js';

type HttpRequest = Parameters<HttpFunction>[0];

type WorkerJobContext = {
  correlationId?: string;
  requestId?: string;
  traceId?: string;
  interaction?: {
    id?: string;
  };
};

export type RequestContext = {
  correlationId: string;
  requestId: string;
  traceId?: string;
};

const TRACE_HEADER = 'x-cloud-trace-context';

const getHeader = (req: HttpRequest, name: string): string | undefined => {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const normalizeId = (value: unknown, maxLength = 128): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.slice(0, maxLength);
};

const parseGoogleTraceId = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) {
    return normalizeId(trimmed, 64);
  }
  return normalizeId(trimmed.slice(0, slashIndex), 64);
};

export const getHttpRequestContext = (
  req: HttpRequest,
  fallbackCorrelationId?: string,
): RequestContext => {
  const correlationId =
    normalizeId(getHeader(req, 'x-correlation-id')) ??
    normalizeId(fallbackCorrelationId) ??
    crypto.randomUUID();

  const requestId =
    normalizeId(getHeader(req, 'x-request-id')) ??
    normalizeId(getHeader(req, 'x-client-request-id')) ??
    correlationId;

  const traceId = parseGoogleTraceId(getHeader(req, TRACE_HEADER)) ?? currentTraceId();

  return { correlationId, requestId, traceId };
};

export const getWorkerContext = (
  event: CloudEvent<unknown>,
  job?: WorkerJobContext | null,
): RequestContext => {
  const correlationId =
    normalizeId(job?.correlationId) ??
    normalizeId(job?.interaction?.id) ??
    normalizeId(event.id) ??
    crypto.randomUUID();

  const requestId = normalizeId(job?.requestId) ?? normalizeId(event.id) ?? correlationId;
  const traceId = normalizeId(job?.traceId, 64) ?? currentTraceId();

  return { correlationId, requestId, traceId };
};

const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: error.message,
      error_stack: error.stack,
    };
  }
  return {
    error_message: String(error),
  };
};

const emitLog = (
  severity: 'INFO' | 'WARNING' | 'ERROR',
  eventName: string,
  fields: Record<string, unknown> = {},
): void => {
  const activeSpanContext = trace.getActiveSpan()?.spanContext();
  const activeTraceId = activeSpanContext?.traceId;
  const activeSpanId = activeSpanContext?.spanId;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;

  const traceField =
    typeof fields.traceId === 'string' && fields.traceId
      ? fields.traceId
      : activeTraceId;

  console.log(
    JSON.stringify({
      severity,
      event: eventName,
      timestamp: new Date().toISOString(),
      ...(traceField && projectId
        ? { 'logging.googleapis.com/trace': `projects/${projectId}/traces/${traceField}` }
        : {}),
      ...(activeSpanId ? { 'logging.googleapis.com/spanId': activeSpanId } : {}),
      ...(activeSpanContext?.traceFlags !== undefined
        ? { 'logging.googleapis.com/trace_sampled': activeSpanContext.traceFlags === 1 }
        : {}),
      ...fields,
    }),
  );
};

export const logInfo = (eventName: string, fields: Record<string, unknown> = {}): void => {
  emitLog('INFO', eventName, fields);
};

export const logWarn = (eventName: string, fields: Record<string, unknown> = {}): void => {
  emitLog('WARNING', eventName, fields);
};

export const logError = (
  eventName: string,
  error: unknown,
  fields: Record<string, unknown> = {},
): void => {
  emitLog('ERROR', eventName, {
    ...fields,
    ...serializeError(error),
  });
};
