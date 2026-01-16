# **Course 2 – Core Serverless Services & Secure Access**

## **1\. Introduction**

In the previous course, you learned the fundamentals of cloud computing and how serverless fits within different cloud service models.

Now, we move from concepts to practice.

In this module, you will:

* Understand the core components of a serverless architecture: functions.

* Learn how to secure access to these components using Identity and Access Management (IAM).

* Deploy and secure your first “Hello World” serverless function on your cloud provider.

By the end, you’ll have a simple, fully functional, cloud-hosted function accessible through a public HTTPS endpoint, secured by IAM.

---

## 

## 

## 

## 

## 

## 

## **2\. Core Serverless Services**

### **2.1 Serverless Functions**

Serverless functions are the core compute unit of serverless architectures.

They are small pieces of code that:

* Run only when triggered by an event (HTTP call, message, file upload, etc.).

* Automatically scale based on demand.

* Are billed per invocation and execution time.

Each major cloud provider offers its own version of this service.

**GCP – Cloud Functions or Cloud Run**

* **Cloud Functions**: Best for event-driven functions (HTTP, Pub/Sub, Cloud Storage).

* **Cloud Run**: Best for containerized applications and microservices that need more flexibility (custom runtimes, dependencies, or background tasks).

**Examples:**

* [Deploy on GCP Cloud Functions](https://docs.cloud.google.com/functions/docs/deploy)  
* [Hello World on GCP Cloud Functions](https://docs.cloud.google.com/functions/docs/samples/functions-helloworld-get?hl=en)

**AWS – Lambda**

AWS Lambda lets you run code without provisioning servers.  
It integrates natively with AWS services (S3, API Gateway, SQS, etc.) and scales automatically.

**Examples:**

* [Deploy on AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-zip.html)

---

## 

## 

## **2.2 Securing Access with IAM**

IAM (Identity and Access Management) controls **who can access and execute your serverless resources** in the cloud.

Each cloud provider uses:

* **Identities**: users, groups, or service accounts representing apps or services.

* **Roles/Policies**: collections of permissions assigned to identities.

* **Resource-level bindings**: assign specific permissions to specific resources.

### **GCP IAM**

In Google Cloud Platform (GCP), Cloud Functions and Cloud Run services automatically assume a Google-managed service account when deployed, usually known as **service agents**. This service account must be granted the necessary permissions to access other GCP resources within your project if necessary.

In addition, if your functions are not public, users, service accounts and service agents will need necessary permissions to invoke your function.

To manage these permissions, you can use the `gcloud` command-line tool or the GCP Console to assign appropriate roles to users, service accounts, or groups. This ensures that only authorized entities can invoke your serverless functions.

For more detailed information on IAM roles and permissions for Cloud Functions and Cloud Run, refer to the official GCP documentation:

* [Access control with IAM for Cloud Run/Functions](https://docs.cloud.google.com/functions/docs/concepts/iam)  
* [IAM roles and permissions for Cloud Functions](https://cloud.google.com/functions/docs/reference/iam/roles)   
* [IAM roles and permissions for Cloud Run](https://cloud.google.com/run/docs/reference/iam/roles)

    
  


---

### **AWS IAM**

In Amazon Web Services (AWS), Lambda functions require two types of IAM policies:

1. **Execution Role**: This IAM role grants the Lambda function permissions to access other AWS services and resources. For example, if your Lambda function needs to write logs to Amazon CloudWatch, the execution role must have the `AWSLambdaBasicExecutionRole` policy attached.

2. **Resource-Based Policy**: This policy grants other AWS services or accounts permission to invoke your Lambda function. For instance, if you want an Amazon S3 bucket to trigger your Lambda function, you would attach a resource-based policy to the Lambda function allowing `s3.amazonaws.com` to invoke it.

It's important to note that AWS Lambda functions do not automatically assume an IAM role. You must explicitly assign an execution role when creating or updating a Lambda function.

For more detailed information on defining Lambda function permissions with an execution role, refer to the official AWS documentation:

* [Defining Lambda function permissions with an execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html)

### **Key Points**

* **GCP:** Ensure that your **service accounts** and/or **service agents** (GCP) have the necessary IAM permissions.

* **AWS:** Ensure that your **execution roles** and/or **Resource-Based Policy** have the necessary IAM permissions.

* Grant only the **minimum required permissions** (Principle of Least Privilege).

* Ensure your function or service **is** **writing logs**, otherwise debugging will be difficult.

* Restrict who can **invoke the function**, rather than making it publicly accessible unless required.

---

**3\. Why Use an API Gateway**

Even though both GCP and AWS allow you to expose serverless functions over the internet directly (Cloud Run can be public, Lambda can be invoked via SDK), introducing an API Gateway **is considered best practice** when you need external API endpoint in your infrastructure:

### **Benefits**

1. **Centralized Endpoint Management**

   * API Gateway provides a single, stable endpoint for clients.

   * You can version, route, or throttle requests without touching the function.

2. **Authentication & Authorization**

   * Enforce identity checks (JWT, OAuth2, IAM, or service accounts).

   * Avoid exposing functions publicly with unauthenticated access.

3. **Rate Limiting & Throttling**

   * Protect your backend functions from spikes or abuse.

4. **Logging & Monitoring**

   * Track all incoming requests at a single point.

   * Integrates with cloud logging and monitoring services.

5. **Request Transformation & Routing**

   * Map endpoints, validate request payloads, transform headers or query parameters before invoking the function.

⚠️ On AWS, Lambda **does not expose an internet endpoint by default**; you need to attach an API Gateway or invoke via SDK/CLI.  
⚠️ On GCP, Cloud Run can be directly available on internet, but using an API Gateway is recommended to enforce authentication, quotas, and monitoring.

---

## **4\. Exercise: Deploy and Secure a “Hello World” Function**

### **Step 1: Setup**

* Ensure you have the correct CLI installed:  
  * **GCP:** `gcloud`  
  * **AWS:** `aws`  
* Authenticate and select your dev project/environment.

### **Step 2: Create the Function**

* Write a simple function (Node.js, Python, or Go).  
* Deploy it to **Cloud Functions** or **Lambda**.  
* Test that the function runs and responds.

### **Step 3: Secure It**

* Restrict public access (IAM).  
* Ensure only your user or service account can invoke it.

### **Step 4: Optional – Add an API Gateway**

Once the function is working:

1. Deploy an API Gateway (GCP or AWS).  
2. Connect it to your function.  
3. Configure minimal authentication (service account, IAM role, or API key).  
4. Test that you can call the function **through the gateway**:

`curl -H "Authorization: Bearer $(token)" \`  
  `https://<your-api-endpoint>`

---

## 

## **5\. Key Takeaways**

* Serverless functions (Cloud Functions, Cloud Run, AWS Lambda) run code on demand with **no server management**.

* IAM controls who can invoke or manage your resources; always prefer **service accounts or roles** over personal credentials.

* **API Gateways** are optional but strongly recommended: they centralize access, provide authentication, logging, monitoring, and protection.

* You can deploy a secure, scalable “Hello World” function in minutes, and optionally expose it via a gateway for best practices.

