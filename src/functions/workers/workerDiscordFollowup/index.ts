import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSubEnvelope } from '../../shared/pubsub.js';
import { postDiscordFollowup } from '../../shared/discordApi.js';
import {
  getWorkerContext,
  logError,
  logInfo,
} from '../../shared/observability.js';
import { parseJob } from '../../shared/pubsubJob.js';
import { runWithSpan } from '../../shared/tracing.js';

export const workerDiscordFollowup = async (event: CloudEvent<PubSubEnvelope>) =>
  runWithSpan(
    'workerDiscordFollowup.pubsub',
    {
      'faas.trigger': 'pubsub',
      'messaging.system': 'pubsub',
      'messaging.destination': 'jobs',
      'messaging.operation': 'process',
    },
    async () => {
      const job = parseJob(
        event,
        'worker_discord_followup_parse_failed',
        'worker_discord_followup_missing_message_data',
      );
      if (!job || job.kind !== 'discord.followup') {
        return;
      }

      const context = getWorkerContext(event, job);
      try {
        await postDiscordFollowup(job.applicationId, job.token, job.content);
        logInfo('worker_discord_followup_sent', {
          ...context,
        });
      } catch (error) {
        logError('worker_discord_followup_failed', error, {
          ...context,
        });
      }
    },
  );
