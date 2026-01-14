import { useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const discountRules = await prisma.discountRule.findMany({
    where: { shop: session.shop },
    include: { targets: true },
    orderBy: { createdAt: "desc" },
  });

  return { discountRules };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");
  const id = formData.get("id") as string;

  if (action === "delete" && id) {
    // Get the discount rule to find Shopify discount ID
    const rule = await prisma.discountRule.findUnique({
      where: { id },
    });

    if (rule?.shopifyDiscountId) {
      // Delete the Shopify automatic discount
      await admin.graphql(
        `#graphql
        mutation DeleteDiscount($id: ID!) {
          discountAutomaticDelete(id: $id) {
            deletedAutomaticDiscountId
            userErrors {
              field
              message
            }
          }
        }`,
        { variables: { id: rule.shopifyDiscountId } }
      );
    }

    // Delete from database
    await prisma.discountRule.delete({
      where: { id },
    });

    return { success: true };
  }

  if (action === "toggle" && id) {
    const rule = await prisma.discountRule.findUnique({
      where: { id },
    });

    if (rule) {
      const newStatus = rule.status === "active" ? "inactive" : "active";

      // Update Shopify discount status if exists
      if (rule.shopifyDiscountId) {
        if (newStatus === "active") {
          await admin.graphql(
            `#graphql
            mutation ActivateDiscount($id: ID!) {
              discountAutomaticActivate(id: $id) {
                automaticDiscountNode {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            { variables: { id: rule.shopifyDiscountId } }
          );
        } else {
          await admin.graphql(
            `#graphql
            mutation DeactivateDiscount($id: ID!) {
              discountAutomaticDeactivate(id: $id) {
                automaticDiscountNode {
                  id
                }
                userErrors {
                  field
                  message
                }
              }
            }`,
            { variables: { id: rule.shopifyDiscountId } }
          );
        }
      }

      await prisma.discountRule.update({
        where: { id },
        data: { status: newStatus },
      });
    }

    return { success: true };
  }

  return { success: false };
};

export default function DiscountsPage() {
  const { discountRules } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.success) {
      shopify.toast.show("Action completed successfully");
    }
  }, [fetcher.data, shopify]);

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this discount rule?")) {
      fetcher.submit({ action: "delete", id }, { method: "POST" });
    }
  };

  const handleToggle = (id: string) => {
    fetcher.submit({ action: "toggle", id }, { method: "POST" });
  };

  return (
    <s-page heading="Conditional Discounts">
      <s-button slot="primary-action" onClick={() => navigate("/app/discounts/new")}>
        Create Discount Rule
      </s-button>

      {discountRules.length === 0 ? (
        <s-section>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-stack gap="base" alignItems="center">
              <s-heading>No discount rules yet</s-heading>
              <s-paragraph>
                Create your first conditional discount rule to offer discounts after customers add a
                certain number of products to their cart.
              </s-paragraph>
              <s-button variant="primary" onClick={() => navigate("/app/discounts/new")}>
                Create Discount Rule
              </s-button>
            </s-stack>
          </s-box>
        </s-section>
      ) : (
        <s-section>
          <s-stack gap="base">
            {discountRules.map((rule) => (
              <s-box
                key={rule.id}
                padding="base"
                borderWidth="base"
                borderRadius="base"
                background="subdued"
              >
                <s-stack gap="base">
                  <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                    <s-stack gap="base">
                      <s-heading>{rule.name}</s-heading>
                      <s-text tone={rule.status === "active" ? "success" : "neutral"}>
                        {rule.status === "active" ? "Active" : "Inactive"}
                      </s-text>
                    </s-stack>
                    <s-stack direction="inline" gap="base">
                      <s-button variant="tertiary" onClick={() => navigate(`/app/discounts/${rule.id}`)}>
                        Edit
                      </s-button>
                      <s-button variant="tertiary" onClick={() => handleToggle(rule.id)}>
                        {rule.status === "active" ? "Deactivate" : "Activate"}
                      </s-button>
                      <s-button variant="tertiary" tone="critical" onClick={() => handleDelete(rule.id)}>
                        Delete
                      </s-button>
                    </s-stack>
                  </s-stack>

                  <s-divider />

                  <s-stack direction="inline" gap="base">
                    <s-stack gap="base">
                      <s-text>Minimum Products</s-text>
                      <s-text>{rule.minProducts}</s-text>
                    </s-stack>
                    <s-stack gap="base">
                      <s-text>Max Discounted</s-text>
                      <s-text>{rule.maxDiscounted ?? "Unlimited"}</s-text>
                    </s-stack>
                    <s-stack gap="base">
                      <s-text>Discount</s-text>
                      <s-text>
                        {rule.discountType === "percentage"
                          ? `${rule.discountValue}%`
                          : `$${rule.discountValue}`}
                      </s-text>
                    </s-stack>
                    <s-stack gap="base">
                      <s-text>Targets</s-text>
                      <s-text>
                        {rule.targets.length === 0
                          ? "All Products"
                          : `${rule.targets.length} ${rule.targets[0]?.targetType}(s)`}
                      </s-text>
                    </s-stack>
                  </s-stack>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      )}

      <s-section slot="aside" heading="How it works">
        <s-paragraph>
          Conditional discounts apply after customers add a minimum number of qualifying products to
          their cart.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Set a minimum product threshold (e.g., 6 products)</s-list-item>
          <s-list-item>Products after the threshold get discounted</s-list-item>
          <s-list-item>Cheapest items are discounted first</s-list-item>
          <s-list-item>Optionally limit how many products get discounted</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
