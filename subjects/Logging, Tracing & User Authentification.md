# C7: Logging, Tracing, and User Authentication

## 1. Introduction

In this course, you will learn how to instrument your serverless applications on AWS and GCP with structured logging and tracing, and how to authenticate users on your frontend via Discord OAuth2.

Logging and tracing allow you to monitor workflows, correlate events, and troubleshoot failures.

OAuth2 ensures that users interacting with the canvas are legitimate and linked to their Discord identities.

## 2. Cloud-Agnostic Logging & Tracing Concepts

- **Structured Logs**: JSON-formatted logs containing key metadata, e.g., `request_id`, `trace_id`, `correlation_id`.
- **Trace/Span**: A single unit of work in a distributed system. Correlating logs with traces allows you to follow a request through multiple services.
- **Correlation ID vs Request ID**: Often the same concept; uniquely identifies a request and is propagated across services for traceability.

Best Practices:

- Assign a unique `correlation_id` per user action or request.
- Include trace IDs when supported by the cloud provider.
- Ensure each function has IAM permissions to write logs and traces.
- Use structured logs for automated processing.

## 3. AWS Example: Logging & Tracing with Lambda and X-Ray

```python
import json
import logging
import uuid
from aws_xray_sdk.core import xray_recorder, patch_all
from aws_xray_sdk.core import capture

# Patch supported libraries to capture downstream calls
patch_all()

# Structured logging setup
logger = logging.getLogger()
logger.setLevel(logging.INFO)

@capture('lambda_handler')  # Auto-instrument tracing
def lambda_handler(event, context):
    # Correlation ID for request
    correlation_id = event.get("correlation_id", str(uuid.uuid4()))
    trace_id = xray_recorder.current_segment().trace_id

    # Custom span example
    with xray_recorder.in_segment('custom_processing') as span:
        log_entry = {
            "function": "lambda_pixel_processor",
            "message": "Processing pixel event",
            "correlation_id": correlation_id,
            "trace_id": trace_id,
            "user_id": event.get("user_id"),
        }
        logger.info(json.dumps(log_entry))

    # Simulate some processing
    result = {"status": "processed", "correlation_id": correlation_id, "trace_id": trace_id}
    return result
````

References:

* AWS X-Ray Documentation
* AWS Lambda Logging

## 4. GCP Example: Logging & Tracing with Cloud Functions v2 and OpenTelemetry

```python
import logging
import uuid
from opentelemetry import trace
from opentelemetry.instrumentation.cloud_functions import CloudFunctionsInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

# Initialize tracer
trace.set_tracer_provider(TracerProvider())
tracer = trace.get_tracer(__name__)
span_processor = BatchSpanProcessor(OTLPSpanExporter())
trace.get_tracer_provider().add_span_processor(span_processor)

# Instrument Cloud Functions
CloudFunctionsInstrumentor().instrument()

# Structured logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def pixel_processor(event, context):
    correlation_id = event.get("correlation_id", str(uuid.uuid4()))

    # custom span example
    with tracer.start_as_current_span("custom_processing") as span:
        log_entry = {
            "function": "cloud_function_pixel_processor",
            "message": "Processing pixel event",
            "correlation_id": correlation_id,
            "trace_id": span.get_span_context().trace_id,
            "user_id": event.get("user_id"),
        }
        logger.info(log_entry)

    # Simulate processing
    return {"status": "processed", "correlation_id": correlation_id, "trace_id": span.get_span_context().trace_id}
```

References:

* GCP Cloud Functions Logging
* OpenTelemetry for Cloud Functions

## 5. Alerts

Monitoring your serverless system is essential to detect failures and performance issues but using alerts will ensure that you’ll be aware of the issues when they occur.

Key points:

* Track key metrics such as function errors, execution latency, queue depth, or message backlog.
* Configure thresholds for automatic notifications to detect anomalies quickly.
* Alerts can notify via email, Slack, or other supported channels.

Examples:

* **AWS (CloudWatch)**:

  * Create metric alarms for Lambda errors, throttling, or SQS queue depth.
  * 🔗 AWS CloudWatch Alarms Documentation
* **GCP (Cloud Monitoring)**:

  * Create alerting policies for Cloud Functions, Pub/Sub, or other service metrics (errors, execution latency, queue backlog).
  * 🔗 GCP Alerting Policies Documentation

## 6. Discord OAuth2 for User Authentication

For the frontend web app, users authenticate with Discord OAuth2 to link their account to your system.

Flow:

1. Authorization: User clicks “Login with Discord” → redirected to Discord with your client ID, scopes (identify), and redirect URI.
2. Consent: User approves → redirected to your service with authorization code.
3. Token Exchange: Exchanges code for an access token → retrieves Discord ID → links to users in your system.
4. Authenticated Actions: Users can interact with the canvas using their linked Discord identity.

Best Practices:

* Do not store the user's access token in your backend.
* Always use HTTPS and validate redirect URIs.
* Keep scopes minimal (identify is sufficient).

References:

* Discord OAuth2 Documentation
* OAuth 2.0 RFC
