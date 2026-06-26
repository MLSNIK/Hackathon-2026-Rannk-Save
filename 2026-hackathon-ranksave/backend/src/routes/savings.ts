import { Router } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db';
import { transactions, users } from '../db/schema';
import { requireAuth } from '../middleware/requireAuth';

export const savingsRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/savings
//
// The pension dashboard payload: the user's auto-save settings, their lifetime
// total saved (sum of COMPLETED savings top-ups), and the contribution history.
// Each contribution is a transaction with kind=SAVINGS sent to the user's own
// savings wallet, created alongside a normal payment.
// ─────────────────────────────────────────────────────────────────────────────
savingsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const me = req.user!.id;

    const [user] = await db.select().from(users).where(eq(users.id, me));

    const contributions = await db
      .select({
        id:                  transactions.id,
        status:              transactions.status,
        debitAmount:         transactions.debitAmount,
        assetCode:           transactions.assetCode,
        assetScale:          transactions.assetScale,
        receiverWalletAddress: transactions.receiverWalletAddress,
        parentTransactionId: transactions.parentTransactionId,
        outgoingPaymentUrl:  transactions.outgoingPaymentUrl,
        errorMessage:        transactions.errorMessage,
        createdAt:           transactions.createdAt,
      })
      .from(transactions)
      .where(and(eq(transactions.userId, me), eq(transactions.kind, 'SAVINGS')))
      .orderBy(desc(transactions.createdAt))
      .limit(100)
      .all();

    // Lifetime total = sum of the contributions that actually landed.
    let total = 0n;
    for (const c of contributions) {
      if (c.status === 'COMPLETED' && c.debitAmount) total += BigInt(c.debitAmount);
    }

    // All contributions share the spending wallet's currency; fall back to null.
    const sample     = contributions[0];
    const assetCode  = sample?.assetCode  ?? null;
    const assetScale = sample?.assetScale ?? null;

    res.json({
      enabled:       Boolean(user?.savingsEnabled),
      percent:       user?.savingsPercent ?? 0,
      walletAddress: user?.savingsWalletAddress ?? null,
      totalSaved:    { value: total.toString(), assetCode, assetScale },
      contributions,
    });
  } catch (err) {
    next(err);
  }
});
