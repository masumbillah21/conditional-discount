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
  console.error("CONFIG VALUE:", configValue);

  if (!configValue) {
    console.error("NO CONFIG FOUND");
    return EMPTY_DISCOUNT;
  }

  let config;
  try {
    config = JSON.parse(configValue);
    console.error("PARSED CONFIG:", JSON.stringify(config));
  } catch (e) {
    console.error("CONFIG PARSE ERROR:", e);
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

  console.error("MIN PRODUCTS:", minProducts);
  console.error("DISCOUNT:", discountType, discountValue);

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
    let isEligible = false;

    if (targetType === "all") {
      isEligible = true;
    } else if (targetType === "product" && targetIds.length > 0) {
      isEligible = targetIds.includes(productId);
    } else if (targetType === "collection" && targetIds.length > 0) {
      // For collection targeting, check if product is in the target collections
      // This requires the product's collection IDs to be available in the query
      isEligible = targetIds.includes(productId);
    }

    if (isEligible) {
      const price = parseFloat(line.cost?.amountPerQuantity?.amount || "0");
      const quantity = line.quantity || 0;
      const variantId = merchandise.id;

      // Add each unit as a separate item for sorting
      for (let i = 0; i < quantity; i++) {
        eligibleItems.push({
          cartLineId: line.id,
          variantId: variantId,
          price,
        });
      }
    }
  }

  const totalEligible = eligibleItems.length;
  console.error("TOTAL ELIGIBLE ITEMS:", totalEligible);
  console.error("ELIGIBLE ITEMS:", JSON.stringify(eligibleItems));

  // If we don't have enough products to exceed threshold, no discount
  // Need MORE than minProducts to get any discount
  if (totalEligible <= minProducts) {
    console.error("NOT ENOUGH ITEMS. Need >", minProducts, "have", totalEligible);
    return EMPTY_DISCOUNT;
  }

  // Sort by price DESCENDING (most expensive first)
  // We want to keep the most expensive items at full price
  eligibleItems.sort((a, b) => b.price - a.price);

  // Calculate how many items get discounted
  const itemsAfterThreshold = totalEligible - minProducts;
  const itemsToDiscount = maxDiscounted
    ? Math.min(itemsAfterThreshold, maxDiscounted)
    : itemsAfterThreshold;

  // Take the cheapest items (after skipping the most expensive minProducts items)
  const discountedItems = eligibleItems.slice(minProducts, minProducts + itemsToDiscount);

  console.error("ITEMS TO DISCOUNT:", itemsToDiscount);
  console.error("DISCOUNTED ITEMS:", JSON.stringify(discountedItems));

  if (discountedItems.length === 0) {
    console.error("NO ITEMS TO DISCOUNT");
    return EMPTY_DISCOUNT;
  }

  // Group discounted items by cart_line_id and count quantities
  const lineQuantities = {};
  for (const item of discountedItems) {
    const key = item.cartLineId;
    if (!lineQuantities[key]) {
      lineQuantities[key] = {
        variantId: item.variantId,
        quantity: 0
      };
    }
    lineQuantities[key].quantity += 1;
  }

  // Create discount targets
  const targets = Object.entries(lineQuantities).map(([lineId, data]) => ({
    productVariant: {
      id: data.variantId,
      quantity: data.quantity,
    },
  }));

  // Create the discount value
  const value = discountType === "percentage"
    ? { percentage: { value: String(discountValue) } }
    : { fixedAmount: { amount: String(discountValue) } };

  const result = {
    discountApplicationStrategy: DiscountApplicationStrategy.First,
    discounts: [
      {
        message: "Conditional Discount Applied",
        targets,
        value,
      },
    ],
  };

  console.error("FINAL RESULT:", JSON.stringify(result));

  return result;
}
