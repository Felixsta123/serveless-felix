# C5: Events Messaging & Orchestration

## 1. Introduction to Events & Messaging

Event-driven architectures decouple producers (that emit events) from consumers (that react to them).
This pattern is essential in serverless systems, where each function or service should handle a specific task asynchronously.

### 1.1 Why Events?

- Reduce tight coupling between services
- Enable horizontal scalability
- Improve fault tolerance and resilience
- Allow asynchronous, distributed processing

### 1.2 Core Concepts

- **Event**: A record that something happened (e.g., user uploaded a file).
- **Producer**: The component that sends the event.
- **Consumer**: The component that listens for and processes events.
- **Topic / Queue**: A channel through which events are distributed.
- **Subscription**: A delivery mechanism from a topic to a consumer.

### 1.3 Fan-out / Fan-in

- A single event may trigger multiple consumers (fan-out)
  - Example: A pixel update event could trigger a DB update, cache invalidation, and UI refresh worker
- Multiple events can be aggregated or combined (fan-in) by a separate consumer that consolidates state

## 2. Message Brokers on Cloud Providers

### 2.1 Google Cloud Platform (GCP)

- **Pub/Sub**: Fully managed asynchronous messaging service.
  - Topic: Where events are published
  - Subscription: Stream of messages from a topic to a subscriber
  - Trigger types: HTTP push, pull, or direct trigger for Cloud Run / Cloud Functions
- **EventArc**: Routes events from GCP services (e.g., Cloud Storage, Firestore changes) to Cloud Run or Cloud Functions

🔗 Pub/Sub Documentation
🔗 EventArc Documentation

### 2.2 Amazon Web Services (AWS)

- **SQS**: Reliable message queues for event decoupling
- **SNS**: Pub/Sub system for broadcasting messages to multiple subscribers
- **EventBridge**: Event routing between AWS services and custom event buses
- **Triggers**: Lambda functions can be triggered by SQS, SNS, EventBridge, S3 events, DynamoDB streams, and HTTP API Gateway

🔗 SQS Documentation
🔗 SNS Documentation
🔗 EventBridge Documentation

## 3. Designing Topics & Event Channels

Proper topic and queue design is essential for scalability and clarity.

### 3.1 Splitting Topics

Logical separation of events in separated topics is recommended, examples:

- `pixel.draw` → Draw pixel requests
- `pixel.processed` → Processed pixel updates
- `snapshot.requested` / `snapshot.ready` → Snapshot workflow
- `discord.command` → Commands issued by Discord bot

### 3.2 Dead Letter Queues & Retention

- **Dead Letter Queues (DLQ):**
  - Both GCP Pub/Sub and AWS SQS support DLQs.
  - Always define DLQs for failed messages to avoid silent data loss and enable safe retries.
- **Message Retention:**
  - Properly configure retention policies to ensure events are available long enough for processing and debugging.
  - Retention helps with replaying events in case of failures and maintaining system reliability as messages retained will be retried in case of failure.

🔗 GCP Dead Letter Topics
🔗 AWS Dead Letter Queues

## 4. Event Sources and Triggers

Serverless functions can be triggered by multiple event types. Examples for GCP and AWS:

- **HTTP / API Gateway**
  - GCP: API Gateway → Cloud Run / Cloud Functions (or proxy)
  - AWS: API Gateway → Lambda (or proxy)
- **Message Broker**
  - GCP: Pub/Sub
  - AWS: SQS / EventBridge
- **Storage Changes**
  - GCP: Cloud Storage ObjectCreated / ObjectRemoved
  - AWS: S3 ObjectCreated / ObjectRemoved
- **Database Changes**
  - GCP: Firestore triggers
  - AWS: DynamoDB Streams
- **Scheduled Events**
  - GCP: Cloud Scheduler
  - AWS: EventBridge Scheduler

Each trigger type supports asynchronous invocation and built-in retries.

Choose the trigger that best fits your workflow type.

## 5. Workflow Design & Orchestration

### 5.1 Event-driven workflow examples

#### Draw flow

- API Gateway → proxy function validates and publishes `pixel.command` to topic
- Worker consumes `pixel.command`, enforces rate limit, writes to storage, and publishes `pixel.processed`
- Subscribers consume `pixel.processed` to update real-time view/data

#### Snapshot flow

- Admin triggers `/snapshot` → publishes `snapshot.requested`
- Snapshot generator worker reads DB, composes image, uploads it into a storage bucket
- The bucket emits an event (ObjectCreated) which acts as `snapshot.ready`
- A notifier function listens to this event and posts the authenticated image URL back to Discord

## 6. References

- GCP Pub/Sub Documentation
- GCP EventArc Documentation
- AWS SQS Documentation
- AWS SNS Documentation
- GCP Dead Letter Topics
- AWS Dead Letter Queues
- AWS DynamoDB Streams
- GCP Firestore triggers
- Cloud Storage Object Change Notifications
- Using EventArc with Cloud Storage
- Configuring Event Notifications for S3
- Amazon S3 Event Types
