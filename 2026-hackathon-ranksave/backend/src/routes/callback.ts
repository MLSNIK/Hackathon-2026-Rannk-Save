import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import type { WalletAddress } from '@interledger/open-payments';
import { db } from '../db';
import { transactions, paymentRequests, postUnlocks } from '../db/schema';
import { getClient, isFinalizedGrant } from '../lib/openPayments';
import { config } from '../config';

export const callbackRouter = Router();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Poll an outgoing payment until it has actually moved money (sentAmount > 0) or
// failed, so we know the bill drew from the balance before we attempt savings.
async function waitUntilSent(
  client: Awaited<ReturnType<typeof getClient>>,
  url: string,
  accessToken: string,
  attempts = 8,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const op = await client.outgoingPayment.get({ url, accessToken });
      const sent = BigInt(op.sentAmount?.value ?? '0');
      const debit = BigInt(op.debitAmount?.value ?? '0');
      if (op.failed || (sent > 0n && sent >= debit)) return;
    } catch {
      // transient — keep polling
    }
    await sleep(1200);
  }
}

// Mark an incoming payment complete so its received funds settle into the
// receiver's spendable balance. Needs a fresh (non-interactive) incoming-payment
// grant on the receiver's auth server — the same kind we use to create it.
async function completeIncomingPayment(
  client: Awaited<ReturnType<typeof getClient>>,
  walletUrl: string,
  incomingPaymentUrl: string,
): Promise<void> {
  try {
    const wallet = await client.walletAddress.get({ url: walletUrl });
    const grant = await client.grant.request(
      { url: wallet.authServer },
      { access_token: { access: [{ type: 'incoming-payment', actions: ['read', 'complete'] }] } },
    );
    if (isFinalizedGrant(grant)) {
      await client.incomingPayment.complete({ url: incomingPaymentUrl, accessToken: grant.access_token.value });
    }
  } catch (err) {
    console.error('[callback] Could not complete savings incoming payment:', err instanceof Error ? err.message : err);
  }
}

// Execute the pension top-up linked to a just-completed payment, reusing the
// same finalised grant. Best-effort: any failure (typically insufficient funds
// after the bill) marks the savings row FAILED and is otherwise swallowed.
async function runSavingsContribution(
  parentId: string,
  accessToken: string,
  sendingWallet: WalletAddress,
): Promise<void> {
  const [savingsTx] = await db
    .select()
    .from(transactions)
    .where(and(
      eq(transactions.parentTransactionId, parentId),
      eq(transactions.kind, 'SAVINGS'),
    ));

  // Only act on a savings row still waiting to be funded.
  if (!savingsTx || (savingsTx.status !== 'AWAITING_GRANT' && savingsTx.status !== 'PENDING')) return;

  try {
    const client = await getClient();

    // Make sure the bill has pulled its funds first, so priority is real.
    const [bill] = await db.select().from(transactions).where(eq(transactions.id, parentId));
    if (bill?.outgoingPaymentUrl) {
      await waitUntilSent(client, bill.outgoingPaymentUrl, accessToken);
    }

    const savingsPayment = await client.outgoingPayment.create(
      { url: sendingWallet.resourceServer, accessToken },
      {
        walletAddress: sendingWallet.id,
        quoteId:       savingsTx.quoteUrl!,
        metadata:      { description: 'RankSave pension auto-save' },
      },
    );

    // Wait for the transfer to actually deliver, then COMPLETE the incoming
    // payment. We create it open-ended (FIXED_SEND), and an open incoming payment
    // never auto-completes — so without this the funds reach the savings wallet
    // but stay "pending" and never show up in its spendable balance.
    await waitUntilSent(client, savingsPayment.id, accessToken);
    if (savingsTx.incomingPaymentUrl) {
      await completeIncomingPayment(client, savingsTx.receiverWalletAddress, savingsTx.incomingPaymentUrl);
    }

    await db
      .update(transactions)
      .set({
        status:             'COMPLETED',
        outgoingPaymentUrl: savingsPayment.id,
        updatedAt:          new Date(),
      })
      .where(eq(transactions.id, savingsTx.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[callback] Savings top-up skipped:', message);
    await db
      .update(transactions)
      .set({
        status:       'FAILED',
        errorMessage: 'Skipped this time — your payment came first (not enough left to save).',
        updatedAt:    new Date(),
      })
      .where(eq(transactions.id, savingsTx.id));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/callback
//
// GNAP redirect endpoint — the auth server redirects the user's browser here
// after they complete (or deny) consent.
//
// Query params supplied by the auth server:
//   interact_ref   — exchange token used to continue the grant
//   hash           — GNAP hash for verifying the callback (optional verification)
//
// Query param we added to the callback URL in /consent:
//   transactionId  — our DB row to update
//
// Steps:
//   1. Load the transaction and validate state
//   2. Continue the grant with interact_ref → receive access token
//   3. Create the outgoing payment
//   4. Mark the transaction COMPLETED and redirect the browser to the frontend
// ─────────────────────────────────────────────────────────────────────────────
callbackRouter.get('/', async (req, res) => {
  // On success the auth server sends `interact_ref`. On rejection it sends
  // `result=grant_rejected` (and no interact_ref) — that's the user clicking
  // "Decline" at their wallet's consent page.
  const { interact_ref, transactionId, result } = req.query as Record<string, string>;

  if (!transactionId) {
    return res.status(400).send('Missing transactionId in callback query');
  }

  const [tx] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.id, transactionId));

  if (!tx || tx.status !== 'AWAITING_GRANT') {
    return res.redirect(`${config.frontendUrl}?status=failed&id=${transactionId}&reason=invalid_state`);
  }

  // If this transaction unlocks a News post, send the reader back to that
  // article on return (on either outcome) instead of the generic status view.
  const [unlock] = await db
    .select({ postId: postUnlocks.postId })
    .from(postUnlocks)
    .where(and(eq(postUnlocks.transactionId, transactionId), eq(postUnlocks.status, 'PENDING')));
  const postSuffix = unlock ? `&post=${unlock.postId}` : '';

  // User declined consent (or the auth server returned no interact_ref): the
  // grant was rejected, so there's nothing to continue. Mark the payment failed
  // with a friendly reason and send them back to the app. Any linked ask/unlock
  // stays PENDING (handled like every other failure), so a retry is possible.
  if (!interact_ref || result === 'grant_rejected') {
    await db
      .update(transactions)
      .set({
        status:       'FAILED',
        errorMessage: result === 'grant_rejected'
          ? 'Payment declined — you cancelled the authorisation at your wallet.'
          : 'Authorisation did not complete. Please try the payment again.',
        updatedAt:    new Date(),
      })
      .where(eq(transactions.id, transactionId));

    return res.redirect(`${config.frontendUrl}?status=failed&id=${transactionId}${postSuffix}`);
  }

  try {
    const client = await getClient();

    // Continue the grant — exchanges interact_ref for an outgoing-payment access token
    const finalizedGrant = await client.grant.continue(
      {
        url:         tx.grantContinueUri!,
        accessToken: tx.grantContinueToken!,
      },
      { interact_ref }
    );

    if (!isFinalizedGrant(finalizedGrant)) {
      throw new Error('Grant continuation did not return an access token. Consent may have been denied or expired.');
    }

    // Resolve the sender's resource server URL to create the outgoing payment
    const sendingWallet = await client.walletAddress.get({ url: tx.senderWalletAddress });

    // Create the outgoing payment using the previously created quote
    const outgoingPayment = await client.outgoingPayment.create(
      {
        url:         sendingWallet.resourceServer,
        accessToken: finalizedGrant.access_token.value,
      },
      {
        walletAddress: sendingWallet.id,
        quoteId:       tx.quoteUrl!,       // quoteId = full quote URL from Step 5 of /quote
        metadata:      { description: 'RankSave payment' },
      }
    );

    await db
      .update(transactions)
      .set({
        status:             'COMPLETED',
        outgoingPaymentUrl: outgoingPayment.id,
        updatedAt:          new Date(),
      })
      .where(eq(transactions.id, transactionId));

    // ─── Pension auto-save (best-effort, AFTER the bill) ─────────────────────
    // A SAVINGS row linked to this payment shares the single grant we just
    // finalised. We deliberately run it second so the bill is never starved:
    // we wait for the bill to actually pull funds, then try the top-up. If the
    // wallet is now short, this one transfer fails and the bill stays paid.
    await runSavingsContribution(transactionId, finalizedGrant.access_token.value, sendingWallet);

    // If this payment fulfils a payment request, close the request too.
    // (On failure the request stays PENDING so the payer can retry.)
    await db
      .update(paymentRequests)
      .set({ status: 'COMPLETED', updatedAt: new Date() })
      .where(and(
        eq(paymentRequests.transactionId, transactionId),
        eq(paymentRequests.status, 'PENDING'),
      ));

    // If this payment unlocks a News post, grant access.
    await db
      .update(postUnlocks)
      .set({ status: 'COMPLETED', updatedAt: new Date() })
      .where(and(
        eq(postUnlocks.transactionId, transactionId),
        eq(postUnlocks.status, 'PENDING'),
      ));

    res.redirect(`${config.frontendUrl}?status=completed&id=${transactionId}${postSuffix}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[callback] Payment failed:', message);

    await db
      .update(transactions)
      .set({
        status:       'FAILED',
        errorMessage: message,
        updatedAt:    new Date(),
      })
      .where(eq(transactions.id, transactionId));

    res.redirect(`${config.frontendUrl}?status=failed&id=${transactionId}${postSuffix}`);
  }
});
