import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSubEnvelope } from '../../shared/pubsub.js';

export const workerSnapshot = (event: CloudEvent<PubSubEnvelope>) => {
  console.log('workerSnapshot received', event.id);
};
