# WAN Web

## Fix "not found" after upload on Vercel

Serverless does not keep /tmp files. For stable pastes:

1. Vercel Dashboard → Project → Storage → Create **Blob**
2. Connect to project → copy `BLOB_READ_WRITE_TOKEN` into Project Env
3. Redeploy

Without Blob, paste may work briefly on same instance then 404.

## Deploy
Push to GitHub → Vercel import. No build command.
