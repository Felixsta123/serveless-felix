import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import { getWorkerContext, logError, logInfo } from '../../shared/observability.js';
import { parseJob } from '../../shared/pubsubJob.js';
import { runWithSpan } from '../../shared/tracing.js';
import { createRealtimeToken, writeError, writeReady } from '../workerWebRead/shared.js';

export const workerWebRealtimeToken = async (event: CloudEvent<PubSubEnvelope>) =>
  runWithSpan(
    'workerWebRealtimeToken.pubsub',
    {
      'faas.trigger': 'pubsub',
      'messaging.system': 'pubsub',
      'messaging.destination': 'jobs',
      'messaging.operation': 'process',
    },
    async () => {
      const job = parseJob(
        event,
        'worker_web_realtime_token_parse_failed',
        'worker_web_realtime_token_missing_message_data',
      );
      if (!job || job.kind !== 'web.realtimeToken.requested') {
        return;
      }

      const context = getWorkerContext(event, job);
      try {
        const token = await createRealtimeToken(job);
        await writeReady(job.responseRequestId, job.userId, job.kind, { token });
        logInfo('worker_web_realtime_token_processed', {
          ...context,
          userId: job.userId,
          kind: job.kind,
          responseRequestId: job.responseRequestId,
        });
      } catch (error) {
        logError('worker_web_realtime_token_failed', error, {
          ...context,
          userId: job.userId,
          kind: job.kind,
          responseRequestId: job.responseRequestId,
        });

        const message = error instanceof Error ? error.message : 'Request processing failed';
        try {
          await writeError(job.responseRequestId, job.userId, job.kind, message);
        } catch (writeErrorFailure) {
          logError('worker_web_realtime_token_write_error_failed', writeErrorFailure, {
            ...context,
            userId: job.userId,
            kind: job.kind,
            responseRequestId: job.responseRequestId,
          });
        }
      }
    },
  );
