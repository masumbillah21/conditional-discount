import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // authenticate.webhook verifies the HMAC signature automatically
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // GDPR: Shop requests deletion of all their data (48h after uninstall)
  // Delete all data associated with this shop

  // Delete all discount rules for this shop
  await db.discountRule.deleteMany({ where: { shop } });

  // Delete all sessions for this shop
  await db.session.deleteMany({ where: { shop } });

  console.log(`Deleted all data for shop: ${shop}`);

  // Return 200 to acknowledge receipt
  return new Response();
};
