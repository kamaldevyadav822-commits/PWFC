# QuickLoan — Razorpay Only

Node.js + Express loan application website with Razorpay Checkout.

## Structure

- `public/` — responsive frontend
- `server/` — Express API and Razorpay integration
- `data/` — runtime JSON storage (local/dev only; see production note)

## Important

`PAYMENT_ENABLED=false` by default.

Before enabling live payments, replace the placeholder legal/policy content and
confirm the exact payment purpose, disclosures and refund/cancellation terms
for the business model.

## Run

    npm install
    npm start

Open:

    http://localhost:10000

## Environment variables

Copy `.env.example` to `.env`.

Required Razorpay values:

- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

Fixed payment:

- `PAYMENT_AMOUNT_PAISE=119900`
- `PAYMENT_CURRENCY=INR`

Never commit `.env` or Razorpay secrets.

## Render

Build:

    npm ci

Start:

    npm start

Set environment variables in Render.

## Production storage warning

The included JSON storage is intentionally simple and is NOT suitable as the
final persistent database for a horizontally scaled production service.
Replace it with a proper server-side database before high-volume production.

## Razorpay webhook

Configure:

    https://YOUR_DOMAIN/api/webhooks/razorpay

The server verifies the Razorpay webhook signature and deduplicates webhook IDs.

## Payment verification

The server:

1. Creates a Razorpay order for exactly ₹1,199.
2. Opens Razorpay Checkout in the browser.
3. Verifies the returned signature server-side.
4. Fetches the payment from Razorpay.
5. Checks order ID, amount and currency.
6. Stores the resulting payment state.

