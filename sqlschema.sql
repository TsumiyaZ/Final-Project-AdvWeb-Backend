CREATE DATABASE IF NOT EXISTS lunch_delivery
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE lunch_delivery;

CREATE TABLE shops (
    id TINYINT UNSIGNED NOT NULL DEFAULT 1,
    name VARCHAR(120) NOT NULL,
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    price_per_box DECIMAL(10, 2) NOT NULL DEFAULT 65.00,
    cost_per_box DECIMAL(10, 2) NOT NULL DEFAULT 40.00,
    rider_base_fee DECIMAL(10, 2) NOT NULL DEFAULT 15.00,
    rider_per_box_km DECIMAL(10, 2) NOT NULL DEFAULT 2.00,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    CONSTRAINT chk_single_shop CHECK (id = 1),
    CONSTRAINT chk_shop_latitude CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT chk_shop_longitude CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT chk_shop_prices CHECK (
        price_per_box >= 0
        AND cost_per_box >= 0
        AND rider_base_fee >= 0
        AND rider_per_box_km >= 0
    )
) ENGINE = InnoDB;

CREATE TABLE customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(25) NOT NULL,
    address VARCHAR(500) NOT NULL DEFAULT '',
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    INDEX idx_customers_name (name),
    INDEX idx_customers_phone (phone),
    INDEX idx_customers_deleted (deleted_at),
    CONSTRAINT chk_customer_latitude CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT chk_customer_longitude CHECK (longitude BETWEEN -180 AND 180)
) ENGINE = InnoDB;

CREATE TABLE riders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(25) NOT NULL,
    deleted_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    INDEX idx_riders_name (name),
    INDEX idx_riders_phone (phone),
    INDEX idx_riders_deleted (deleted_at)
) ENGINE = InnoDB;

CREATE TABLE orders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    customer_id BIGINT UNSIGNED NOT NULL,
    quantity TINYINT UNSIGNED NOT NULL,
    order_date DATE NOT NULL,
    status ENUM(
        'pending',
        'delivered',
        'cancelled'
    ) NOT NULL DEFAULT 'pending',
    is_demo BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
        ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    INDEX idx_orders_date_status (order_date, status),
    INDEX idx_orders_customer (customer_id),
    CONSTRAINT fk_orders_customer
        FOREIGN KEY (customer_id)
        REFERENCES customers(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT chk_order_quantity CHECK (quantity BETWEEN 1 AND 3)
) ENGINE = InnoDB;

CREATE TABLE delivery_plans (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    delivery_date DATE NOT NULL,
    input_signature CHAR(64)
        CHARACTER SET ascii
        COLLATE ascii_bin
        NOT NULL,
    routing_mode ENUM('road') NOT NULL DEFAULT 'road',
    departure_time TIME NOT NULL DEFAULT '11:30:00',
    deadline_time TIME NOT NULL DEFAULT '12:30:00',
    speed_kmh DECIMAL(6, 2) NOT NULL DEFAULT 30.00,
    service_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 2,
    alternative_index SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    alternatives_count SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    shop_snapshot JSON NOT NULL,
    rider_count SMALLINT UNSIGNED NOT NULL,
    total_orders SMALLINT UNSIGNED NOT NULL,
    total_boxes SMALLINT UNSIGNED NOT NULL,
    distance_km DECIMAL(10, 2) NOT NULL,
    delivery_cost DECIMAL(12, 2) NOT NULL,
    revenue DECIMAL(12, 2) NOT NULL,
    food_cost DECIMAL(12, 2) NOT NULL,
    profit DECIMAL(12, 2) NOT NULL,
    max_duration_minutes SMALLINT UNSIGNED NOT NULL,
    last_arrival_time TIME NOT NULL,
    all_on_time BOOLEAN NOT NULL,
    issued_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    INDEX idx_plans_date_created (delivery_date, created_at),
    INDEX idx_plans_signature (delivery_date, input_signature),
    CONSTRAINT chk_plan_time CHECK (deadline_time > departure_time),
    CONSTRAINT chk_plan_speed CHECK (speed_kmh > 0),
    CONSTRAINT chk_plan_rider_count CHECK (rider_count > 0),
    CONSTRAINT chk_plan_orders CHECK (total_orders > 0),
    CONSTRAINT chk_plan_boxes CHECK (total_boxes > 0),
    CONSTRAINT chk_plan_distance CHECK (distance_km >= 0),
    CONSTRAINT chk_plan_cost CHECK (
        delivery_cost >= 0
        AND revenue >= 0
        AND food_cost >= 0
    ),
    CONSTRAINT chk_plan_alternative CHECK (
        alternatives_count > 0
        AND alternative_index < alternatives_count
    )
) ENGINE = InnoDB;

CREATE TABLE rider_routes (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    plan_id BIGINT UNSIGNED NOT NULL,
    rider_id BIGINT UNSIGNED NOT NULL,
    rider_number SMALLINT UNSIGNED NOT NULL,
    rider_name VARCHAR(120) NOT NULL,
    rider_phone VARCHAR(25) NOT NULL,
    color CHAR(7)
        CHARACTER SET ascii
        COLLATE ascii_bin
        NOT NULL,
    color_name VARCHAR(30) NOT NULL,
    total_boxes SMALLINT UNSIGNED NOT NULL,
    distance_km DECIMAL(10, 2) NOT NULL,
    duration_minutes SMALLINT UNSIGNED NOT NULL,
    delivery_cost DECIMAL(12, 2) NOT NULL,
    geometry JSON NOT NULL,
    navigation_url TEXT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_route_plan_number (plan_id, rider_number),
    UNIQUE KEY uq_route_plan_rider (plan_id, rider_id),
    INDEX idx_routes_plan (plan_id),
    INDEX idx_routes_rider (rider_id),
    CONSTRAINT fk_routes_plan
        FOREIGN KEY (plan_id)
        REFERENCES delivery_plans(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_routes_rider
        FOREIGN KEY (rider_id)
        REFERENCES riders(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT chk_rider_number CHECK (rider_number > 0),
    CONSTRAINT chk_route_boxes CHECK (total_boxes > 0),
    CONSTRAINT chk_route_distance CHECK (distance_km >= 0),
    CONSTRAINT chk_route_cost CHECK (delivery_cost >= 0)
) ENGINE = InnoDB;

CREATE TABLE route_stops (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    route_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL,
    stop_sequence TINYINT UNSIGNED NOT NULL,
    customer_name VARCHAR(120) NOT NULL,
    phone VARCHAR(25) NOT NULL,
    address VARCHAR(500) NOT NULL DEFAULT '',
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    quantity TINYINT UNSIGNED NOT NULL,
    arrival_time TIME NOT NULL,
    distance_from_previous_km DECIMAL(10, 2) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_stop_sequence (route_id, stop_sequence),
    INDEX idx_stops_order (order_id),
    INDEX idx_stops_route (route_id),
    CONSTRAINT fk_stops_route
        FOREIGN KEY (route_id)
        REFERENCES rider_routes(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE,
    CONSTRAINT fk_stops_order
        FOREIGN KEY (order_id)
        REFERENCES orders(id)
        ON UPDATE CASCADE
        ON DELETE RESTRICT,
    CONSTRAINT chk_stop_sequence CHECK (stop_sequence BETWEEN 1 AND 3),
    CONSTRAINT chk_stop_quantity CHECK (quantity BETWEEN 1 AND 3),
    CONSTRAINT chk_stop_latitude CHECK (latitude BETWEEN -90 AND 90),
    CONSTRAINT chk_stop_longitude CHECK (longitude BETWEEN -180 AND 180),
    CONSTRAINT chk_stop_distance CHECK (distance_from_previous_km >= 0)
) ENGINE = InnoDB;

CREATE TABLE rider_jobs (
    code VARCHAR(32)
        CHARACTER SET ascii
        COLLATE ascii_bin
        NOT NULL,
    route_id BIGINT UNSIGNED NOT NULL,
    status ENUM(
        'active',
        'superseded'
    ) NOT NULL DEFAULT 'active',
    input_signature CHAR(64)
        CHARACTER SET ascii
        COLLATE ascii_bin
        NOT NULL,
    issued_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (code),
    UNIQUE KEY uq_job_route (route_id),
    INDEX idx_jobs_status (status),
    CONSTRAINT fk_jobs_route
        FOREIGN KEY (route_id)
        REFERENCES rider_routes(id)
        ON UPDATE CASCADE
        ON DELETE CASCADE
) ENGINE = InnoDB;

INSERT INTO shops (
    id,
    name,
    latitude,
    longitude,
    price_per_box,
    cost_per_box,
    rider_base_fee,
    rider_per_box_km
)
VALUES (
    1,
    'ส่งด่วนมื้อเที่ยง',
    16.2460000,
    103.2520000,
    65.00,
    40.00,
    15.00,
    2.00
)
ON DUPLICATE KEY UPDATE
    name = 'ส่งด่วนมื้อเที่ยง',
    latitude = 16.2460000,
    longitude = 103.2520000,
    price_per_box = 65.00,
    cost_per_box = 40.00,
    rider_base_fee = 15.00,
    rider_per_box_km = 2.00;