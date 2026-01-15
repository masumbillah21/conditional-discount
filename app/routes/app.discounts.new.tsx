import { useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction } from "react-router";
import { useNavigate, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

interface Target {
  id: string;
  title: string;
  type: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  // Get the function ID dynamically if not set in env
  let functionId = process.env.SHOPIFY_CONDITIONAL_DISCOUNT_FUNCTION_ID;

  if (!functionId) {
    const functionsResponse = await admin.graphql(
      `#graphql
      query {
        shopifyFunctions(first: 25) {
          nodes {
            id
            apiType
            title
            appKey
          }
        }
      }`
    );

    const functionsJson = await functionsResponse.json();
    const functions = functionsJson.data?.shopifyFunctions?.nodes || [];
    const discountFunction = functions.find(
      (f: any) => f.apiType === "product_discounts"
    );

    if (discountFunction) {
      functionId = discountFunction.id;
    } else {
      const errorDetails = functions.length === 0
        ? "No functions found. The extension may not be deployed or activated yet."
        : `Found ${functions.length} function(s) but none match.`;
      return {
        success: false,
        errors: [{ message: `Discount function not found. ${errorDetails}` }]
      };
    }
  }

  const name = formData.get("name") as string;
  const minProducts = parseInt(formData.get("minProducts") as string, 10);
  const maxDiscounted = formData.get("maxDiscounted")
    ? parseInt(formData.get("maxDiscounted") as string, 10)
    : null;
  const discountType = formData.get("discountType") as string;
  const discountValue = parseFloat(formData.get("discountValue") as string);

  // Get required and discounted targets separately
  const requiredTargetType = formData.get("requiredTargetType") as string;
  const requiredTargetsJson = formData.get("requiredTargets") as string;
  const requiredTargets = requiredTargetsJson ? JSON.parse(requiredTargetsJson) : [];

  const discountedTargetType = formData.get("discountedTargetType") as string;
  const discountedTargetsJson = formData.get("discountedTargets") as string;
  const discountedTargets = discountedTargetsJson ? JSON.parse(discountedTargetsJson) : [];

  // Prepare metafield configuration for the function
  const functionConfiguration = {
    minProducts,
    maxDiscounted,
    discountType,
    discountValue,
    requiredTargetType,
    requiredTargetIds: requiredTargets.map((t: Target) => t.id),
    discountedTargetType,
    discountedTargetIds: discountedTargets.map((t: Target) => t.id),
  };

  // Create Shopify automatic discount with the function
  const response = await admin.graphql(
    `#graphql
    mutation CreateAutomaticDiscount($discount: DiscountAutomaticAppInput!) {
      discountAutomaticAppCreate(automaticAppDiscount: $discount) {
        automaticAppDiscount {
          discountId
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        discount: {
          title: name,
          functionId: functionId,
          startsAt: new Date().toISOString(),
          metafields: [
            {
              namespace: "$app:conditional-discount-function",
              key: "function-configuration",
              type: "json",
              value: JSON.stringify(functionConfiguration),
            },
          ],
        },
      },
    }
  );

  const responseJson = await response.json();
  console.log("Create discount response:", JSON.stringify(responseJson, null, 2));

  const userErrors = responseJson.data?.discountAutomaticAppCreate?.userErrors;

  if (userErrors && userErrors.length > 0) {
    console.error("Shopify userErrors:", userErrors);
    return { success: false, errors: userErrors };
  }

  const shopifyDiscountId =
    responseJson.data?.discountAutomaticAppCreate?.automaticAppDiscount?.discountId;

  if (!shopifyDiscountId) {
    console.error("No shopifyDiscountId in response:", responseJson);
    return { success: false, errors: [{ message: "Failed to create Shopify discount" }] };
  }

  // Create database record with both required and discounted targets
  const allTargets = [
    ...requiredTargets.map((t: Target) => ({
      targetType: t.type,
      targetId: t.id,
      targetTitle: t.title,
      role: "required",
    })),
    ...discountedTargets.map((t: Target) => ({
      targetType: t.type,
      targetId: t.id,
      targetTitle: t.title,
      role: "discounted",
    })),
  ];

  const discountRule = await prisma.discountRule.create({
    data: {
      shop: session.shop,
      name,
      minProducts,
      maxDiscounted,
      discountType,
      discountValue,
      status: "active",
      shopifyDiscountId,
      targets: {
        create: allTargets,
      },
    },
    include: { targets: true },
  });

  return { success: true, discountRule };
};

export default function NewDiscountPage() {
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [name, setName] = useState("");
  const [minProducts, setMinProducts] = useState("6");
  const [maxDiscounted, setMaxDiscounted] = useState("");
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState("10");

  // Required products (products that must be in cart to trigger discount)
  const [requiredTargetType, setRequiredTargetType] = useState("all");
  const [requiredTargets, setRequiredTargets] = useState<Target[]>([]);

  // Discounted products (products that will receive the discount)
  const [discountedTargetType, setDiscountedTargetType] = useState("all");
  const [discountedTargets, setDiscountedTargets] = useState<Target[]>([]);

  const isLoading = fetcher.state === "submitting";
  const [hasSubmitted, setHasSubmitted] = useState(false);

  // Handle form submission result - only respond to new submissions
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && hasSubmitted) {
      if (fetcher.data.success) {
        shopify.toast.show("Discount rule created successfully");
        navigate("/app");
      } else if (fetcher.data.errors) {
        const errorMessages = fetcher.data.errors.map((e: any) => e.message).join(", ");
        shopify.toast.show(`Error: ${errorMessages}`, { isError: true });
      }
      setHasSubmitted(false);
    }
  }, [fetcher.state, fetcher.data, hasSubmitted, shopify, navigate]);

  // Handlers for required products
  const handleSelectRequiredProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: requiredTargets.filter((t) => t.type === "product").map((t) => ({ id: t.id })),
    });
    if (selected) {
      setRequiredTargets(
        selected.map((p: { id: string; title: string }) => ({
          id: p.id,
          title: p.title,
          type: "product",
        }))
      );
    }
  };

  const handleSelectRequiredCollections = async () => {
    const selected = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: requiredTargets.filter((t) => t.type === "collection").map((t) => ({ id: t.id })),
    });
    if (selected) {
      setRequiredTargets(
        selected.map((c: { id: string; title: string }) => ({
          id: c.id,
          title: c.title,
          type: "collection",
        }))
      );
    }
  };

  const removeRequiredTarget = (id: string) => {
    setRequiredTargets(requiredTargets.filter((t) => t.id !== id));
  };

  // Handlers for discounted products
  const handleSelectDiscountedProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: discountedTargets.filter((t) => t.type === "product").map((t) => ({ id: t.id })),
    });
    if (selected) {
      setDiscountedTargets(
        selected.map((p: { id: string; title: string }) => ({
          id: p.id,
          title: p.title,
          type: "product",
        }))
      );
    }
  };

  const handleSelectDiscountedCollections = async () => {
    const selected = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: discountedTargets.filter((t) => t.type === "collection").map((t) => ({ id: t.id })),
    });
    if (selected) {
      setDiscountedTargets(
        selected.map((c: { id: string; title: string }) => ({
          id: c.id,
          title: c.title,
          type: "collection",
        }))
      );
    }
  };

  const removeDiscountedTarget = (id: string) => {
    setDiscountedTargets(discountedTargets.filter((t) => t.id !== id));
  };

  const handleSubmit = () => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("minProducts", minProducts);
    if (maxDiscounted) formData.append("maxDiscounted", maxDiscounted);
    formData.append("discountType", discountType);
    formData.append("discountValue", discountValue);
    formData.append("requiredTargetType", requiredTargetType);
    formData.append("requiredTargets", JSON.stringify(requiredTargets));
    formData.append("discountedTargetType", discountedTargetType);
    formData.append("discountedTargets", JSON.stringify(discountedTargets));

    setHasSubmitted(true);
    fetcher.submit(formData, { method: "POST" });
  };

  // Attach click handler to the submit button after mount
  useEffect(() => {
    const button = document.getElementById("create-discount-btn");
    if (button) {
      const handler = () => {
        if (!isLoading && name && discountValue) {
          handleSubmit();
        }
      };
      button.addEventListener("click", handler);
      return () => button.removeEventListener("click", handler);
    }
  });

  const renderTargetSelector = (
    role: "required" | "discounted",
    targetType: string,
    setTargetType: (value: string) => void,
    targets: Target[],
    handleSelectProducts: () => void,
    handleSelectCollections: () => void,
    removeTarget: (id: string) => void
  ) => (
    <s-stack gap="base">
      <s-select
        label={role === "required" ? "Required products type" : "Discounted products type"}
        value={targetType}
        onChange={(event) => {
          setTargetType(event.currentTarget.value);
          if (event.currentTarget.value === "all") {
            if (role === "required") {
              setRequiredTargets([]);
            } else {
              setDiscountedTargets([]);
            }
          }
        }}
      >
        <s-option value="all">All Products</s-option>
        <s-option value="product">Specific Products</s-option>
        <s-option value="collection">Specific Collections</s-option>
      </s-select>

      {targetType === "product" && (
        <s-stack gap="base">
          <s-button onClick={handleSelectProducts}>Select Products</s-button>
          {targets.length > 0 && (
            <s-stack gap="base">
              {targets.map((target) => (
                <s-stack
                  key={target.id}
                  direction="inline"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-text>{target.title}</s-text>
                  <s-button variant="tertiary" onClick={() => removeTarget(target.id)}>
                    <s-icon type="x-circle" />
                  </s-button>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-stack>
      )}

      {targetType === "collection" && (
        <s-stack gap="base">
          <s-button onClick={handleSelectCollections}>Select Collections</s-button>
          {targets.length > 0 && (
            <s-stack gap="base">
              {targets.map((target) => (
                <s-stack
                  key={target.id}
                  direction="inline"
                  alignItems="center"
                  justifyContent="space-between"
                >
                  <s-text>{target.title}</s-text>
                  <s-button variant="tertiary" onClick={() => removeTarget(target.id)}>
                    <s-icon type="x-circle" />
                  </s-button>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-stack>
      )}
    </s-stack>
  );

  return (
    <s-page heading="Create Discount Rule">
      <s-button
        id="create-discount-btn"
        slot="primary-action"
        variant="primary"
        {...(isLoading ? { loading: true } : {})}
        {...(!name || !discountValue ? { disabled: true } : {})}
      >
        Create Discount
      </s-button>

      <s-section heading="Basic Information">
        <s-stack gap="base">
          <s-text-field
            label="Discount Name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="e.g., Buy 6 Get 20% Off"
          />
        </s-stack>
      </s-section>

      <s-section heading="Required Products (Trigger Condition)">
        <s-stack gap="base">
          <s-text tone="neutral">
            Select which products must be in the cart to trigger the discount.
            Customers need to add the minimum quantity of these products.
          </s-text>

          <s-number-field
            label="Minimum Quantity Required"
            value={minProducts}
            onChange={(event) => setMinProducts(String(event.currentTarget.value))}
            min={1}
          />
          <s-text tone="neutral">
            Number of required products needed in cart before discount applies
          </s-text>

          {renderTargetSelector(
            "required",
            requiredTargetType,
            setRequiredTargetType,
            requiredTargets,
            handleSelectRequiredProducts,
            handleSelectRequiredCollections,
            removeRequiredTarget
          )}
        </s-stack>
      </s-section>

      <s-section heading="Discounted Products (What Gets Discounted)">
        <s-stack gap="base">
          <s-text tone="neutral">
            Select which products will receive the discount once the condition is met.
          </s-text>

          {renderTargetSelector(
            "discounted",
            discountedTargetType,
            setDiscountedTargetType,
            discountedTargets,
            handleSelectDiscountedProducts,
            handleSelectDiscountedCollections,
            removeDiscountedTarget
          )}

          <s-number-field
            label="Maximum Products to Discount"
            value={maxDiscounted}
            onChange={(event) => setMaxDiscounted(String(event.currentTarget.value))}
            min={1}
          />
          <s-text tone="neutral">
            Leave empty for unlimited. Limits how many products get discounted.
          </s-text>
        </s-stack>
      </s-section>

      <s-section heading="Discount Value">
        <s-stack gap="base">
          <s-select
            label="Discount Type"
            value={discountType}
            onChange={(event) => setDiscountType(event.currentTarget.value)}
          >
            <s-option value="percentage">Percentage</s-option>
            <s-option value="fixed">Fixed Amount</s-option>
          </s-select>

          <s-number-field
            label={discountType === "percentage" ? "Discount Percentage" : "Discount Amount"}
            value={discountValue}
            onChange={(event) => setDiscountValue(String(event.currentTarget.value))}
            min={0}
            max={discountType === "percentage" ? 100 : undefined}
            suffix={discountType === "percentage" ? "%" : "$"}
          />
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="How It Works">
        <s-heading>Step 1: Required Products</s-heading>
        <s-paragraph>
          Customer adds {minProducts || "X"} items from the required products to their cart.
        </s-paragraph>

        <s-heading>Step 2: Discount Applied</s-heading>
        <s-paragraph>
          Products from the "discounted" selection get{" "}
          {discountType === "percentage"
            ? `${discountValue || "10"}% off`
            : `$${discountValue || "10"} off`}
          {maxDiscounted ? ` (up to ${maxDiscounted} items)` : ""}.
        </s-paragraph>

        <s-heading>Example:</s-heading>
        <s-paragraph>
          "Buy 6 T-shirts, get jeans 20% off" - Set T-shirts as required products (min 6),
          and Jeans as discounted products.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
