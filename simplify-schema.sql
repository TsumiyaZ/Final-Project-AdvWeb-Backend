-- Run this migration once on the existing lunch_delivery database.
USE lunch_delivery;

-- Remove audit fields that are not used by the application.
ALTER TABLE shops
    DROP COLUMN created_at,
    DROP COLUMN updated_at;

ALTER TABLE customers
    DROP COLUMN is_demo,
    DROP COLUMN created_at,
    DROP COLUMN updated_at;

ALTER TABLE riders
    DROP INDEX idx_riders_deleted,
    DROP COLUMN deleted_at,
    DROP COLUMN created_at,
    DROP COLUMN updated_at;

ALTER TABLE orders
    DROP COLUMN created_at,
    DROP COLUMN updated_at;

-- Keep only the plan summary fields used by the owner and rider screens.
ALTER TABLE delivery_plans
    DROP INDEX idx_plans_signature,
    DROP CHECK chk_plan_speed,
    DROP CHECK chk_plan_alternative;

ALTER TABLE delivery_plans
    DROP COLUMN input_signature,
    DROP COLUMN routing_mode,
    DROP COLUMN speed_kmh,
    DROP COLUMN service_minutes,
    DROP COLUMN alternative_index,
    DROP COLUMN alternatives_count,
    DROP COLUMN shop_snapshot,
    DROP COLUMN max_duration_minutes,
    DROP COLUMN issued_at;

-- A route has exactly one job code, so keep it on rider_routes.
ALTER TABLE rider_routes
    ADD COLUMN job_code VARCHAR(32)
        CHARACTER SET ascii
        COLLATE ascii_bin
        NULL AFTER rider_number;

UPDATE rider_routes rr
LEFT JOIN rider_jobs j ON j.route_id = rr.id
SET rr.job_code = COALESCE(
    j.code,
    CONCAT('JOB', LPAD(rr.plan_id, 6, '0'), '-', LPAD(rr.rider_number, 2, '0'))
);

ALTER TABLE rider_routes
    MODIFY COLUMN job_code VARCHAR(32)
        CHARACTER SET ascii
        COLLATE ascii_bin
        NOT NULL,
    ADD UNIQUE KEY uq_route_job_code (job_code),
    DROP COLUMN rider_name,
    DROP COLUMN rider_phone,
    DROP COLUMN color_name;

DROP TABLE rider_jobs;
