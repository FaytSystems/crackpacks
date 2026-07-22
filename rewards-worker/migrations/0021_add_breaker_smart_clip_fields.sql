ALTER TABLE breaker_sales ADD COLUMN cloudflare_video_uid TEXT NOT NULL DEFAULT '' CHECK(length(cloudflare_video_uid) <= 64);
ALTER TABLE breaker_sales ADD COLUMN cloudflare_clipped_video_uid TEXT NOT NULL DEFAULT '' CHECK(length(cloudflare_clipped_video_uid) <= 64);
ALTER TABLE breaker_sales ADD COLUMN clip_method TEXT NOT NULL DEFAULT 'pending' CHECK(clip_method IN ('pending','instant','api_clip','manual','unavailable','error'));
ALTER TABLE breaker_sales ADD COLUMN clip_duration_seconds INTEGER CHECK(clip_duration_seconds IS NULL OR clip_duration_seconds BETWEEN 0 AND 36000);
ALTER TABLE breaker_sales ADD COLUMN clip_error TEXT NOT NULL DEFAULT '' CHECK(length(clip_error) <= 500);
CREATE INDEX IF NOT EXISTS idx_breaker_sales_clip_method ON breaker_sales(clip_method, created_at DESC);
