-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DiscountRuleTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetTitle" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'required',
    CONSTRAINT "DiscountRuleTarget_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DiscountRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DiscountRuleTarget" ("id", "ruleId", "targetId", "targetTitle", "targetType") SELECT "id", "ruleId", "targetId", "targetTitle", "targetType" FROM "DiscountRuleTarget";
DROP TABLE "DiscountRuleTarget";
ALTER TABLE "new_DiscountRuleTarget" RENAME TO "DiscountRuleTarget";
CREATE INDEX "DiscountRuleTarget_ruleId_idx" ON "DiscountRuleTarget"("ruleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
