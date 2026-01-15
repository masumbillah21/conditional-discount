import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

interface Target {
  id: string;
  title: string;
  type: string;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const idFromQuery = url.searchParams.get('id');

  let discountId = params.id;
  if (params.id?.startsWith(":") && idFromQuery) {
    discountId = idFromQuery;
  }

  if (discountId?.startsWith(":")) {
    const firstDiscount = await prisma.discountRule.findFirst({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
    });

    return {
      discountRule: null,
      isPlaceholder: true,
      redirectTo: firstDiscount ? `/app/discounts/${firstDiscount.id}` : "/app"
    };
  }

  const discountRule = await prisma.discountRule.findFirst({
    where: {
      OR: [
        { id: discountId, shop: session.shop },
        { shopifyDiscountId: discountId, shop: session.shop },
      ],
    },
    include: { targets: true },
  });

  if (!discountRule) {
    return {
      discountRule: null,
      isPlaceholder: false,
      redirectTo: "/app"
    };
  }

  return { discountRule, isPlaceholder: false, redirectTo: null };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

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

  // Get existing rule
  const existingRule = await prisma.discountRule.findFirst({
    where: { id: params.id, shop: session.shop },
  });

  if (!existingRule) {
    return { success: false, error: "Discount rule not found" };
  }

  // Delete old targets
  await prisma.discountRuleTarget.deleteMany({
    where: { ruleId: params.id },
  });

  // Create all targets with roles
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

  // Update the discount rule
  const discountRule = await prisma.discountRule.update({
    where: { id: params.id },
    data: {
      name,
      minProducts,
      maxDiscounted,
      discountType,
      discountValue,
      targets: {
        create: allTargets,
      },
    },
    include: { targets: true },
  });

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

  // Update Shopify discount if exists
  if (existingRule.shopifyDiscountId) {
    await admin.graphql(
      `#graphql
      mutation UpdateAutomaticDiscount($id: ID!, $discount: DiscountAutomaticAppInput!) {
        discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
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
          id: existingRule.shopifyDiscountId,
          discount: {
            title: name,
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
  }

  return { success: true, discountRule };
};

export default function EditDiscountPage() {
  const { discountRule, redirectTo } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  // Initialize all state hooks
  const [name, setName] = useState("");
  const [minProducts, setMinProducts] = useState("1");
  const [maxDiscounted, setMaxDiscounted] = useState("");
  const [discountType, setDiscountType] = useState("percentage");
  const [discountValue, setDiscountValue] = useState("0");

  // Required and discounted targets
  const [requiredTargetType, setRequiredTargetType] = useState("all");
  const [requiredTargets, setRequiredTargets] = useState<Target[]>([]);
  const [discountedTargetType, setDiscountedTargetType] = useState("all");
  const [discountedTargets, setDiscountedTargets] = useState<Target[]>([]);

  const isLoading = fetcher.state === "submitting";

  // Handle client-side redirect
  useEffect(() => {
    if (redirectTo) {
      navigate(redirectTo, { replace: true });
    }
  }, [redirectTo, navigate]);

  // Sync state with loader data when discountRule changes
  useEffect(() => {
    if (discountRule) {
      setName(discountRule.name || "");
      setMinProducts(String(discountRule.minProducts));
      setMaxDiscounted(discountRule.maxDiscounted ? String(discountRule.maxDiscounted) : "");
      setDiscountType(discountRule.discountType || "percentage");
      setDiscountValue(String(discountRule.discountValue));

      // Separate targets by role (cast to any to handle new field before Prisma regeneration)
      const targets = discountRule.targets as Array<{ id: string; targetType: string; targetId: string; targetTitle: string; role?: string }>;
      const required = targets?.filter((t) => t.role === "required") || [];
      const discounted = targets?.filter((t) => t.role === "discounted") || [];

      // For backward compatibility, if no role is set, treat all as required
      const legacyTargets = targets?.filter((t) => !t.role) || [];

      if (required.length > 0) {
        setRequiredTargetType(required[0].targetType);
        setRequiredTargets(
          required.map((t) => ({
            id: t.targetId,
            title: t.targetTitle,
            type: t.targetType,
          }))
        );
      } else if (legacyTargets.length > 0) {
        // Backward compatibility
        setRequiredTargetType(legacyTargets[0].targetType);
        setRequiredTargets(
          legacyTargets.map((t) => ({
            id: t.targetId,
            title: t.targetTitle,
            type: t.targetType,
          }))
        );
      } else {
        setRequiredTargetType("all");
        setRequiredTargets([]);
      }

      if (discounted.length > 0) {
        setDiscountedTargetType(discounted[0].targetType);
        setDiscountedTargets(
          discounted.map((t) => ({
            id: t.targetId,
            title: t.targetTitle,
            type: t.targetType,
          }))
        );
      } else {
        setDiscountedTargetType("all");
        setDiscountedTargets([]);
      }
    }
  }, [discountRule]);

  // Handle form submission result
  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Discount rule updated successfully");
      navigate("/app");
    } else if (fetcher.data?.error) {
      shopify.toast.show("Error updating discount", { isError: true });
    }
  }, [fetcher.data, shopify, navigate]);

  // If no discount rule, show loading while redirecting
  if (!discountRule) {
    return (
      <s-page heading="Loading...">
        <s-section>
          <s-text>Redirecting...</s-text>
        </s-section>
      </s-page>
    );
  }

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

    fetcher.submit(formData, { method: "POST" });
  };

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
    <s-page heading="Edit Discount Rule">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={handleSubmit}
        {...(isLoading ? { loading: true } : {})}
        {...(!name || !discountValue ? { disabled: true } : {})}
      >
        Save Changes
      </s-button>

      <s-section heading="Basic Information">
        <s-stack gap="base">
          <s-text-field
            label="Discount Name"
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="e.g., Buy 6 Get 20% Off"
          />

          <s-stack direction="inline" gap="base">
            <s-text>Status:</s-text>
            <s-text tone={discountRule.status === "active" ? "success" : "neutral"}>
              {discountRule.status === "active" ? "Active" : "Inactive"}
            </s-text>
          </s-stack>
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
