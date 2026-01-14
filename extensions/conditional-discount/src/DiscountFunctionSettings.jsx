import { render } from "preact";
import { useState, useEffect, useMemo } from "preact/hooks";

export default async () => {
  const existingDefinition = await getMetafieldDefinition();
  if (!existingDefinition) {
    // Create a metafield definition for persistence if no pre-existing definition exists
    const metafieldDefinition = await createMetafieldDefinition();

    if (!metafieldDefinition) {
      throw new Error("Failed to create metafield definition");
    }
  }

  render(<App />, document.body);
};

function ThresholdField({ label, description, value, onChange, name }) {
  return (
    <s-box>
      <s-stack gap="base">
        <s-number-field
          label={label}
          name={name}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
          min="1"
        />
        <s-text appearance="subdued">{description}</s-text>
      </s-stack>
    </s-box>
  );
}

function DiscountTypeField({ discountType, discountValue, onTypeChange, onValueChange, i18n }) {
  return (
    <s-box>
      <s-stack gap="base">
        <s-select
          label={i18n.translate("discountType")}
          name="discountType"
          value={discountType}
          onChange={(event) => onTypeChange(event.currentTarget.value)}
        >
          <s-option value="percentage">{i18n.translate("percentage")}</s-option>
          <s-option value="fixedAmount">{i18n.translate("fixedAmount")}</s-option>
        </s-select>
        <s-number-field
          label={i18n.translate("discountValue")}
          name="discountValue"
          value={String(discountValue)}
          onChange={(event) => onValueChange(Number(event.currentTarget.value))}
          suffix={discountType === "percentage" ? "%" : "$"}
          min="0"
        />
      </s-stack>
    </s-box>
  );
}

function AppliesToProducts({
  onClickAdd,
  onClickRemove,
  value,
  defaultValue,
  i18n,
  appliesTo,
  onAppliesToChange,
}) {
  return (
    <s-section>
      <s-box display="none">
        <s-text-field
          value={value.map(({ id }) => id).join(",")}
          label=""
          name="productIds"
          defaultValue={defaultValue.map(({ id }) => id).join(",")}
        />
      </s-box>
      <s-stack gap="base">
        <s-stack direction="inline" alignItems="end" gap="base">
          <s-select
            label={i18n.translate("appliesTo.label")}
            name="appliesTo"
            value={appliesTo}
            onChange={(event) => onAppliesToChange(event.currentTarget.value)}
          >
            <s-option value="all">{i18n.translate("appliesTo.allProducts")}</s-option>
            <s-option value="selected">{i18n.translate("appliesTo.selectedItems")}</s-option>
          </s-select>

          {appliesTo === "all" ? null : (
            <s-box inlineSize="180px">
              <s-button onClick={onClickAdd}>
                {i18n.translate("appliesTo.buttonLabel")}
              </s-button>
            </s-box>
          )}
        </s-stack>
        <ProductsSection products={value} onClickRemove={onClickRemove} />
      </s-stack>
    </s-section>
  );
}

function ProductsSection({ products, onClickRemove }) {
  if (products.length === 0) {
    return null;
  }

  return products.map((product) => (
    <s-stack gap="base" key={product.id}>
      <s-stack direction="inline" alignItems="center" justifyContent="space-between">
        <s-link
          href={`shopify://admin/products/${product.id.split("/").pop()}`}
          target="_blank"
        >
          {product.title}
        </s-link>
        <s-button variant="tertiary" onClick={() => onClickRemove(product.id)}>
          <s-icon type="x-circle" />
        </s-button>
      </s-stack>
      <s-divider />
    </s-stack>
  ));
}

function App() {
  const {
    applyExtensionMetafieldChange,
    i18n,
    threshold,
    onThresholdChange,
    discountType,
    onDiscountTypeChange,
    discountValue,
    onDiscountValueChange,
    initialProducts,
    products,
    appliesTo,
    onAppliesToChange,
    removeProduct,
    onSelectedProducts,
    loading,
    resetForm,
  } = useExtensionData();

  if (loading) {
    return <s-text>{i18n.translate("loading")}</s-text>;
  }

  return (
    <s-function-settings onSubmit={(event) => event.waitUntil(applyExtensionMetafieldChange())} onReset={resetForm}>
      <s-heading>{i18n.translate("title")}</s-heading>
      <s-section>
        <s-stack gap="base">
          {/* Quantity Threshold */}
          <ThresholdField
            label={i18n.translate("threshold.label")}
            description={i18n.translate("threshold.description")}
            value={threshold}
            onChange={onThresholdChange}
            name="threshold"
          />

          {/* Discount Summary */}
          <s-box padding="base" background="fill-tertiary">
            <s-stack gap="base">
              <s-text weight="bold">
                {i18n.translate("summary.buy")} {threshold} {i18n.translate("summary.items")} → {i18n.translate("summary.getDiscount")}
              </s-text>
            </s-stack>
          </s-box>

          <s-divider />

          {/* Discount Type and Value */}
          <DiscountTypeField
            discountType={discountType}
            discountValue={discountValue}
            onTypeChange={onDiscountTypeChange}
            onValueChange={onDiscountValueChange}
            i18n={i18n}
          />

          <s-divider />

          {/* Applies To */}
          <AppliesToProducts
            onClickAdd={onSelectedProducts}
            onClickRemove={removeProduct}
            value={products}
            defaultValue={initialProducts}
            i18n={i18n}
            appliesTo={appliesTo}
            onAppliesToChange={onAppliesToChange}
          />
        </s-stack>
      </s-section>
    </s-function-settings>
  );
}

function useExtensionData() {
  const { applyMetafieldChange, i18n, data, resourcePicker, query } = shopify;

  const metafieldConfig = useMemo(() =>
    parseMetafield(
      data?.metafields?.find(
        (metafield) => metafield.key === "function-configuration"
      )?.value
    ),
    [data?.metafields]
  );
  
  const [threshold, setThreshold] = useState(metafieldConfig.threshold);
  const [discountType, setDiscountType] = useState(metafieldConfig.discountType);
  const [discountValue, setDiscountValue] = useState(metafieldConfig.discountValue);
  const [initialProducts, setInitialProducts] = useState([]);
  const [products, setProducts] = useState([]);
  const [appliesTo, setAppliesTo] = useState("all");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      setLoading(true);
      const selectedProducts = await getProducts(
        metafieldConfig.productIds,
        query
      );
      setInitialProducts(selectedProducts);
      setProducts(selectedProducts);
      setLoading(false);
      setAppliesTo(selectedProducts.length > 0 ? "selected" : "all");
    };
    fetchProducts();
  }, [metafieldConfig.productIds, query]);

  const onThresholdChange = (value) => {
    setThreshold(Math.max(1, value));
  };

  const onDiscountTypeChange = (value) => {
    setDiscountType(value);
  };

  const onDiscountValueChange = (value) => {
    setDiscountValue(Math.max(0, value));
  };

  const onAppliesToChange = (value) => {
    setAppliesTo(value);
    if (value === "all") {
      setProducts([]);
    }
  };

  async function applyExtensionMetafieldChange() {
    await applyMetafieldChange({
      type: "updateMetafield",
      namespace: "$app:conditional-discount--ui-extension",
      key: "function-configuration",
      value: JSON.stringify({
        minProducts: threshold,
        discountType: discountType,
        discountValue: discountValue,
        targetType: appliesTo === "all" ? "all" : "product",
        targetIds: appliesTo === "all" ? [] : products.map(({ id }) => id),
      }),
      valueType: "json",
    });
    setInitialProducts(products);
  }

  const resetForm = () => {
    setThreshold(metafieldConfig.threshold);
    setDiscountType(metafieldConfig.discountType);
    setDiscountValue(metafieldConfig.discountValue);
    setProducts(initialProducts);
    setAppliesTo(initialProducts.length > 0 ? "selected" : "all");
  };

  const onSelectedProducts = async () => {
    const selection = await resourcePicker({
      type: "product",
      selectionIds: products.map(({ id }) => ({ id })),
      action: "select",
    });
    setProducts(selection ?? []);
  };

  const removeProduct = (id) => {
    setProducts((prev) => prev.filter((product) => product.id !== id));
  };

  return {
    applyExtensionMetafieldChange,
    i18n,
    threshold,
    onThresholdChange,
    discountType,
    onDiscountTypeChange,
    discountValue,
    onDiscountValueChange,
    initialProducts,
    products,
    removeProduct,
    onSelectedProducts,
    loading,
    appliesTo,
    onAppliesToChange,
    resetForm,
  };
}

const METAFIELD_NAMESPACE = "$app:conditional-discount--ui-extension";
const METAFIELD_KEY = "function-configuration";

async function getMetafieldDefinition() {
  const query = `#graphql
    query GetMetafieldDefinition {
      metafieldDefinitions(first: 1, ownerType: DISCOUNT, namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
        nodes {
          id
        }
      }
    }
  `;

  const result = await shopify.query(query);

  return result?.data?.metafieldDefinitions?.nodes[0];
}

async function createMetafieldDefinition() {
  const definition = {
    access: {
      admin: "MERCHANT_READ_WRITE",
    },
    key: METAFIELD_KEY,
    name: "Discount Configuration",
    namespace: METAFIELD_NAMESPACE,
    ownerType: "DISCOUNT",
    type: "json",
  };

  const query = `#graphql
    mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition {
            id
          }
        }
      }
  `;

  const variables = { definition };
  const result = await shopify.query(query, { variables });

  return result?.data?.metafieldDefinitionCreate?.createdDefinition;
}

function parseMetafield(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return {
      threshold: Number(parsed.minProducts ?? 1),
      discountType: parsed.discountType ?? "percentage",
      discountValue: Number(parsed.discountValue ?? 10),
      productIds: parsed.targetIds ?? [],
    };
  } catch {
    return {
      threshold: 1,
      discountType: "percentage",
      discountValue: 10,
      productIds: [],
    };
  }
}

async function getProducts(productGids, adminApiQuery) {
  if (!productGids || productGids.length === 0) {
    return [];
  }
  
  const query = `#graphql
    query GetProducts($ids: [ID!]!) {
      products: nodes(ids: $ids) {
        ... on Product {
          id
          title
        }
      }
    }
  `;
  const result = await adminApiQuery(query, {
    variables: { ids: productGids },
  });
  return result?.data?.products ?? [];
}



