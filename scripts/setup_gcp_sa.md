# Service Account Setup Script

## Instructions
1. Authenticate with gcloud: `gcloud auth login`
2. Run these commands for each environment (replace PROJECT_ID):

### 1. Create Service Account
```bash
export PROJECT_ID="serverless-felix-dev" # or serverless-felix-prd
export SA_NAME="github-actions-sa"

gcloud config set project $PROJECT_ID

gcloud iam service-accounts create $SA_NAME \
    --description="Service account for GitHub Actions deployment" \
    --display-name="GitHub Actions Deployer"
```

### 2. Grant Permissions
```bash
# Cloud Functions Admin (deploy functions)
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/cloudfunctions.developer"

# Service Account User (act as other service accounts)
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"

# Storage Admin (for deployment buckets)
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/storage.admin"

# Artifact Registry Writer (if using Gen 2 functions / containers)
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.writer"
```

### 3. Generate Key
```bash
gcloud iam service-accounts keys create ~/.gcloud/keyfile.json \
    --iam-account=$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com
```

### 4. Upload to GitHub
- Copy content of `~/.gcloud/keyfile.json`
- Go to GitHub Repo -> Settings -> Secrets -> Actions -> New Repository Secret
- Name: `GCP_SA_KEY`
- Value: (Paste content)
