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
    requiredTargetType = "all",
    requiredTargetIds = [],
    discountedTargetType = "all",
    discountedTargetIds = [],
    // Legacy support
    targetType,
    targetIds,
  } = config;

  console.error("MIN PRODUCTS:", minProducts);
  console.error("DISCOUNT:", discountType, discountValue);
  console.error("REQUIRED TARGET TYPE:", requiredTargetType);
  console.error("DISCOUNTED TARGET TYPE:", discountedTargetType);

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
    // Handle legacy config (single targetType/targetIds)
    if (targetType && !requiredTargetType) {
      // Legacy mode - same products are both required and discounted
      if (targetType === "all") {
        isRequired = true;
      } else if (targetType === "product" && targetIds?.length > 0) {
        isRequired = targetIds.includes(productId);
      } else if (targetType === "collection" && targetIds?.length > 0) {
        isRequired = targetIds.includes(productId);
      }
    } else {
      // New mode - separate required and discounted products
      if (requiredTargetType === "all") {
        isRequired = true;
      } else if (requiredTargetType === "product" && requiredTargetIds.length > 0) {
        isRequired = requiredTargetIds.includes(productId);
      } else if (requiredTargetType === "collection" && requiredTargetIds.length > 0) {
        isRequired = requiredTargetIds.includes(productId);
      }
    }

    if (isRequired) {
      requiredProductCount += quantity;
    }

    // Check if product can be discounted
    let isDiscountable = false;
    // Handle legacy config
    if (targetType && !discountedTargetType) {
      // Legacy mode - same products are both required and discounted
      if (targetType === "all") {
        isDiscountable = true;
      } else if (targetType === "product" && targetIds?.length > 0) {
        isDiscountable = targetIds.includes(productId);
      } else if (targetType === "collection" && targetIds?.length > 0) {
        isDiscountable = targetIds.includes(productId);
      }
    } else {
      // New mode - separate required and discounted products
      if (discountedTargetType === "all") {
        isDiscountable = true;
      } else if (discountedTargetType === "product" && discountedTargetIds.length > 0) {
        isDiscountable = discountedTargetIds.includes(productId);
      } else if (discountedTargetType === "collection" && discountedTargetIds.length > 0) {
        isDiscountable = discountedTargetIds.includes(productId);
      }
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

  // Sort discountable items by price (cheapest first for discounting)
  discountableItems.sort((a, b) => a.price - b.price);

  // Calculate how many items get discounted
  const itemsToDiscount = maxDiscounted
    ? Math.min(discountableItems.length, maxDiscounted)
    : discountableItems.length;

  // Take the items to discount
  const discountedItems = discountableItems.slice(0, itemsToDiscount);

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
  const targets = Object.entries(lineQuantities).map(([lineId, data]) => ({
    cartLine: {
      id: data.cartLineId,
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
