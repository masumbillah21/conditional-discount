// @ts-check
import { DiscountApplicationStrategy } from "../generated/api";

/**
 * @typedef {import("../generated/api").RunInput} RunInput
 * @typedef {import("../generated/api").FunctionRunResult} FunctionRunResult
 */

/**
 * @type {FunctionRunResult}
 */
const EMPTY_DISCOUNT = {
  discountApplicationStrategy: DiscountApplicationStrategy.First,
  discounts: [],
};

/**
 * @param {RunInput} input
 * @returns {FunctionRunResult}
 */
export function run(input) {
  // Parse configuration from metafield
  const configValue = input?.discountNode?.metafield?.value;
  if (!configValue) {
    return EMPTY_DISCOUNT;
  }

  let config;
  try {
    config = JSON.parse(configValue);
  } catch {
    return EMPTY_DISCOUNT;
  }

  const {
    minProducts = 1,
    maxDiscounted = null,
    discountType = "percentage",
    discountValue = 0,
    targetType = "all",
    targetIds = [],
  } = config;

  // Get cart lines
  const cartLines = input?.cart?.lines || [];
  if (cartLines.length === 0) {
    return EMPTY_DISCOUNT;
  }

  // Collect eligible items
  const eligibleItems = [];

  for (const line of cartLines) {
    const merchandise = line.merchandise;
    if (merchandise?.__typename !== "ProductVariant") continue;

    const product = merchandise.product;
    const productId = product?.id;
    if (!productId) continue;

    // Check if product is eligible based on target type
    // Currently supports "all" and "product" targeting
    // Collection targeting requires additional GraphQL setup
    let isEligible = false;

    if (targetType === "all") {
      isEligible = true;
    } else if (targetType === "product") {
      isEligible = targetIds.includes(productId);
    }
    // Note: Collection targeting is not currently supported in the function
    // Products selected via collection in the UI are stored by product ID

    if (isEligible) {
      const price = parseFloat(line.cost?.amountPerQuantity?.amount || "0");
      const quantity = line.quantity || 0;

      // Add each unit as a separate item for sorting
      for (let i = 0; i < quantity; i++) {
        eligibleItems.push({
          cartLineId: line.id,
          price,
        });
      }
    }
  }

  const totalEligible = eligibleItems.length;

  // If we don't have enough products to meet threshold, no discount
  if (totalEligible <= minProducts) {
    return EMPTY_DISCOUNT;
  }

  // Sort by price ascending (cheapest first)
  eligibleItems.sort((a, b) => a.price - b.price);

  // Calculate how many items get discounted
  const itemsAfterThreshold = totalEligible - minProducts;
  const itemsToDiscount = maxDiscounted
    ? Math.min(itemsAfterThreshold, maxDiscounted)
    : itemsAfterThreshold;

  // Skip first minProducts items (threshold), take itemsToDiscount
  const discountedItems = eligibleItems.slice(minProducts, minProducts + itemsToDiscount);

  if (discountedItems.length === 0) {
    return EMPTY_DISCOUNT;
  }

  // Group discounted items by cart_line_id and count quantities
  const lineQuantities = {};
  for (const item of discountedItems) {
    lineQuantities[item.cartLineId] = (lineQuantities[item.cartLineId] || 0) + 1;
  }

  // Create discount targets
  const targets = Object.entries(lineQuantities).map(([lineId, qty]) => ({
    productVariant: {
      id: lineId,
      quantity: qty,
    },
  }));

  // Create the discount value
  const value = discountType === "percentage"
    ? { percentage: { value: String(discountValue) } }
    : { fixedAmount: { amount: String(discountValue) } };

  return {
    discountApplicationStrategy: DiscountApplicationStrategy.First,
    discounts: [
      {
        message: "Conditional Discount Applied",
        targets,
        value,
      },
    ],
  };
}
