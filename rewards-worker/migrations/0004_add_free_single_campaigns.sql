ALTER TABLE offer_campaigns
ADD COLUMN reward_variant TEXT
CHECK(reward_variant IS NULL OR (reward_variant = 'free_single' AND reward_type = 'pick_a_pack'));
