import { CloudEvent } from '@google-cloud/functions-framework';
import { PubSubEnvelope } from '../../shared/pubsub';

export const workerSnapshot = (event: CloudEvent<PubSubEnvelope>) => {
  console.log('workerSnapshot received', event.id);
};
