-- Existing HR roles do not establish ownership. Legacy ADMIN grants require Nortex verification.
ALTER TABLE `User` ADD COLUMN `assistantBudgetOwner` BOOLEAN NOT NULL DEFAULT false;
