ALTER TABLE offer_campaigns
ADD COLUMN never_expires INTEGER NOT NULL DEFAULT 0
CHECK(never_expires IN (0,1));
