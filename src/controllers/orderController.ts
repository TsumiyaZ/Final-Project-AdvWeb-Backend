import { Request, Response } from "express";
import { conn } from "../config/dbconnect";
import { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { CreateOrderModel, OrderModel, UpdateOrderModel } from "../models/orderModel";

interface OrderWithCustomerLocation extends OrderModel {
    customer_name: string;
    customer_phone: string;
    customer_address: string;
    customer_latitude: string;
    customer_longitude: string;
}

interface RandomOrderCustomer {
    id: number;
    latitude: string | number;
    longitude: string | number;
}

const ORDER_STATUSES = ["pending", "delivered", "cancelled"];

function isValidOrderDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const parsedDate = new Date(Date.UTC(year!, month! - 1, day!));

    return parsedDate.getUTCFullYear() === year &&
        parsedDate.getUTCMonth() === month! - 1 &&
        parsedDate.getUTCDate() === day;
}

function getTodayDateBangkok(): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const year = parts.find((part) => part.type === "year")?.value ?? "";
    const month = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";

    return `${year}-${month}-${day}`;
}

function formatOrderWithCustomer(order: OrderWithCustomerLocation) {
    return {
        id: order.id,
        customer_id: order.customer_id,
        quantity: order.quantity,
        order_date: order.order_date,
        status: order.status,
        is_demo: order.is_demo,
        customer: {
            id: order.customer_id,
            name: order.customer_name,
            phone: order.customer_phone,
            address: order.customer_address,
            latitude: order.customer_latitude,
            longitude: order.customer_longitude
        }
    };
}

function shuffle<T>(items: T[]): T[] {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
    }
    return shuffled;
}

function distanceKm(
    first: { latitude: number; longitude: number },
    second: { latitude: number; longitude: number }
): number {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const latitudeDifference = radians(second.latitude - first.latitude);
    const longitudeDifference = radians(second.longitude - first.longitude);
    const haversine = Math.sin(latitudeDifference / 2) ** 2 +
        Math.cos(radians(first.latitude)) * Math.cos(radians(second.latitude)) *
        Math.sin(longitudeDifference / 2) ** 2;
    const safeHaversine = Math.min(1, haversine);
    return 6371 * 2 * Math.atan2(Math.sqrt(safeHaversine), Math.sqrt(1 - safeHaversine));
}

function spreadCustomersByLocation(customers: RandomOrderCustomer[]): RandomOrderCustomer[] {
    const customerGroups: Array<{
        key: string;
        customers: RandomOrderCustomer[];
    }> = [];

    for (const customer of customers) {
        const key = `${Number(customer.latitude).toFixed(6)},${Number(customer.longitude).toFixed(6)}`;
        let group = customerGroups.find((item) => item.key === key);

        if (!group) {
            group = { key, customers: [] };
            customerGroups.push(group);
        }

        group.customers.push(customer);
    }

    let remainingPoints: Array<{
        customer: RandomOrderCustomer;
        latitude: number;
        longitude: number;
    }> = [];

    for (const group of customerGroups) {
        const firstCustomer = group.customers[0];
        if (!firstCustomer) continue;

        const randomCustomersAtPoint = shuffle(group.customers);
        const selectedCustomer = randomCustomersAtPoint[0];
        if (!selectedCustomer) continue;

        remainingPoints.push({
            customer: selectedCustomer,
            latitude: Number(firstCustomer.latitude),
            longitude: Number(firstCustomer.longitude)
        });
    }

    remainingPoints = shuffle(remainingPoints);
    const selectedPoints: Array<{ latitude: number; longitude: number }> = [];
    const spreadCustomers: RandomOrderCustomer[] = [];

    while (remainingPoints.length > 0) {
        let selectedIndex = 0;
        if (selectedPoints.length > 0) {
            const rankedPoints = remainingPoints
                .map((point, index) => ({
                    index,
                    minDistance: Math.min(...selectedPoints.map((selected) =>
                        distanceKm(point, selected)
                    ))
                }))
                .sort((first, second) => second.minDistance - first.minDistance);
            const topChoices = rankedPoints.slice(0, Math.min(3, rankedPoints.length));
            selectedIndex = topChoices[Math.floor(Math.random() * topChoices.length)]!.index;
        }

        const [point] = remainingPoints.splice(selectedIndex, 1);
        if (!point) continue;
        spreadCustomers.push(point.customer);
        selectedPoints.push({ latitude: point.latitude, longitude: point.longitude });
    }

    const remainingCustomers: RandomOrderCustomer[] = [];
    for (const customer of customers) {
        const alreadySelected = spreadCustomers.some(
            (selectedCustomer) => selectedCustomer.id === customer.id
        );
        if (!alreadySelected) remainingCustomers.push(customer);
    }

    const shuffledRemainingCustomers = shuffle(remainingCustomers);
    return [...spreadCustomers, ...shuffledRemainingCustomers];
}

const ORDER_WITH_CUSTOMER_QUERY = `
    SELECT o.id,
           o.customer_id,
           o.quantity,
           DATE_FORMAT(o.order_date, '%Y-%m-%d') AS order_date,
           o.status,
           o.is_demo,
           c.name AS customer_name,
           c.phone AS customer_phone,
           c.address AS customer_address,
           c.latitude AS customer_latitude,
           c.longitude AS customer_longitude
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
`;

export const getOrder = async (req: Request, res: Response) => {
    try {
        const [rows] = await conn.query(`${ORDER_WITH_CUSTOMER_QUERY} ORDER BY o.id`);
        const orders = rows as OrderWithCustomerLocation[];

        return res.json(orders.map(formatOrderWithCustomer));
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: 'Database error'
        });
    }
}

export const getNearbyOrders = async (req: Request, res: Response) => {
    try {
        const latitude = Number(req.query.latitude);
        const longitude = Number(req.query.longitude);

        if (
            typeof req.query.latitude !== 'string' || !req.query.latitude.trim() ||
            typeof req.query.longitude !== 'string' || !req.query.longitude.trim() ||
            !Number.isFinite(latitude) ||
            latitude < -90 ||
            latitude > 90 ||
            !Number.isFinite(longitude) ||
            longitude < -180 ||
            longitude > 180
        ) {
            return res.status(400).json({
                error: "Please provide valid latitude and longitude"
            });
        }

        // ใช้ข้อมูลออเดอร์พร้อมลูกค้าจาก query เดิม แล้วให้ SQL กรองระยะไม่เกิน 2 กม.
        const [rows] = await conn.query(
            `SELECT order_data.*,
                    ST_Distance_Sphere(
                        POINT(IF(customer_longitude = -180, 180, customer_longitude), customer_latitude),
                        POINT(?, ?)
                    ) / 1000 AS distance_km
             FROM (${ORDER_WITH_CUSTOMER_QUERY}) AS order_data
             HAVING distance_km <= 2
             ORDER BY distance_km, id`,
            [longitude === -180 ? 180 : longitude, latitude]
        );

        const orders = rows as (OrderWithCustomerLocation & { distance_km: number })[];
        const nearbyOrders = orders.map((order) => ({
            ...formatOrderWithCustomer(order),
            distance_km: Number(Number(order.distance_km).toFixed(3))
        }));

        return res.status(200).json(nearbyOrders);
    } catch (err: any) {
        console.error("Error in getNearbyOrders:", err);
        return res.status(500).json({
            error: "Database error",
            details: err?.message || String(err)
        });
    }
};

export const getOrderByID = async (req: Request, res: Response) => {
    try {
        const id = req.params.id;

        const [rows] = await conn.query(
            `${ORDER_WITH_CUSTOMER_QUERY} WHERE o.id = ?`,
            [id]
        );

        const orders = rows as OrderWithCustomerLocation[];

        if (orders.length === 0) {
            return res.status(404).json({
                error: 'Order not found'
            });
        }

        return res.json(formatOrderWithCustomer(orders[0]!));
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: 'Database error'
        });
    }
}

export const createOrder = async (req: Request, res: Response) => {
    try {
        const order: CreateOrderModel = req.body
        const customerId = Number(order.customer_id);
        const quantity = Number(order.quantity);

        if (!Number.isInteger(customerId) || customerId <= 0 || !order.order_date) {
            return res.status(400).json({
                error: "Missing required fields"
            });
        }

        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) {
            return res.status(400).json({
                error: "Quantity must be an integer between 1 and 3"
            });
        }

        if (!isValidOrderDate(order.order_date)) {
            return res.status(400).json({
                error: "Order date must be a valid date in YYYY-MM-DD format"
            });
        }

        const [customers] = await conn.query(
            'SELECT id FROM customers WHERE id = ?',
            [customerId]
        );

        const customerRows = customers as any[];
        
        if (customerRows.length === 0) {
            return res.status(404).json({
                error: "Customer not found"
            });
        }

        const [result] = await conn.query<ResultSetHeader>('INSERT INTO orders (customer_id, quantity, order_date) VALUES (?, ?, ?)',
            [
                customerId,
                quantity,
                order.order_date
            ]
        );

        return res.status(201).json({
            affected_rows: result.affectedRows,
            last_id: result.insertId
        });

    } catch (err) {
        console.error(err);
        return res.status(500).json({
            error: 'Database error'
        });
    }
}

export const updateOrderByID = async (req: Request,res: Response) => {
    try {
        const id = req.params.id;
        const order: UpdateOrderModel = req.body;

        const [rows] = await conn.query(
            `SELECT * FROM orders WHERE id = ?`,
            [id]
        );

        const orders = rows as OrderModel[];

        if (orders.length === 0) {
            return res.status(404).json({
                error: "Order not found"
            });
        }

        const originalOrder = orders[0];
        
        const updatedOrder = {
            ...originalOrder,
            ...order
        };

        const customerId = Number(updatedOrder.customer_id);
        const quantity = Number(updatedOrder.quantity);

        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 3) {
            return res.status(400).json({
                error: "Quantity must be an integer between 1 and 3"
            });
        }

        if (!Number.isInteger(customerId) || customerId <= 0) {
            return res.status(400).json({
                error: "Customer ID must be a positive integer"
            });
        }

        if (order.order_date !== undefined && !isValidOrderDate(order.order_date)) {
            return res.status(400).json({
                error: "Order date must be a valid date in YYYY-MM-DD format"
            });
        }

        if (order.status !== undefined && !ORDER_STATUSES.includes(order.status)) {
            return res.status(400).json({
                error: "Status must be pending, delivered or cancelled"
            });
        }

        const [customers] = await conn.query(
            `SELECT id
             FROM customers
             WHERE id = ?`,
            [customerId]
        );

        const customerRows = customers as { id: number }[];

        if (customerRows.length === 0) {
            return res.status(404).json({
                error: "Customer not found"
            });
        }

        const [result] = await conn.query<ResultSetHeader>(
            `UPDATE orders
                SET customer_id = ?,
                quantity = ?,
                order_date = ?,
                status = ?
                WHERE id = ?`,
            [
                customerId,
                quantity,
                updatedOrder.order_date,
                updatedOrder.status,
                id
            ]
        );

        return res.status(200).json({
            message: "Order updated successfully",
            affected_rows: result.affectedRows
        });
    
        

    } catch (err) {
        console.error(err);

        return res.status(500).json({
            error: "Database error"
        });
    }
};

export const deleteOrderByID = async (req: Request,res: Response) => {
    let connection: PoolConnection | undefined;

    try {
        connection = await conn.getConnection();
        const id = req.params.id;
        await connection.beginTransaction();

        const [orderRows] = await connection.query<RowDataPacket[]>(
            "SELECT id FROM orders WHERE id = ? FOR UPDATE",
            [id]
        );

        if (orderRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: "Order not found"
            });
        }

        const [planRows] = await connection.query<RowDataPacket[]>(
            `SELECT DISTINCT rr.plan_id
             FROM route_stops rs
             JOIN rider_routes rr ON rr.id = rs.route_id
             WHERE rs.order_id = ?`,
            [id]
        );

        const planIds = planRows.map((row) => Number(row.plan_id));
        if (planIds.length > 0) {
            const placeholders = planIds.map(() => "?").join(", ");
            await connection.query(
                `DELETE FROM delivery_plans WHERE id IN (${placeholders})`,
                planIds
            );
        }

        const [result] = await connection.query<ResultSetHeader>(
            "DELETE FROM orders WHERE id = ?",
            [id]
        );

        await connection.commit();

        return res.status(200).json({
            message: "Order deleted successfully",
            affected_rows: result.affectedRows,
            deleted_related_plans: planIds.length
        });

    } catch (err: any) {
        if (connection) {
            await connection.rollback();
        }
        console.error(err);

        return res.status(500).json({
            error: "Database error",
            details: err?.message || String(err)
        });
    } finally {
        connection?.release();
    }
};

export const clearDemoOrders = async (_req: Request, res: Response) => {
    try {
        const connection = await conn.getConnection();

        try {
            await connection.beginTransaction();

            const [planRows] = await connection.query<RowDataPacket[]>(
                `SELECT DISTINCT rr.plan_id
                 FROM route_stops rs
                 JOIN orders o ON o.id = rs.order_id
                 JOIN rider_routes rr ON rr.id = rs.route_id
                 WHERE o.is_demo = TRUE`
            );

            const planIds = planRows.map((row) => Number(row.plan_id));
            let deletedPlans = 0;

            if (planIds.length > 0) {
                const placeholders = planIds.map(() => "?").join(", ");
                const [planResult] = await connection.query<ResultSetHeader>(
                    `DELETE FROM delivery_plans WHERE id IN (${placeholders})`,
                    planIds
                );
                deletedPlans = planResult.affectedRows;
            }

            const [orderResult] = await connection.query<ResultSetHeader>(
                `DELETE FROM orders WHERE is_demo = TRUE`
            );

            await connection.commit();

            return res.status(200).json({
                message: "Demo orders cleared successfully",
                deleted_orders: orderResult.affectedRows,
                deleted_related_plans: deletedPlans
            });
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }
    } catch (err: any) {
        console.error("Error in clearDemoOrders:", err);
        return res.status(500).json({
            error: "Database error",
            details: err?.message || String(err)
        });
    }
};

export const randomOrder = async (req: Request,res: Response) => {
    let connection: PoolConnection | undefined;

    try {
        const amount = Number(req.body.amount ?? 20);

        if (!Number.isInteger(amount) || amount < 20 || amount > 30) {
            return res.status(400).json({
                error: "Amount must be an integer between 20 and 30"
            });
        }

        // ใช้วันของไทยให้ตรงกับวันที่หน้าแผนเส้นทางนำไปค้นหา
        const orderDate = getTodayDateBangkok();

        connection = await conn.getConnection();
        await connection.beginTransaction();

        const [shopRows] = await connection.query<RowDataPacket[]>(
            "SELECT latitude, longitude FROM shops WHERE id = 1"
        );
        const shop = shopRows[0];
        if (!shop) {
            await connection.rollback();
            return res.status(404).json({ error: "Shop not found" });
        }

        const [rows] = await connection.query<RowDataPacket[]>(
            `SELECT c.id, c.latitude, c.longitude
             FROM customers c
             WHERE ST_Distance_Sphere(
                 POINT(IF(c.longitude = -180, 180, c.longitude), c.latitude),
                 POINT(?, ?)
             ) <= 3000`,
            [Number(shop.longitude) === -180 ? 180 : Number(shop.longitude), Number(shop.latitude)]
        );

        const customers = (rows as RandomOrderCustomer[]).map((customer) => ({
            ...customer,
            id: Number(customer.id)
        }));

        if (customers.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                error: "No customers found within 3 km of the shop"
            }); 
        }

        // เลือกพิกัดให้กระจายก่อน แล้วค่อยเลือกหลาย customer ที่พิกัดเดียวกัน
        // หากจำนวนออเดอร์มากกว่าจำนวน customer จึงวนซ้ำให้จำนวนออเดอร์สมดุล
        const customerSequence = spreadCustomersByLocation(customers);
        const values: Array<[number, number]> = [];

        for (let i = 0; i < amount; i++) {
            const randomCustomer = customerSequence[i % customerSequence.length]!;

            const quantity =
                Math.floor(Math.random() * 3) + 1;

            values.push([randomCustomer.id, quantity]);
        }

        const placeholders = values
            .map(() => "(?, ?, ?, 'pending', TRUE)")
            .join(", ");
        const parameters: (number | string)[] = [];
        for (const [customerId, quantity] of values) {
            parameters.push(customerId, quantity, orderDate);
        }

        const [insertResult] = await connection.query<ResultSetHeader>(
            `INSERT INTO orders
             (customer_id, quantity, order_date, status, is_demo)
             VALUES ${placeholders}`,
            parameters
        );

        const firstId = insertResult.insertId;
        const lastId = firstId + insertResult.affectedRows - 1;
        const [createdRows] = await connection.query(
            `${ORDER_WITH_CUSTOMER_QUERY}
             WHERE o.id BETWEEN ? AND ?
             ORDER BY o.id`,
            [firstId, lastId]
        );

        await connection.commit();

        const createdOrders = createdRows as OrderWithCustomerLocation[];

        const uniqueCustomerIds: number[] = [];
        const uniqueDeliveryPoints: string[] = [];
        for (const [customerId] of values) {
            if (!uniqueCustomerIds.includes(customerId)) {
                uniqueCustomerIds.push(customerId);
            }

            const customer = customers.find((item) => item.id === customerId);
            if (customer) {
                const point = `${Number(customer.latitude).toFixed(6)},${Number(customer.longitude).toFixed(6)}`;
                if (!uniqueDeliveryPoints.includes(point)) {
                    uniqueDeliveryPoints.push(point);
                }
            }
        }

        return res.status(201).json({
            message: "Random orders generated",
            amount,
            unique_customers: uniqueCustomerIds.length,
            unique_delivery_points: uniqueDeliveryPoints.length,
            orders: createdOrders.map(formatOrderWithCustomer)
        });

    } catch (err: any) {
        if (connection) {
            await connection.rollback();
        }
        console.error(err);

        return res.status(500).json({
            error: "Database error",
            details: err?.message || String(err)
        });
    } finally {
        connection?.release();
    }
};
