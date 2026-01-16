import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSubEnvelope } from '../../shared/pubsub.js';

export const workerDraw = (event: CloudEvent<PubSubEnvelope>) => {
  console.log('workerDraw received', event.id);
};
