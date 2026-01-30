# C6: Security & Monitoring in Serverless Systems

## 1. Introduction

In serverless architectures, security and monitoring are critical. Without dedicated servers, you rely on managed services, which shifts responsibility from infrastructure maintenance to proper configuration, IAM policies, logging, and observability.

In this course, you will learn:

- How to secure serverless functions and resources using IAM and secrets management.
- How to monitor serverless workflows for reliability and performance.
- Practical examples for GCP and AWS relevant to your project.

## 2. Observability and Reliability

Serverless workloads require careful monitoring since functions are ephemeral and event-driven. Proper observability ensures you can detect failures, monitor performance, and maintain system reliability.

### 2.1 Logging and Tracing

- **AWS:**
  - CloudWatch Logs: Capture function logs and error messages.
  - X-Ray: Trace events across multiple functions and see latency, bottlenecks, and errors.
- **GCP:**
  - Cloud Logging: Centralized logs for Cloud Functions, Cloud Run, and API Gateway.
  - Cloud Trace: Visualize request latency and trace messages across functions.

Tips:

- Log key events: pixel draws, Discord commands, errors, and state changes.
- Include request IDs or correlation IDs to trace event flows.

🔗 Cloud Monitoring Documentation
🔗 AWS CloudWatch Documentation

### 2.2 Monitoring Queues

Queues are critical in event-driven workflows. Monitoring ensures no events are lost or stuck.

Metrics to track:

- Queue depth (pending messages)
- Message age (how long a message waits before being processed)
- Processing latency
- DLQ entries (failed messages)

Alerting: Configure alerts when thresholds are exceeded (e.g., messages older than X seconds, DLQ count > 0).

## 3. IAM & Secret Manager

Assign a dedicated service account (GCP) or IAM role (AWS) per function/service, granting only the permissions required (least privilege). Use Secret Manager (GCP) or Secrets Manager / SSM Parameter Store (AWS) for credentials or API keys, which your services can access securely.

### 3.1 GCP IAM & Secret Manager Example

1. Create Service Account

~~~bash
gcloud iam service-accounts create my-function-sa --display-name "Service Account for My Function"
~~~

2. Assign IAM Roles

~~~bash
# Grant access to a secret
gcloud secrets add-iam-policy-binding <SECRET_NAME> \
  --member="serviceAccount:my-function-sa@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Grant logging access
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:my-function-sa@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/logging.logWriter"
~~~

3. Deploy Function with Service Account

~~~bash
gcloud run deploy my-http-function \
  --source . \
  --function HelloGet \
  --base-image python313 \
  --region europe-west1 \
  --service-account my-function-sa@<PROJECT_ID>.iam.gserviceaccount.com
~~~

✅ Best Practices: Unique service account per function/service, least privilege, logging enabled, secrets accessed securely.

🔗 GCP IAM Documentation
🔗 GCP Secret Manager Documentation

### 3.2 AWS IAM & Secret Manager Example

1. Create Policy

~~~bash
aws iam create-policy \
  --policy-name LambdaSecretAccessPolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:<REGION>:<ACCOUNT_ID>:secret:<SECRET_NAME>"
    }]
  }'
~~~

2. Create Execution Role

~~~bash
aws iam create-role \
  --role-name LambdaExecutionRole \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "lambda.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'
~~~

3. Attach Policies

~~~bash
aws iam attach-role-policy \
  --role-name LambdaExecutionRole \
  --policy-arn arn:aws:iam::<ACCOUNT_ID>:policy/LambdaSecretAccessPolicy

aws iam attach-role-policy \
  --role-name LambdaExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
~~~

4. Assign Role to Lambda

~~~bash
aws lambda create-function \
  --function-name MyLambdaFunction \
  --runtime python3.12 \
  --role arn:aws:iam::<ACCOUNT_ID>:role/LambdaExecutionRole \
  --handler lambda_function.lambda_handler \
  --zip-file fileb://function.zip
~~~

✅ Best Practices: Unique role per function, least privilege, logging enabled, secrets accessed securely.

🔗 AWS IAM Documentation
🔗 AWS Secrets Manager Documentation

## 4. Security Best Practices

- Least Privilege: Only give functions the permissions they absolutely need.
- Isolation: Use separate service accounts / roles per function or microservice.
- Secrets Management: Never hardcode secrets; always use a secret manager.
- Secure Endpoints: Ensure all API Gateway endpoints are HTTPS and properly authorized.
- Logging: Centralize logs but avoid logging sensitive information.

## 5. Summary

- Observability and monitoring are essential in serverless: logs, traces, metrics, DLQs..
- IAM policies are your primary tool for securing access between your services.
- Always use secret managers for sensitive values, as token, private key, etc.
- Proper configuration allows safe, auditable, and maintainable cloud-native applications.

## 6. References

- AWS CloudWatch Documentation
- AWS X-Ray Documentation
- AWS IAM Documentation
- AWS Secrets Manager
- GCP Cloud Logging
- GCP Cloud Trace
- GCP IAM Documentation
- GCP Secret Manager
