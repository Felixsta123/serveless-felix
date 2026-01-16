export type PubSubEnvelope = {
  message?: {
    data?: string;
    attributes?: Record<string, string>;
  };
};
