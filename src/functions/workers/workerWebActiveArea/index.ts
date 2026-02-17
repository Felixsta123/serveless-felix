import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import { getWorkerContext, logError, logInfo } from '../../shared/observability.js';
import { parseJob } from '../../shared/pubsubJob.js';
import { runWithSpan } from '../../shared/tracing.js';
import { loadActiveArea, writeError, writeReady } from '../workerWebRead/shared.js';

export const workerWebActiveArea = async (event: CloudEvent<PubSubEnvelope>) =>
  runWithSpan(
    'workerWebActiveArea.pubsub',
    {
      'faas.trigger': 'pubsub',
      'messaging.system': 'pubsub',
      'messaging.destination': 'jobs',
      'messaging.operation': 'process',
    },
    async () => {
      const job = parseJob(
        event,
        'worker_web_active_area_parse_failed',
        'worker_web_active_area_missing_message_data',
      );
      if (!job || job.kind !== 'web.activeArea.requested') {
        return;
      }

      const context = getWorkerContext(event, job);
      try {
        const payload = await loadActiveArea();
        await writeReady(job.responseRequestId, job.userId, job.kind, payload);
        logInfo('worker_web_active_area_processed', {
          ...context,
          userId: job.userId,
          kind: job.kind,
          responseRequestId: job.responseRequestId,
        });
      } catch (error) {
        logError('worker_web_active_area_failed', error, {
          ...context,
          userId: job.userId,
          kind: job.kind,
          responseRequestId: job.responseRequestId,
        });

        const message = error instanceof Error ? error.message : 'Request processing failed';
        try {
          await writeError(job.responseRequestId, job.userId, job.kind, message);
        } catch (writeErrorFailure) {
          logError('worker_web_active_area_write_error_failed', writeErrorFailure, {
            ...context,
            userId: job.userId,
            kind: job.kind,
            responseRequestId: job.responseRequestId,
          });
        }
      }
    },
  );
