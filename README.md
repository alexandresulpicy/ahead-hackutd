# Ahead

**Irregular income isn't the risk. Unpredictable income is. Ahead makes it predictable — for the customer and for the bank.**

Built solo for HackUTD 2026 (PNC 360° Financial Health Navigator · Capital One Best Use of Nessie).

- Customer app (installable on iPhone): https://ahead-hackutd.vercel.app
- Bank console: https://ahead-hackutd.vercel.app/bank.html
- Demo video: https://youtu.be/ICJuydFE7zM

## What it does

**For the customer:** "You're N days Ahead" and "Safe to spend today" on the home screen, one next action when a shortfall is forecast (**Prevent it** moves money from savings and records it in Nessie), a What-if slider for late client payments, a 360° view of accounts, loans and every bill for 45 days, Autopilot (tax jar and bills envelope), and a coach that answers with the transactions behind its answer.

**For the bank:** "Ahead for Banks" ranks customers by days before a projected shortfall, proposes the next action and shows the fees avoided.

**Live link:** the bank console delays a client payment → the phone reacts within 3 seconds → the customer taps Prevent it → the console shows the fee avoided. Both screens read and write the same Capital One Nessie data.

## How it's built

- Plain HTML, CSS and JavaScript, no framework, no build step. Canvas chart. PWA (manifest + service worker).
- `engine.js`: income model and 45-day forecast (cautious / expected / favorable).
- `app.js`: customer app. `bank.js` + `bank.html`: bank console.
- `api/nessie.js`: Vercel serverless proxy to the Nessie API with a strict allow-list (customers, accounts, deposits, purchases, bills, transfers, loans, merchants). The key never reaches the browser.
- `api/coach.js`: Claude Haiku 5.5 (Anthropic API) with structured JSON output. Numbers and purchase verdicts are computed in app code; the model only explains them. A rule-based coach answers if the API is unavailable.

## Run it

Set `NESSIE_API_KEY` and `ANTHROPIC_API_KEY` as environment variables and deploy to Vercel. `?skip` skips the intro animation.

## Note

Prototype with seeded Nessie data modeled on my real income pattern (not my real statements). No real money moves. Built with Claude Code as a coding assistant.
