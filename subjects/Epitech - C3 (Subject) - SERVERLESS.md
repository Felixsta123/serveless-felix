# C3: Cloud-Native & Serverless: Subject

## 🧩 Collaborative Pixel Canvas via Discord & Web

In this project, you will design and implement a functional prototype of a fully serverless
multiplayer drawing platform, inspired by Reddit’s r/place.

Users will collaboratively draw pixels on a shared canvas via Discord bot commands and a
serverless web interface.

Your goal is to architect, build, document, and defend a secure, scalable, and event-driven
cloud-native system, using only serverless services from Google Cloud Platform (GCP) or
Amazon Web Services (AWS).

---

# 🚀 1. Architecture Design

## 1.1 Goal

Design a cloud architecture that enforces scalability, maintainability, and compliance with
serverless principles.

### Mandatory constraints

● The entire solution must be serverless: no virtual machines, Kubernetes, or manually
managed servers.
● All public endpoints must go through an API Gateway (or equivalent) to manage
access and routing.
● Persistent data must be stored in serverless databases or storage (Firestore,
DynamoDB, S3, etc.).
● All workloads must be event-driven, asynchronous and must be invoked using
message broker events (SQS, Pub/Sub, EventBridge, EventArc), except for lightweight
proxy functions that acknowledge HTTP requests and publish events to a queue.
● Your proxies and functions can’t be invoked directly using HTTP without going
through the API Gateway (or equivalent).
● Functions must follow the Single Responsibility Principle (SRP): each function
performs a single, clear task.
● You are free to use any languages and frameworks you want to achieve this project.

## 1.2 Serverless services

A none exhaustive list of serverless services available to build your solution, you may use
services that are not listed here, as long as the service is purely serverless and that you are
able to justify its usage during your defense:

### GCP:

● Compute: Cloud Run, Cloud Functions, App Engine
● Storage: Cloud Storage, Firestore
● Messaging: Pub/Sub, EventArc
● Networking / API: API Gateway, Cloud Endpoints
● Monitoring: Cloud Logging, Cloud Trace, Cloud Monitoring
● Auth & IAM: Cloud IAM

### AWS:

● Compute: Lambda, CloudFront
● Storage: S3, DynamoDB
● Messaging: SQS, EventBridge, SNS
● Networking / API: API Gateway
● Monitoring: CloudWatch, X-Ray
● Auth & IAM: IAM

## 1.3 Key architectural expectations

● All public traffic (Discord and Web) must go through API Gateway → proxy function.
● The proxy publishes all events (pixel draw requests, Discord commands) to Pub/Sub
Topics or SQS queues or using EventBridge / EventArc.
● A worker function consumes the queue, validates rate limits, and updates the canvas
state in your persistent storage or performs discord command.
● Discord commands to draw pixels and to manage the game session.
● A Discord snapshot command triggers a function that generates a canvas image,
stores it in a bucket, and posts the URL back to Discord.
● A serverless web app allows users to view and draw pixels, interacting via the same
event-driven pipeline.

---

# 🤖 2. Discord Bot Development

## 2.1 Objective

Develop a serverless Discord bot that allows users to interact with the canvas through
commands and responses.

## 2.2 Expected features

You are free to design your commands syntax, but must provide discord command equivalent
to:

● Users can draw pixels on the canvas
● Users can retrieve the current canvas state
● Admins can manage sessions (start, pause, reset)
● Admins can take snapshots of the canvas and the command will post the snapshot on
discord in a picture or embedded format.

## 2.3 Technical constraints

● The bot must use Discord Interactions (slash commands, buttons, etc.) with custom
Endpoint URL that point to your API Gateway.
● All bot requests must go through API Gateway → proxy function → queue.
● All operations must be asynchronous (acknowledge first, then process).

### References

● Discord Developer Portal
● Discord Slash Commands & Interactions

---

# ️ 3. Data Storage

## 3.1 Constraints

● Store pixel data efficiently with timestamps and user identifiers.
● Your canvas must have a configurable or infinite size: Think twice about your data
model, your canvas size could be almost infinite if properly implemented.
● Maintain canvas consistency even under concurrent updates.
● Record the author and update timestamp for every pixel for the current state.
● Implement rate limiting per user (e.g., 20 pixels per minute).

## 3.2 Serverless storage services

● GCP: Firestore, Cloud Storage
● AWS: DynamoDB, S3

## 3.3 References

● GCP Firestore Documentation
● GCP Cloud Storage Documentation
● AWS DynamoDB Documentation
● AWS S3 Documentation

---

# 🌐 4. Web Application Development

## 4.1 Objective

Develop a serverless web interface where users can:

● Draw pixels interactively.
● View the current state of the canvas in near real-time.
● Authenticate using Discord OAuth2 or custom identities linked to their Discord account.

## 4.2 Constraints

● The web app must be fully serverless: no self-managed backend or VMs.
● API calls must be authenticated.
● The state of the canvas on your web app must be as fresh as possible, ideally in near
real-time.
● Users need to log in with their Discord account using Oauth2 or custom identities linked
to their discord account.
● A user must be able to select a pixel to: draw and see the author and update timestamp.

## 4.3 Serverless frontend services

● GCP: Cloud Run, Cloud storage static hosting, App Engine
● AWS: CloudFront, S3 static hosting

## 4.4 References

● Discord OAuth2 for Web Apps
● Hosting Static Sites on GCP
● Hosting Static Sites on AWS S3 + CloudFront
● Cloud Run Documentation
● AWS CloudFront Documentation

---

# ⚙️ 5. Monitoring, Logging, and Security

## 5.1 Expectations

● Log all key events: pixel draws, Discord commands, errors, and metrics.
● Set up error alerts or metrics dashboards using cloud-native tools.
● Ensure application security: manage IAM permissions throughout the project according
to the principle of least privilege:
○ Use dedicated service accounts or IAM roles, with minimum permissions.
○ Avoid public access to backend services.
○ Restrict unauthenticated access to API endpoints and storage.
○ Use safe protocols for your public traffic (HTTPS).
○ Manage your secrets properly using a secret manager.

### Monitoring & Observability services

● GCP: Cloud Logging, Cloud Monitoring, Cloud Trace.
● AWS: CloudWatch metrics, logs, and AWS X-Ray for tracing.

### References

● GCP Cloud Monitoring
● GCP Cloud Logging
● AWS CloudWatch Documentation
● AWS X-Ray Documentation
● GCP IAM with Cloud Run & Functions
● AWS Lambda Execution Role Documentation

---

# 🧱 6. Deliverables

You must deliver:

● Source Code: Well-structured repository organized by function/service.
● Documentation: README and setup guide.
● Architecture Diagrams: Show cloud services, data flow, queues, functions, and
integrations.
● Monitoring Setup: Logs, tracing, dashboard and alerting configuration.
● IaC (optional): Terraform, CloudFormation, Pulumi, or Serverless Framework templates.

---

# ‍⚖️ 7. Defense Guidelines

During your defense, you must be able to:

● Explain your architecture and design choices.
● Demonstrate that your system works (Discord + Web).
● Show monitoring dashboards, logs and/or trace proving scalability and reliability.
● Discuss how you handled concurrency, rate limiting, authentication and data
persistence.
● Propose potential improvements and optimizations.

---

# 🧮 8. Evaluation Criteria

Your project will be evaluated based on:

● Functionality – Meets all technical requirements and constraints.
● Serverless Compliance – Only serverless components are used.
● Security – Proper IAM setup and least privilege applied.
● Scalability – Handles multiple users and concurrent updates.
● Code Quality – Clean, modular, and maintainable.
● Documentation – Clear setup instructions and architecture diagrams.
● Innovation – Creative approaches or enhancements.
● Comprehension – Ability to explain and justify your architecture.
● Bonus – Additional features, optimizations or outstanding implementations. (e.g., IaC,
real-time streaming, advanced monitoring, “infinite” canvas size, advanced web app UX,
etc.). Applicable only if the project constraints have been met.
