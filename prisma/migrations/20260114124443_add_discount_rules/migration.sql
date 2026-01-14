-- CreateTable
CREATE TABLE "DiscountRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minProducts" INTEGER NOT NULL DEFAULT 1,
    "maxDiscounted" INTEGER,
    "discountType" TEXT NOT NULL DEFAULT 'percentage',
    "discountValue" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "shopifyDiscountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DiscountRuleTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetTitle" TEXT NOT NULL,
    CONSTRAINT "DiscountRuleTarget_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DiscountRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRule_shopifyDiscountId_key" ON "DiscountRule"("shopifyDiscountId");

-- CreateIndex
CREATE INDEX "DiscountRule_shop_idx" ON "DiscountRule"("shop");

-- CreateIndex
CREATE INDEX "DiscountRuleTarget_ruleId_idx" ON "DiscountRuleTarget"("ruleId");
