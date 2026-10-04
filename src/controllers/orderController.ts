import { Request, Response } from "express";
import { conn } from "../config/dbconnect";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { CreateOrderModel, OrderModel, UpdateOrderModel } from "../models/orderModel";

interface OrderWithCustomerLocation extends OrderModel {
    customer_name: string;
    customer_phone: string;
    customer_address: string;
    customer_latitude: string;
    customer_longitude: string;
}

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
        const [rows] = await conn.query('SELECT * FROM orders');
        const orders = rows as OrderModel[];
        res.json(orders);
    } catch (err) {
        console.error(err);
        res.status(500).json({
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

        const [rows] = await conn.query(
            `SELECT o.*,
                    c.name AS customer_name,
                    c.phone AS customer_phone,
                    c.address AS customer_address,
                    c.latitude AS customer_latitude,
                    c.longitude AS customer_longitude
             FROM orders o
             JOIN customers c ON c.id = o.customer_id
             WHERE c.deleted_at IS NULL
             ORDER BY o.id`
        );

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
                    id: order.id,
                    quantity: order.quantity,
                    order_date: order.order_date,
                    status: order.status,
                    is_demo: order.is_demo,
                    distance_km: Number(distance.toFixed(3)),
                    customer: {
                        id: order.customer_id,
                        name: order.customer_name,
                        phone: order.customer_phone,
                        address: order.customer_address,
                        latitude: order.customer_latitude,
                        longitude: order.customer_longitude
                    }
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

        const [rows] = await conn.query('SELECT * FROM orders WHERE id = ?', [
            id
        ]);

        const orders = rows as OrderModel[];

        if (orders.length === 0) {
            res.status(404).json({
                error: 'Order not found'
            });
        }

        const order: OrderModel = orders[0]!;
        res.json(order);
    } catch (err) {
        console.error(err);
        res.status(500).json({
            error: 'Database error'
        });
    }
}

export const createOrder = async (req: Request, res: Response) => {
    try {
        const order: CreateOrderModel = req.body

        if (!order.customer_id || !order.order_date || !order.quantity) {
            return res.status(400).json({
                error: "Missing required fields"
            });
        }

        if (order.quantity < 1 || order.quantity > 3) {
            return res.status(400).json({
                error: "Quantity must be between 1 and 3"
            });
        }

        const [customers] = await conn.query('SELECT id FROM customers WHERE id = ? and deleted_at IS NULL', [order.customer_id]);

        const customerRows = customers as any[];
        
        if (customerRows.length === 0) {
            return res.status(404).json({
                error: "Customer not found"
            });
        }

        const [result] = await conn.query<ResultSetHeader>('INSERT INTO orders (customer_id, quantity, order_date) VALUES (?, ?, ?)',
            [
                order.customer_id,
                order.quantity,
                order.order_date
            ]
        );

        res.status(201).json({
            affected_rows: result.affectedRows,
            last_id: result.insertId
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({
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

        if (updatedOrder.quantity! < 1 || updatedOrder.quantity! > 3) {
            return res.status(400).json({
                error: "Quantity must be between 1 and 3"
            });
        }

        const [customers] = await conn.query(
            `SELECT id
             FROM customers
             WHERE id = ?
             AND deleted_at IS NULL`,
            [updatedOrder.customer_id]
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
                updatedOrder.customer_id,
                updatedOrder.quantity,
                updatedOrder.order_date,
                updatedOrder.status,
                id
            ]
        );

        res.status(200).json({
            message: "Order updated successfully",
            affected_rows: result.affectedRows
        });
    
        

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: "Database error"
        });
    }
};

export const deleteOrderByID = async (req: Request,res: Response) => {
    try {
        const id = req.params.id;

        const [result] =
            await conn.query<ResultSetHeader>(
                `UPDATE orders
                 SET status = 'cancelled'
                 WHERE id = ?
                 AND status != 'cancelled'`,
                [id]
            );

        if (result.affectedRows === 0) {

            const [rows] = await conn.query(
                `SELECT id, status
                 FROM orders
                 WHERE id = ?`,
                [id]
            );

            const orders = rows as OrderModel[];

            if (orders.length === 0) {
                return res.status(404).json({
                    error: "Order not found"
                });
            }

            return res.status(400).json({
                error: "Order already cancelled"
            });
        }

        res.status(200).json({
            message: "Order cancelled successfully"
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: "Database error"
        });
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
    try {
        const amount = Number(req.body.amount ?? 20);

        if (!Number.isInteger(amount) || amount < 1 || amount > 30) {
            return res.status(400).json({
                error: "Amount must be an integer between 1 and 30"
            });
        }

        const [rows] = await conn.query(
            `SELECT id
             FROM customers
             WHERE deleted_at IS NULL`
        );

        const customers = rows as {id: number}[];

        if (customers.length === 0) {
            return res.status(400).json({
                error: "No customers available"
            }); 
        }

        for (let i = 0; i < amount; i++) {
            const randomCustomer =
                customers[
                    Math.floor(
                        Math.random() * customers.length
                    )
                ];

            const quantity =
                Math.floor(Math.random() * 3) + 1;

            await conn.query(
                `INSERT INTO orders
                (customer_id, quantity, order_date, status, is_demo)
                VALUES (?, ?, CURDATE(), 'pending', TRUE)`,
                [
                    randomCustomer!.id,
                    quantity
                ]
            );
        }

        res.status(201).json({
            message: "Random orders generated",
            amount
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            error: "Database error"
        });
    }
};
