# Trade Your Future

Buy and trade your future. A swipe-first marketplace for real-world plans: concert tickets, restaurant tables, hotel nights, classes, flights. Right to claim it, left to let it go. Money is held in an onchain escrow until both sides are covered.

## Demo

The app ships with a demo mode that seeds a full marketplace: 60+ listings across four cities, a demo shopper with a calendar, and sellers who respond on their own. Pick "Try the demo" on the landing screen.

## Architecture

```
Next.js App Router (mobile-first UI)
        |
        v
Route Handlers (/app/api/*)  ->  Drizzle ORM
        |                          |
        |                          +-> Postgres (Neon in production)
        |                          +-> in-process Postgres when DATABASE_URL is unset
        |
        +-> Google Calendar API (read-only, optional)
        +-> Solana devnet: SPL token escrow + Memo receipts
```

Orders move through a small state machine (`created -> funded -> handed_over -> released`, with `refunded`, `disputed` and `failed` branches). Every transition is a compare-and-swap on the order row, writes an audit event, and posts a Memo transaction.

## Solana

- Escrow holds a devnet SPL token (6 decimals) while an order is open.
- Buyers pay into escrow, sellers are paid out of escrow minus a 10% fee on confirmation.
- The platform wallet pays all network fees, so shoppers never hold SOL or see a wallet.
- Program IDs: SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`, Associated Token Account `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`, Memo `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`.

## Setup

```
pnpm install
cp .env.example .env
pnpm db:push        # only when DATABASE_URL points at a Postgres instance
pnpm dev
```

With no environment variables at all the app runs on an in-process Postgres, demo mode on, and the chain simulated.

`pnpm solana:setup` creates the escrow keypair, funds it from the devnet faucet, and mints the test token, printing `ESCROW_SECRET` and `MINT_ADDRESS` for `.env`.

## Tests

```
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm e2e            # Playwright, mobile viewport
```
