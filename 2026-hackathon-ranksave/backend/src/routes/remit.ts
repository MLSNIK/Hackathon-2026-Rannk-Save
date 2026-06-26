import { Router } from 'express';
import crypto from 'node:crypto';
import { eq, ne, and, desc } from 'drizzle-orm';
import { isPendingGrant } from '@interledger/open-payments';
import { db } from '../db';
import { transactions, users } from '../db/schema';
import { getClient, normaliseWalletAddress } from '../lib/openPayments';
import { createQuoteTransaction } from '../lib/quoteFlow';
import { config } from '../config';
import { requireAuth } from '../middleware/requireAuth';

export const remitRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/remit/wallet-info?url=<wallet-address>
//
// Resolves a wallet address and returns its asset code and scale.
// Used by the frontend to display currency info before submitting a quote.
// ─────────────────────────────────────────────────────────────────────────────
remitRouter.get('/wallet-info', requireAuth, async (req, res, next) => {
  try {
    const url = ((req.query.url as string) ?? '').trim();
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    const client = await getClient();
    const wallet = await client.walletAddress.get({ url: normaliseWalletAddress(url) });

    res.json({ assetCode: wallet.assetCode, assetScale: wallet.assetScale });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/remit/quote
//
// Validates input, then runs the shared quote flow (lib/quoteFlow.ts):
//   resolve wallets → incoming-payment grant → incoming payment →
//   quote grant → quote → persist transaction (status=PENDING)
// ─────────────────────────────────────────────────────────────────────────────
remitRouter.post('/quote', requireAuth, async (req, res, next) => {
  try {
    const { senderWalletAddress, receiverWalletAddress, amount, paymentType } = req.body as {
      senderWalletAddress:   string;
      receiverWalletAddress: string;
      amount:      string;
      paymentType: 'FIXED_SEND' | 'FIXED_RECEIVE';
    };

    if (!senderWalletAddress || !receiverWalletAddress || !amount || !paymentType) {
      return res.status(400).json({ error: 'Missing required fields: senderWalletAddress, receiverWalletAddress, amount, paymentType' });
    }
    if (!['FIXED_SEND', 'FIXED_RECEIVE'].includes(paymentType)) {
      return res.status(400).json({ error: 'paymentType must be FIXED_SEND or FIXED_RECEIVE' });
    }

    const result = await createQuoteTransaction({
      senderWalletAddress,
      receiverWalletAddress,
      amount,
      paymentType,
      userId: req.user!.id,
    });

    // ─── Pension auto-save ──────────────────────────────────────────────────
    // If the user has savings enabled, charge an extra `savingsPercent` of what
    // they pay (on top of the bill) into their own savings wallet. This creates a
    // second PENDING transaction (kind=SAVINGS) linked to the bill; one consent
    // later funds both (see /consent), and the bill is always paid first (/callback).
    let savings: {
      transactionId: string;
      amount: { value: string; assetCode: string; assetScale: number };
    } | null = null;

    const [me] = await db.select().from(users).where(eq(users.id, req.user!.id));
    const percent = me?.savingsPercent ?? 0;

    if (me?.savingsEnabled && me.savingsWalletAddress && percent > 0) {
      // Savings rides on the actual debit (what the sender pays), in the sender's currency.
      const billDebit    = BigInt(result.quote.debitAmount.value);
      const savingsValue  = (billDebit * BigInt(percent)) / 100n;

      if (savingsValue > 0n) {
        try {
          const savingsResult = await createQuoteTransaction({
            senderWalletAddress,                       // same spending wallet
            receiverWalletAddress: me.savingsWalletAddress,
            amount:      savingsValue.toString(),
            paymentType: 'FIXED_SEND',
            userId:      req.user!.id,
            kind:        'SAVINGS',
            parentTransactionId: result.transactionId,
          });
          savings = {
            transactionId: savingsResult.transactionId,
            amount:        savingsResult.quote.debitAmount,
          };
        } catch (savErr) {
          // Never let a savings hiccup block the actual payment — just skip it.
          console.error('[remit/quote] Savings quote failed, continuing without it:', savErr);
        }
      }
    }

    res.json({ ...result, savings });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/remit/consent
//
// Requests an interactive outgoing-payment grant.
// The auth server returns an interact.redirect URL — the frontend must redirect
// the user's browser there to complete consent.
// ─────────────────────────────────────────────────────────────────────────────
remitRouter.post('/consent', requireAuth, async (req, res, next) => {
  try {
    const { transactionId } = req.body as { transactionId: string };
    if (!transactionId) {
      return res.status(400).json({ error: 'Missing transactionId' });
    }

    const [tx] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    // 404 for both missing and foreign transactions, so ids can't be probed
    if (!tx || tx.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    if (tx.status !== 'PENDING') return res.status(400).json({ error: `Transaction is ${tx.status}, expected PENDING` });

    // A pension top-up created alongside this payment (kind=SAVINGS). We fund both
    // under ONE interactive grant: the user consents once, to the combined total.
    const [savingsTx] = await db
      .select()
      .from(transactions)
      .where(and(
        eq(transactions.parentTransactionId, transactionId),
        eq(transactions.kind, 'SAVINGS'),
        eq(transactions.status, 'PENDING'),
      ));

    // Grant limit = bill + savings (same wallet, same currency, so we just add).
    const totalDebit = (
      BigInt(tx.debitAmount!) + (savingsTx ? BigInt(savingsTx.debitAmount!) : 0n)
    ).toString();

    const client        = await getClient();
    const sendingWallet = await client.walletAddress.get({ url: tx.senderWalletAddress });

    // The nonce is required by the GNAP spec for the interact.finish hash. We store it
    // with the continuation details; verifying the callback hash is left as an exercise.
    const nonce       = crypto.randomUUID();
    const callbackUrl = `${config.backendUrl}/api/callback?transactionId=${transactionId}`;

    const outgoingGrant = await client.grant.request(
      { url: sendingWallet.authServer },
      {
        access_token: {
          access: [
            {
              type:       'outgoing-payment',
              actions:    ['create', 'read'],
              identifier: sendingWallet.id,
              limits: {
                debitAmount: {
                  value:      totalDebit,
                  assetCode:  tx.assetCode,
                  assetScale: tx.assetScale,
                },
                // To enable recurring payments, add an ISO 8601 interval here:
                // interval: 'R/2024-01-01T00:00:00Z/P1M'
              },
            },
          ],
        },
        interact: {
          start: ['redirect'],
          finish: {
            method: 'redirect',
            uri:    callbackUrl,
            nonce,
          },
        },
      }
    );

    if (!isPendingGrant(outgoingGrant) || !outgoingGrant.interact?.redirect) {
      throw new Error('Expected interactive outgoing-payment grant with interact.redirect');
    }

    await db
      .update(transactions)
      .set({
        status:             'AWAITING_GRANT',
        grantContinueUri:   outgoingGrant.continue.uri,
        grantContinueToken: outgoingGrant.continue.access_token.value,
        grantInteractNonce: nonce,
        updatedAt:          new Date(),
      })
      .where(eq(transactions.id, transactionId));

    // Move the linked savings row in lock-step so it isn't re-quoted or shown as pending.
    if (savingsTx) {
      await db
        .update(transactions)
        .set({ status: 'AWAITING_GRANT', updatedAt: new Date() })
        .where(eq(transactions.id, savingsTx.id));
    }

    res.json({ interactUrl: outgoingGrant.interact.redirect });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/remit/status/:id
//
// Returns the current state of a transaction.
// Polled by the frontend status view every 2 s.
//
// Deliberately unauthenticated: the browser lands here straight from the wallet's
// consent redirect, and the random UUID acts as a capability. Because of that we
// only return display fields — never the GNAP continuation secrets.
// ─────────────────────────────────────────────────────────────────────────────
remitRouter.get('/status/:id', async (req, res, next) => {
  try {
    const [tx] = await db
      .select({
        id:                    transactions.id,
        status:                transactions.status,
        paymentType:           transactions.paymentType,
        senderWalletAddress:   transactions.senderWalletAddress,
        receiverWalletAddress: transactions.receiverWalletAddress,
        debitAmount:           transactions.debitAmount,
        receiveAmount:         transactions.receiveAmount,
        assetCode:             transactions.assetCode,
        assetScale:            transactions.assetScale,
        receiveAssetCode:      transactions.receiveAssetCode,
        receiveAssetScale:     transactions.receiveAssetScale,
        outgoingPaymentUrl:    transactions.outgoingPaymentUrl,
        quoteExpiresAt:        transactions.quoteExpiresAt,
        errorMessage:          transactions.errorMessage,
        createdAt:             transactions.createdAt,
        recipientName:         users.displayName,
        recipientId:           users.id,
      })
      .from(transactions)
      .leftJoin(users, eq(users.walletAddress, transactions.receiverWalletAddress))
      .where(eq(transactions.id, req.params.id));

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    // Attach the linked pension top-up (if any) so the status view can show its outcome.
    const [savingsTx] = await db
      .select({
        status:      transactions.status,
        debitAmount: transactions.debitAmount,
        assetCode:   transactions.assetCode,
        assetScale:  transactions.assetScale,
      })
      .from(transactions)
      .where(and(
        eq(transactions.parentTransactionId, tx.id),
        eq(transactions.kind, 'SAVINGS'),
      ));

    res.json({ ...tx, savings: savingsTx ?? null });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/remit/history
//
// Bi-directional: payments the user sent, plus payments other OpenRemit users
// sent to the user's wallet address. Each row carries a `direction` and the
// counterparty (the other side of the payment), so the frontend can render
// sent amounts in the sender's currency and received amounts in the receiver's.
// ─────────────────────────────────────────────────────────────────────────────
remitRouter.get('/history', requireAuth, async (req, res, next) => {
  try {
    const me = req.user!.id;

    const txFields = {
      id:                    transactions.id,
      status:                transactions.status,
      paymentType:           transactions.paymentType,
      senderWalletAddress:   transactions.senderWalletAddress,
      receiverWalletAddress: transactions.receiverWalletAddress,
      debitAmount:           transactions.debitAmount,
      receiveAmount:         transactions.receiveAmount,
      assetCode:             transactions.assetCode,
      assetScale:            transactions.assetScale,
      receiveAssetCode:      transactions.receiveAssetCode,
      receiveAssetScale:     transactions.receiveAssetScale,
      outgoingPaymentUrl:    transactions.outgoingPaymentUrl,
      quoteExpiresAt:        transactions.quoteExpiresAt,
      errorMessage:          transactions.errorMessage,
      createdAt:             transactions.createdAt,
      counterpartyName:      users.displayName,
      counterpartyId:        users.id,
    };

    // Payments I sent — counterparty is whoever owns the receiving wallet (if known)
    const sent = await db
      .select(txFields)
      .from(transactions)
      .leftJoin(users, eq(users.walletAddress, transactions.receiverWalletAddress))
      .where(eq(transactions.userId, me))
      .orderBy(desc(transactions.createdAt))
      .limit(20)
      .all();

    // Payments other users sent to my wallet address — counterparty is the sender
    const [meRow] = await db
      .select({ walletAddress: users.walletAddress })
      .from(users)
      .where(eq(users.id, me));

    const received = meRow?.walletAddress
      ? await db
          .select(txFields)
          .from(transactions)
          .leftJoin(users, eq(users.id, transactions.userId))
          .where(and(
            eq(transactions.receiverWalletAddress, meRow.walletAddress),
            ne(transactions.userId, me),
          ))
          .orderBy(desc(transactions.createdAt))
          .limit(20)
          .all()
      : [];

    const rows = [
      ...sent.map(r => ({ ...r, direction: 'sent' as const, counterpartyWallet: r.receiverWalletAddress })),
      ...received.map(r => ({ ...r, direction: 'received' as const, counterpartyWallet: r.senderWalletAddress })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 20);

    res.json(rows);
  } catch (err) {
    next(err);
  }
});
