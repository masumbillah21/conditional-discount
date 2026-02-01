import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // authenticate.webhook verifies the HMAC signature automatically
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // GDPR: Customer requests deletion of their data
  // This app does not store customer-specific data, only discount rules
  // If you store customer data, delete it here

  const customer = payload?.customer;
  if (customer) {
    console.log(`Customer redact request for customer ID: ${customer.id}`);
  }

  // Return 200 to acknowledge receipt
  return new Response();
};
