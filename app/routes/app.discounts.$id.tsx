import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const discountRule = await prisma.discountRule.findFirst({
    where: {
      id: params.id,
      shop: session.shop,
    },
    include: { targets: true },
  });

  if (!discountRule) {
    throw new Response("Not found", { status: 404 });
  }

  return { discountRule };
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
  const targetType = formData.get("targetType") as string;
  const targetsJson = formData.get("targets") as string;
  const targets = targetsJson ? JSON.parse(targetsJson) : [];

  // Get existing rule
  const existingRule = await prisma.discountRule.findFirst({
    where: { id: params.id, shop: session.shop },
  });

  if (!existingRule) {
    return { success: false, error: "Discount rule not found" };
  }

  // Delete old targets and create new ones
  await prisma.discountRuleTarget.deleteMany({
    where: { ruleId: params.id },
  });

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
        create: targets.map((t: { id: string; title: string; type: string }) => ({
          targetType: t.type,
          targetId: t.id,
          targetTitle: t.title,
        })),
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
    targetType,
    targetIds: targets.map((t: { id: string }) => t.id),
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
  const { discountRule } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [name, setName] = useState(discountRule.name);
  const [minProducts, setMinProducts] = useState(String(discountRule.minProducts));
  const [maxDiscounted, setMaxDiscounted] = useState(
    discountRule.maxDiscounted ? String(discountRule.maxDiscounted) : ""
  );
  const [discountType, setDiscountType] = useState(discountRule.discountType);
  const [discountValue, setDiscountValue] = useState(String(discountRule.discountValue));
  const [targetType, setTargetType] = useState(
    discountRule.targets.length > 0 ? discountRule.targets[0].targetType : "all"
  );
  const [targets, setTargets] = useState<{ id: string; title: string; type: string }[]>(
    discountRule.targets.map((t) => ({
      id: t.targetId,
      title: t.targetTitle,
      type: t.targetType,
    }))
  );

  const isLoading = fetcher.state === "submitting";

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Discount rule updated successfully");
      navigate("/app/discounts");
    } else if (fetcher.data?.error) {
      shopify.toast.show("Error updating discount", { isError: true });
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

      <s-section heading="Threshold Settings">
        <s-stack gap="base">
          <s-number-field
            label="Minimum Products"
            value={minProducts}
            onChange={(event) => setMinProducts(String(event.currentTarget.value))}
            min={1}
          />
          <s-text tone="neutral">Number of products required before discount applies</s-text>

          <s-number-field
            label="Maximum Discounted Products"
            value={maxDiscounted}
            onChange={(event) => setMaxDiscounted(String(event.currentTarget.value))}
            min={1}
          />
          <s-text tone="neutral">Leave empty for unlimited</s-text>
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

      <s-section slot="aside" heading="Current Configuration">
        <s-paragraph>
          Minimum threshold: <s-text>{minProducts}</s-text> products
        </s-paragraph>
        <s-paragraph>
          Discount:{" "}
          <s-text>
            {discountType === "percentage" ? `${discountValue}%` : `$${discountValue}`}
          </s-text>
        </s-paragraph>
        {maxDiscounted && (
          <s-paragraph>
            Max discounted: <s-text>{maxDiscounted}</s-text> products
          </s-paragraph>
        )}
        <s-paragraph>
          Applies to:{" "}
          <s-text>
            {targetType === "all"
              ? "All products"
              : `${targets.length} ${targetType}(s)`}
          </s-text>
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
