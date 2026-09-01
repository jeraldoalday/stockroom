import { prisma } from "./prisma";
import { fetchLowStockPage, type LowStockRow } from "./dashboardStats";
import { emailSender } from "./email";
import { env } from "./env";

// Large enough to include every product any realistic customer (PRD §2:
// 1-5 staff, 1-3 locations) could have below its reorder point at once.
// fetchLowStockPage's own pagination exists for the dashboard UI's page
// size, not because this list needs to be capped — a digest that silently
// dropped the 5,001st low-stock item would be worse than one that's simply
// long.
const DIGEST_MAX_ITEMS = 5000;

export interface LowStockDigestResult {
  organizationsChecked: number;
  organizationsNotified: number;
  emailsSent: number;
}

export function formatLowStockDigestEmail(
  organizationName: string,
  items: LowStockRow[],
  dashboardUrl: string
): { subject: string; text: string } {
  const lines = items.map(
    (item) =>
      `- ${item.product.sku} ${item.product.name}: ${item.quantity} in stock (reorder point ${item.product.reorderPoint})`
  );
  const subject =
    items.length === 1
      ? `StockRoom: 1 item is low on stock — ${organizationName}`
      : `StockRoom: ${items.length} items are low on stock — ${organizationName}`;
  const text =
    `The following products are at or below their reorder point:\n\n${lines.join("\n")}\n\n` +
    `View the full list: ${dashboardUrl}`;
  return { subject, text };
}

/**
 * Emails every Owner in an organization — except one who has opted out on
 * their Account page — once it has at least one product at or below its
 * reorder point.
 *
 * PRD §3 goal 3 ("alert on low stock before it becomes a stockout") only
 * ever shipped as something an Owner has to think to go look at — the
 * dashboard's low-stock panel (F8). This is the push half. Meant to run
 * once a day from cron (see docs/DEPLOYMENT.md), the same way the
 * token-prune sweep does, rather than on a request or an in-process timer:
 * a per-tenant email digest has no business running inside the API's
 * request path, and "once a day" is what makes running this simple and
 * unconditional safe — nothing here tracks whether an item was already
 * reported, so invoking it twice in the same day means two emails, not a
 * bug to guard against.
 *
 * Sends nothing, silently, for an organization with no subscribed Owners —
 * whether because it has none at all, or every Owner has opted out. Neither
 * case is something a digest job should raise an alarm about.
 */
export async function sendLowStockDigest(): Promise<LowStockDigestResult> {
  const organizations = await prisma.organization.findMany({ select: { id: true, name: true } });

  let organizationsNotified = 0;
  let emailsSent = 0;

  for (const organization of organizations) {
    const { items } = await fetchLowStockPage(organization.id, 1, DIGEST_MAX_ITEMS);
    if (items.length === 0) continue;

    const owners = await prisma.user.findMany({
      where: { organizationId: organization.id, role: "OWNER", lowStockDigestOptOut: false },
      select: { email: true },
    });
    if (owners.length === 0) continue;

    const { subject, text } = formatLowStockDigestEmail(organization.name, items, `${env.corsOrigin}/dashboard`);
    for (const owner of owners) {
      await emailSender.send({ to: owner.email, subject, text });
      emailsSent += 1;
    }
    organizationsNotified += 1;
  }

  return { organizationsChecked: organizations.length, organizationsNotified, emailsSent };
}
