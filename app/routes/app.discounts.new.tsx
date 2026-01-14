import { useState, useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction } from "react-router";
import { useNavigate, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  // Get the function ID dynamically if not set in env
  let functionId = process.env.SHOPIFY_CONDITIONAL_DISCOUNT_FUNCTION_ID;

  if (!functionId) {
    // Query for the function by its handle
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
    console.log("Functions query response:", JSON.stringify(functionsJson, null, 2));

    const functions = functionsJson.data?.shopifyFunctions?.nodes || [];

    // Find our conditional discount function
    const discountFunction = functions.find(
      (f: any) => f.apiType === "product_discount" && f.appKey === "conditional-discount-function"
    );

    if (discountFunction) {
      functionId = discountFunction.id;
      console.log("Found function ID:", functionId);
    } else {
      console.error("Available functions:", JSON.stringify(functions, null, 2));
      console.error("Looking for apiType: product_discount and appKey: conditional-discount-function");

      const errorDetails = functions.length === 0
        ? "No functions found. The extension may not be deployed or activated yet."
        : `Found ${functions.length} function(s) but none match. Available: ${functions.map((f: any) => `${f.appKey} (${f.apiType})`).join(", ")}`;

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
  const targetType = formData.get("targetType") as string;
  const targetsJson = formData.get("targets") as string;
  const targets = targetsJson ? JSON.parse(targetsJson) : [];

  // Prepare metafield configuration for the function
  const functionConfiguration = {
    minProducts,
    maxDiscounted,
    discountType,
    discountValue,
    targetType,
    targetIds: targets.map((t: { id: string }) => t.id),
  };

  // Create Shopify automatic discount with the function FIRST
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

  // Log the full response for debugging
  console.log("Shopify API Response:", JSON.stringify(responseJson, null, 2));

  const userErrors = responseJson.data?.discountAutomaticAppCreate?.userErrors;

  // Check for errors BEFORE creating database record
  if (userErrors && userErrors.length > 0) {
    console.error("Shopify API User Errors:", userErrors);
    return { success: false, errors: userErrors };
  }

  const shopifyDiscountId =
    responseJson.data?.discountAutomaticAppCreate?.automaticAppDiscount?.discountId;

  if (!shopifyDiscountId) {
    console.error("No discount ID returned from Shopify");
    return { success: false, errors: [{ message: "Failed to create Shopify discount" }] };
  }

  // Only create the database record if Shopify discount was successful
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
        create: targets.map((t: { id: string; title: string; type: string }) => ({
          targetType: t.type,
          targetId: t.id,
          targetTitle: t.title,
        })),
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
  const [targetType, setTargetType] = useState("all");
  const [targets, setTargets] = useState<{ id: string; title: string; type: string }[]>([]);

  const isLoading = fetcher.state === "submitting";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Discount rule created successfully");
      navigate("/app");
    } else if (fetcher.data?.errors) {
      const errorMessages = fetcher.data.errors.map((e: any) => e.message).join(", ");
      console.error("Discount creation errors:", fetcher.data.errors);
      shopify.toast.show(`Error creating discount: ${errorMessages}`, { isError: true });
    }
  }, [fetcher.data, shopify, navigate]);

  const handleSelectProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: targets.filter((t) => t.type === "product").map((t) => ({ id: t.id })),
    });

    if (selected) {
      setTargets(
        selected.map((p: { id: string; title: string }) => ({
          id: p.id,
          title: p.title,
          type: "product",
        }))
      );
    }
  };

  const handleSelectCollections = async () => {
    const selected = await shopify.resourcePicker({
      type: "collection",
      multiple: true,
      selectionIds: targets.filter((t) => t.type === "collection").map((t) => ({ id: t.id })),
    });

    if (selected) {
      setTargets(
        selected.map((c: { id: string; title: string }) => ({
          id: c.id,
          title: c.title,
          type: "collection",
        }))
      );
    }
  };

  const removeTarget = (id: string) => {
    setTargets(targets.filter((t) => t.id !== id));
  };

  const handleSubmit = () => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("minProducts", minProducts);
    if (maxDiscounted) formData.append("maxDiscounted", maxDiscounted);
    formData.append("discountType", discountType);
    formData.append("discountValue", discountValue);
    formData.append("targetType", targetType);
    formData.append("targets", JSON.stringify(targets));

    fetcher.submit(formData, { method: "POST" });
  };

  return (
    <s-page heading="Create Discount Rule">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSubmit}
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

      <s-section heading="Threshold Settings">
        <s-stack gap="base">
          <s-number-field
            label="Minimum Products"
            value={minProducts}
            onChange={(event) => setMinProducts(String(event.currentTarget.value))}
            min={1}
          />
          <s-text tone="neutral">Number of products required before discount applies (e.g., 6 means 7th product onwards gets discount)</s-text>

          <s-number-field
            label="Maximum Discounted Products"
            value={maxDiscounted}
            onChange={(event) => setMaxDiscounted(String(event.currentTarget.value))}
            min={1}
          />
          <s-text tone="neutral">Leave empty for unlimited. Limits how many products after threshold get discounted.</s-text>
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

      <s-section heading="Applies To">
        <s-stack gap="base">
          <s-select
            label="Apply discount to"
            value={targetType}
            onChange={(event) => {
              setTargetType(event.currentTarget.value);
              if (event.currentTarget.value === "all") {
                setTargets([]);
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
                      <s-link
                        href={`shopify://admin/collections/${target.id.split("/").pop()}`}
                        target="_blank"
                      >
                        {target.title}
                      </s-link>
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
      </s-section>

      <s-section slot="aside" heading="Example">
        <s-paragraph>
          With a minimum of <s-text>{minProducts || "6"}</s-text> products:
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Products 1-{minProducts || "6"}: Full price</s-list-item>
          <s-list-item>
            Products {parseInt(minProducts || "6", 10) + 1}+:{" "}
            {discountType === "percentage"
              ? `${discountValue || "10"}% off`
              : `$${discountValue || "10"} off`}
          </s-list-item>
          {maxDiscounted && (
            <s-list-item>Maximum {maxDiscounted} products discounted</s-list-item>
          )}
        </s-unordered-list>
        <s-paragraph>
          <s-text tone="neutral">Cheapest qualifying products are discounted first.</s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
