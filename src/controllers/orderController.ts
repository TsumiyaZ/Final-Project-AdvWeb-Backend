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

const ORDER_STATUSES = new Set(["pending", "delivered", "cancelled"]);

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

function calculateDistanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const earthRadiusKm = 6371;
    const latDistance = (lat2 - lat1) * Math.PI / 180;
    const lonDistance = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(latDistance / 2) * Math.sin(latDistance / 2) +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(lonDistance / 2) *
        Math.sin(lonDistance / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusKm * c;
}

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

        const [rows] = await conn.query(`${ORDER_WITH_CUSTOMER_QUERY} ORDER BY o.id`);

        const orders = rows as OrderWithCustomerLocation[];

        const nearbyOrders = orders
            .map((order) => {
                const distance = calculateDistanceKm(
                    latitude,
                    longitude,
                    Number(order.customer_latitude),
                    Number(order.customer_longitude)
                );

                return {
                    ...formatOrderWithCustomer(order),
                    distance_km: Number(distance.toFixed(3)),
                };
            })
            .filter((order) => order.distance_km <= 2)
            .sort((a, b) => a.distance_km - b.distance_km);

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

        if (order.status !== undefined && !ORDER_STATUSES.has(order.status)) {
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

        connection = await conn.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query('SELECT id FROM customers');

        const customers = rows as {id: number}[];

        if (customers.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                error: "No customers available"
            }); 
        }

        const values: Array<[number, number]> = [];

        for (let i = 0; i < amount; i++) {
            const randomCustomer =
                customers[
                    Math.floor(
                        Math.random() * customers.length
                    )
                ];

            const quantity =
                Math.floor(Math.random() * 3) + 1;

            values.push([randomCustomer!.id, quantity]);
        }

        const placeholders = values
            .map(() => "(?, ?, CURDATE(), 'pending', TRUE)")
            .join(", ");
        const parameters = values.flatMap(([customerId, quantity]) => [
            customerId,
            quantity
        ]);

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

        return res.status(201).json({
            message: "Random orders generated",
            amount,
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
