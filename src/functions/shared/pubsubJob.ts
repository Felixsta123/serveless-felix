import type { CloudEvent } from '@google-cloud/functions-framework';
import type { PubSubEnvelope } from './pubsub.js';
import type { JobPayload } from './queue.js';
import { logError, logWarn } from './observability.js';

export const extractMessageData = (event: CloudEvent<PubSubEnvelope>): string | null => {
  const data = event.data;
  if (!data) {
    return null;
  }
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  const messageData = (data as { message?: { data?: unknown } }).message?.data;
  if (typeof messageData === 'string') {
    return messageData;
  }
  if (Buffer.isBuffer(messageData)) {
    return messageData.toString('utf8');
  }
  const legacyData = (data as { data?: unknown }).data;
  if (typeof legacyData === 'string') {
    return legacyData;
  }
  if (Buffer.isBuffer(legacyData)) {
    return legacyData.toString('utf8');
  }
  return null;
};

export const parseJob = (
  event: CloudEvent<PubSubEnvelope>,
  errorTag: string,
  missingTag: string,
): JobPayload | null => {
  const raw = extractMessageData(event);
  if (!raw) {
    logWarn(missingTag, {
      eventId: event.id ?? null,
      dataType: typeof event.data,
      hasMessage: Boolean(event.data?.message),
    });
    return null;
  }
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(decoded) as JobPayload;
  } catch (error) {
    try {
      return JSON.parse(raw) as JobPayload;
    } catch (fallbackError) {
      logError(errorTag, fallbackError, {
        eventId: event.id ?? null,
        primaryError: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
};
