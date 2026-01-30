# C8: Serverless Frontend & Scaling Patterns

In this course, we focus on the serverless frontend and data strategies for your RPlace project.
You will learn how to host a responsive web app, handle real-time canvas updates efficiently,
and apply best practices for scaling and cost management in a serverless environment.

## 1. Hosting Serverless Web Applications

For serverless projects, multiple hosting options exist depending on cloud provider:

### 1.1 Google Cloud Platform (GCP)

- **Cloud Storage + Static Website Hosting**
  - Pros: Simple, cheap, scales automatically, no server management.
  - Cons: Limited for dynamic content, needs extra service for OAuth2 or real-time updates.

- **App Engine (Standard/Serverless) ✅ Recommended**
  - Pros: Supports dynamic content, integrates with OAuth2, automatic scaling.
  - Cons: Slightly higher cost than static hosting.
  - Ideal for this project: real-time canvas updates + Discord OAuth2 login.

### 1.2 Amazon Web Services (AWS)

- **S3 + CloudFront**
  - Pros: Static hosting + CDN for fast global delivery.
  - Cons: Needs extra Lambda/Api Gateway for dynamic logic or OAuth2.

- **CloudFront + Lambda@Edge / API Gateway (or Elastic Beanstalk) ✅ Recommended**
  - Pros: Real-time processing at edge, caching options, easier OAuth2.
  - Cons: More complex to manage + higher cost.

References:
- GCP Hosting Static Websites
- App Engine Overview
- AWS S3 Static Hosting
- CloudFront + S3
- AWS Elastic Beanstalk

## 2. Data Storage & Frontend Updates

Frontend needs fresh canvas state for a smooth UX.

### 2.1 Storage Options

- **Full canvas state in storage (S3 / Cloud Storage / DynamoDB / Firestore)**
  - Pros: Simple to implement, consistent state.
  - Cons: Large canvas can be heavy to read on each request.

- **Chunked canvas**
  - Split canvas into chunks (e.g., 64x64 pixels).
  - Store changes per chunk for efficient reads/writes.

- **Delta / Event-based updates**
  - Frontend subscribes to a message topic (Pub/Sub / SNS) or queue for pixel updates.
  - Only transmit changed pixels.
  - Reduces bandwidth and latency.

- **Periodic snapshots**
  - Store the full canvas as an image periodically.
  - Keep pixel edits between snapshots in database or events.
  - Optimizes recovery and storage.

### 2.2 Frontend Update Strategies

- **Polling:** Frontend fetches updates periodically.
  - Pros: Simple.
  - Cons: Higher bandwidth, latency between updates.

- **Event-driven updates:** Frontend subscribes to topics for real-time pixel events. ✅ Recommended
  - Pros: Near real-time updates, reduced load on backend.
  - Cons: More complex to implement.

### 2.3 Additional Optimization Tips

- Limit the number of colors to reduce data size.
- Compress pixel data (e.g., base64 or binary encoding).
- Batch multiple pixel edits into single events.
- Use caching layers (Cloud CDN, in-memory cache, etc.) and cache invalidation for frequent reads.

## 3. Scaling Patterns & Cost Management

Serverless scales automatically, but careful design helps reduce costs and improve performance.

### 3.1 Scaling Patterns

- Function-level concurrency: Setup Lambda / Cloud Functions concurrency and resources properly.
- Queue-based decoupling: Use message brokers (SQS / Pub/Sub) to buffer spikes in user events.
- Fan-out / fan-in: Worker functions process events in parallel and consolidate updates/events.

### 3.2 Cost Management

- Monitor number of function invocations and data transfer.
- Batch events to reduce per-invocation costs.
- Use ephemeral storage and avoid unnecessary logging for high-frequency events.
- Consider caching canvas snapshots to reduce repeated reads.

### 3.3 References

- AWS Lambda Best Practices
- GCP Cloud Functions Best Practices
