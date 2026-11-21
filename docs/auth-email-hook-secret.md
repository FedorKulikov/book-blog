# Stable Supabase Send Email Hook secret

## Source of truth

Use one stable signing secret for all three places:

1. GitHub repository Actions secret: `AUTH_EMAIL_HOOK_SECRET`.
2. Supabase Auth → Hooks → Send Email: the signing secret configured for the HTTP hook.
3. Supabase Edge Function environment: `AUTH_EMAIL_HOOK_SECRET`.

The Edge deploy workflow copies the GitHub secret into the Edge Function environment. It must never generate a new random signing secret during deployment.

## Create and store it

The simplest approach is to generate the secret once in the Supabase Auth Hooks dashboard, then copy the exact value directly into the GitHub repository secret:

- GitHub → Settings → Secrets and variables → Actions → New repository secret.
- Name: `AUTH_EMAIL_HOOK_SECRET`.
- Value: the complete Supabase-generated value, including the `v1,whsec_` prefix.

Do not paste it into ChatGPT, commit it, put it in a workflow file, or print it in CI logs.

Expected format: `v1,whsec_<base64>`, where the Base64 payload decodes to 32 bytes.

## Deployment order

1. Generate the signing secret in Supabase Auth Hooks.
2. Save the same value as the GitHub Actions repository secret `AUTH_EMAIL_HOOK_SECRET`.
3. Merge this workflow change into `ops/supabase-edge-deploy` only after the GitHub secret exists. Its preflight check fails before any deployment operation if the secret is missing or malformed.
4. The workflow deploys the functions, writes the exact secret to Edge Function environment variables, and runs the signed/unsigned hook integration tests.
5. Only after the workflow passes, configure the Send Email Hook URI to:
   `https://tbqjyaxbymntdqzldrjz.supabase.co/functions/v1/auth-email-hook`
   and confirm that the Auth Hook signing secret still matches the GitHub secret.

## Important behavior before enabling the hook

The current `auth-email-hook` implementation is deliberately **not an email sender**:

- `recovery`: returns a neutral success without sending an email; password recovery is intended to use the site's recovery codes.
- `signup`: suppresses the confirmation email while Supabase Confirm Email is disabled.
- `*_notification`: suppresses email notifications.
- `magiclink`, `invite`, `email_change`, `reauthentication`: returns HTTP 501 because email delivery is not implemented.

Supabase documents that enabling Send Email Hook replaces the built-in email sending path; it is not a passive observer and does not fall back to SMTP when the hook is enabled. Keep the unsupported email flows disabled until a real provider and templates are implemented and tested.

## Rotation

Rotate the secret as a coordinated change: create a new value, update the GitHub repository secret and the Supabase Auth Hook signing secret, then run the Edge deploy workflow and verify its signature tests before relying on the hook. Never let a deployment create a new signing secret independently.
