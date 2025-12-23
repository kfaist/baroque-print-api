# Baroque Print API

Automated print ordering with Stripe + Prodigi integration.

## Environment Variables (set in Railway)

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_... (get from Stripe dashboard after deploying)
PRODIGI_API_KEY=09c893fa-...
```

## Setup Stripe Webhook

After deploying, go to Stripe Dashboard → Webhooks → Add endpoint:
- URL: https://baroque-print-api-production.up.railway.app/webhook
- Events: checkout.session.completed

Copy the webhook signing secret to Railway env vars.
