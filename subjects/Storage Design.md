# Course 4: Drafting Cloud Architecture Diagrams & Serverless Storage Design

## 1. Architecture Overview

Before starting any project, you must design and document your cloud architecture.

This is your blueprint: it helps you validate design choices, anticipate limitations, and communicate your system clearly to others (and during your defense).

An architecture diagram represents the logical and physical layout of your cloud resources, the flow of requests and events, and how each workload interacts with the others.

Just like your codebase, your diagram will evolve throughout the project and that’s normal. The important part is to maintain it, keeping it synchronized with your implementation.

## 1.1 Mandatory Elements

Your diagram should explicitly show (non-exhaustive list: adapt based on your project, cloud provider and implementation):

### Core Cloud Resources

- Entry points: API Gateway, Load Balancer, or HTTP endpoint
- Serverless compute: Cloud Functions, Cloud Run, Lambda, App Engine
- Messaging systems: Pub/Sub, SQS, SNS, EventBridge, EventArc
- Storage systems: Cloud Storage, S3
- Databases: Firestore, DynamoDB
- Identity and Access Management: IAM roles, service accounts, Cognito/Firebase Auth

### Flows

- Request flow: How client requests enter the system (frontend → API → backend → database).
- Event flow: How internal services communicate asynchronously (event publishing, queue processing).
- Workload flow: How the data process, stored and delivered.

### Network & Security

- Public vs private resources/entrypoints
- Access control (IAM or permissions boundaries)
- Integration points with external services (Discord API, GitHub Actions, etc.)

## 1.2 Architecture Diagram Examples

Your architecture diagram should be specific to your chosen Cloud Provider, not cloud-agnostic. You can use the official icon libraries from GCP or AWS to make your diagram clear and consistent.

👉 Recommended tools: Lucidchart, Draw.io (Diagrams.net), Cloudcraft (AWS), or Google Cloud Architecture Diagramming tool

Example: Simple GCP Serverless Event & Workload flow Architecture
Example: AWS Serverless Event-Driven Architecture

Image present (page 3): Example diagrams showing a GCP serverless event/workload flow (Cloud Storage → Cloud Run services via Pub/Sub triggers) and an AWS serverless event-driven architecture (client/API Gateway/Lambda/SQS/DynamoDB with EventBridge/rules).

## 1.3 Recommendations for Effective Diagrams

✅ Be explicit: Show each cloud resource with its actual name (e.g. “Cloud Function: pixel-proxy-fn”).
✅ Show flows: Use arrows and legends to show data and event direction.
✅ Label connections: Indicate protocols (HTTP, Pub/Sub, SQS, etc.).
✅ Include roles and IAM boundaries: Even abstractly.
✅ Keep layers clear: Users interactions (discord/frontend) / Gateway,Proxies / Compute / Data.
✅ Iterate: Start with a simple logical flow, then refine with physical details.

⚠️ Important

Your final architecture diagram will be part of your defense.

You’ll need to justify each resource and explain how the event-driven flow and workloads operate. Make sure it stays up-to-date as your implementation evolves.

## 2. Serverless Storage Design

A key component of any cloud architecture is how data is stored, served, and accessed.

In a serverless environment, you’ll use managed storage and NoSQL databases that scale automatically.

## 2.1 Object Storage (Buckets)

Buckets (Cloud Storage or S3) are ideal for static content and binary data such as:

- User-uploaded images, assets, or documents
- Application snapshots or exports
- Static web apps (HTML, JS, CSS)

### Advantages

- Serverless: no servers to manage, “infinite” scalability
- Versioning and lifecycle management
- Integrated access control via IAM
- Direct integration with other services (functions, CDN, etc.)
- Cheap and pay-as-you-go

### Typical use cases

- Hosting your web frontend
- Saving generated images (e.g., canvas snapshots)
- Backing up or exporting data

## 2.2 Serverless NoSQL Databases

NoSQL serverless databases like Firestore (GCP) and DynamoDB (AWS) are designed for:

- High scalability
- Low-latency key/value access
- Flexible schema for event-driven applications

They are perfect for:

- Storing real-time states (like a canvas or chat)
- User metadata or configuration
- Activity logs or rate limits

### Firestore (GCP)

- Document-oriented structure: Collections → Documents → Fields
- Real-time updates supported
- Fully managed and scalable
- Easy integration with Cloud Functions and IAM

### DynamoDB (AWS)

- Table-based structure with primary keys and optional secondary indexes
- Automatically scales throughput and storage
- Integrated with Lambda, SQS, and API Gateway
- Millisecond latency for most workloads

## 2.3 Choosing Between Bucket and NoSQL

| Use Case | Recommended Storage | Reason |
|---|---|---|
| Static assets, images, or exports | Cloud Storage / S3 | Cheap, scalable, file-oriented |
| Structured event data, user states | Firestore / DynamoDB | Low-latency queries, structured data |
| Web hosting | Cloud Storage / S3 + CDN | Native static hosting |
| Real-time updates | Firestore | Built-in realtime listeners |
| Large datasets (backup/archive) | Cloud Storage / S3 | Low-cost archival |

## 2.4 Best Practices

✅ Keep your data schema simple and consistent.
✅ Use IAM for fine-grained access control.
✅ Prefer serverless storage classes over self-managed databases.
✅ Enable monitoring and access logs on your buckets and databases.
✅ Combine NoSQL + bucket to separate structured data from binary content.

## 3. Key Takeaways

| Topic | Key Points |
|---|---|
| Architecture Diagram | Shows your resources, flows, and interactions. Must be Cloud-specific. |
| Requests Flow | Visualize how requests go through gateways and in your Event Flow. |
| Event Flow | Represent asynchronous processing between components. |
| Serverless Storage | Use Buckets for binary/static content, NoSQL for structured data. |
| IAM & Security | Always apply the least privilege. |
| Documentation | Keep the diagram and internal documentation maintained throughout your project. |
