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
    // New separate targeting
    requiredTargetType,
    requiredTargetIds = [],
    discountedTargetType,
    discountedTargetIds = [],
    // Legacy support
    targetType,
    targetIds,
  } = config;

  // Determine effective target types (handle legacy and new configs)
  const effectiveRequiredTargetType = requiredTargetType || targetType || "all";
  const effectiveRequiredTargetIds = requiredTargetIds.length > 0 ? requiredTargetIds : (targetIds || []);

  // For discounted products: if not specified, use the same as required products
  // This handles the common case of "buy 6 of X, get discount on X"
  const effectiveDiscountedTargetType = discountedTargetIds.length > 0
    ? (discountedTargetType || "product")
    : (discountedTargetType === "all" ? "all" : effectiveRequiredTargetType);
  const effectiveDiscountedTargetIds = discountedTargetIds.length > 0
    ? discountedTargetIds
    : effectiveRequiredTargetIds;

  console.error("MIN PRODUCTS:", minProducts);
  console.error("DISCOUNT:", discountType, discountValue);
  console.error("EFFECTIVE REQUIRED TARGET TYPE:", effectiveRequiredTargetType);
  console.error("EFFECTIVE DISCOUNTED TARGET TYPE:", effectiveDiscountedTargetType);

  // Get cart lines
  const cartLines = input?.cart?.lines || [];
  if (cartLines.length === 0) {
    return EMPTY_DISCOUNT;
  }

  // Count required products in cart
  let requiredProductCount = 0;
  const discountableItems = [];

  for (const line of cartLines) {
    const merchandise = line.merchandise;
    if (merchandise?.__typename !== "ProductVariant") continue;

    const product = merchandise.product;
    const productId = product?.id;
    if (!productId) continue;

    const price = parseFloat(line.cost?.amountPerQuantity?.amount || "0");
    const quantity = line.quantity || 0;

    // Check if product counts toward the required quantity
    let isRequired = false;
    if (effectiveRequiredTargetType === "all") {
      isRequired = true;
    } else if (effectiveRequiredTargetType === "product" && effectiveRequiredTargetIds.length > 0) {
      isRequired = effectiveRequiredTargetIds.includes(productId);
    } else if (effectiveRequiredTargetType === "collection" && effectiveRequiredTargetIds.length > 0) {
      isRequired = effectiveRequiredTargetIds.includes(productId);
    }

    if (isRequired) {
      requiredProductCount += quantity;
    }

    // Check if product can be discounted
    let isDiscountable = false;
    if (effectiveDiscountedTargetType === "all") {
      isDiscountable = true;
    } else if (effectiveDiscountedTargetType === "product" && effectiveDiscountedTargetIds.length > 0) {
      isDiscountable = effectiveDiscountedTargetIds.includes(productId);
    } else if (effectiveDiscountedTargetType === "collection" && effectiveDiscountedTargetIds.length > 0) {
      isDiscountable = effectiveDiscountedTargetIds.includes(productId);
    }

    if (isDiscountable) {
      // Add each unit as a separate item for potential discounting
      for (let i = 0; i < quantity; i++) {
        discountableItems.push({
          cartLineId: line.id,
          productId: productId,
          price,
        });
      }
    }
  }

  console.error("REQUIRED PRODUCT COUNT:", requiredProductCount);
  console.error("DISCOUNTABLE ITEMS COUNT:", discountableItems.length);

  // Check if we have enough required products
  if (requiredProductCount < minProducts) {
    console.error("NOT ENOUGH REQUIRED PRODUCTS. Need:", minProducts, "have:", requiredProductCount);
    return EMPTY_DISCOUNT;
  }

  // If no discountable items, no discount
  if (discountableItems.length === 0) {
    console.error("NO DISCOUNTABLE ITEMS IN CART");
    return EMPTY_DISCOUNT;
  }

  // Calculate how many items get discounted
  // Only items ABOVE the minimum threshold get discounted
  // First minProducts items (cheapest) don't get discount, items after that do
  // e.g., if minProducts=6 and cart has 8 items, only 2 most expensive items get discounted
  const itemsAboveThreshold = discountableItems.length - minProducts;

  if (itemsAboveThreshold <= 0) {
    console.error("NO ITEMS ABOVE THRESHOLD. Need more than", minProducts, "items to get discount");
    return EMPTY_DISCOUNT;
  }

  const itemsToDiscount = maxDiscounted
    ? Math.min(itemsAboveThreshold, maxDiscounted)
    : itemsAboveThreshold;

  // Skip the first minProducts items (cheapest ones), discount the more expensive ones
  const discountedItems = discountableItems.slice(minProducts, minProducts + itemsToDiscount);

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
        cartLineId: item.cartLineId,
        quantity: 0
      };
    }
    lineQuantities[key].quantity += 1;
  }

  // Create discount targets using cartLine
  const targets = Object.values(lineQuantities).map((data) => ({
    cartLine: {
      id: data.cartLineId,
      quantity: data.quantity,
    },
  }));

  // Create the discount value
  // For percentage, Shopify expects a string like "10" for 10%
  const value = discountType === "percentage"
    ? { percentage: { value: String(discountValue) } }
    : { fixedAmount: { amount: String(discountValue) } };

  console.error("DISCOUNT VALUE:", JSON.stringify(value));
  console.error("TARGETS:", JSON.stringify(targets));

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
