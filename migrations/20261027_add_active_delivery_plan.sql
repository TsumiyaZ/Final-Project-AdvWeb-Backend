-- Keep old plans as history and mark only the latest plan per delivery date active.
ALTER TABLE delivery_plans
    ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE delivery_plans AS plan
JOIN (
    SELECT delivery_date, MAX(id) AS latest_plan_id
    FROM delivery_plans
    GROUP BY delivery_date
) AS latest
    ON latest.delivery_date = plan.delivery_date
SET plan.is_active = (plan.id = latest.latest_plan_id);

CREATE INDEX idx_plans_date_active_created
    ON delivery_plans (delivery_date, is_active, created_at);

ALTER TABLE delivery_plans
    ADD COLUMN active_delivery_date DATE
        GENERATED ALWAYS AS (
            CASE WHEN is_active THEN delivery_date ELSE NULL END
        ) STORED,
    ADD UNIQUE KEY uq_active_delivery_plan_date (active_delivery_date);

SHOW COLUMNS FROM delivery_plans
WHERE Field IN ('is_active', 'active_delivery_date');

SHOW INDEX FROM delivery_plans
WHERE Key_name = 'uq_active_delivery_plan_date';