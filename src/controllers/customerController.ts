import { Request, Response } from "express";
import { conn } from "../config/dbconnect";
import { CustomerModel } from "../models/customerModel";
import { PoolConnection, ResultSetHeader } from "mysql2/promise";

function isValidCoordinate(
    latitude: number,
    longitude: number
): boolean {
    return Number.isFinite(latitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        Number.isFinite(longitude) &&
        longitude >= -180 &&
        longitude <= 180;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
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

    const c = 2 * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
    );

    return earthRadiusKm * c;
}

export const getCustomers = async (req: Request, res: Response) => {
    try {
        const [rows] = await conn.query('SELECT * FROM customers');
        const customers = rows as CustomerModel[];
        return res.json(customers);
    } catch (err: any) {
        console.error("Error in getCustomers:", err);
        return res.status(500).json({
            error: "Database error",
            details: err?.message || String(err)
        });
    }
};

export const getNearbyCustomers = async (
    req: Request,
    res: Response
) => {
    try {
        const latitude = Number(req.query.latitude);
        const longitude = Number(req.query.longitude);

        if (!isValidCoordinate(latitude, longitude)) {
            return res.status(400).json({
                error: 'Please provide valid latitude and longitude'
            });
        }

        // ดึงลูกค้าทั้งหมดจากฐานข้อมูล
        const [rows] = await conn.query('SELECT * FROM customers');

        const customers = rows as CustomerModel[];

        // เพิ่มระยะทางให้ลูกค้าแต่ละคน
        const customersWithDistance = customers.map((customer) => {
            const distance = calculateDistanceKm(
                latitude,
                longitude,
                Number(customer.latitude),
                Number(customer.longitude)
            );

            return {
                ...customer,
                distance_km: Number(distance.toFixed(3))
            };
        });

        // เลือกเฉพาะคนที่อยู่ไม่เกิน 1 กิโลเมตร
        const nearbyCustomers = customersWithDistance
            .filter((customer) => customer.distance_km <= 1)
            .sort((a, b) => a.distance_km - b.distance_km);

        return res.status(200).json(nearbyCustomers);

    } catch (err: any) {
        console.error('Error in getNearbyCustomers:', err);

        return res.status(500).json({
            error: 'Database error',
            details: err?.message || String(err)
        });
    }
};

export const searchNameCustomer = async (req: Request, res: Response) => {
    try {
        const keyword = String(req.query.name ?? '').trim();

        if (!keyword) {
            return res.status(400).json({
                error: 'Please provide search query, for example ?name=สมชาย'
            });
        }

        const [rows] = await conn.query(
            'SELECT * FROM customers WHERE name LIKE ? ORDER BY name',
            [`%${keyword}%`]
        );
        const customers = rows as CustomerModel[];

        return res.status(200).json(customers);
    } catch (err: any) {
        console.error("Error in getCustomers:", err);
        return res.status(500).json({
            error: "Database error",
            details: err?.message || String(err)
        });
    }
};

export const getCustomersByID = async (req: Request, res: Response) => {
    try {
        const id = req.params.id;
        const [rows] = await conn.query('SELECT * FROM customers WHERE id = ?', [id]);
        const customers = rows as CustomerModel[];

        if (customers.length === 0) {
            return res.status(404).json({
                error: "Customer not found"
            });
        }

        return res.json(customers[0]);
    } catch (err: any) {
        console.error("Error in getCustomersByID:", err);
        return res.status(500).json({
            error: "Database error",
            details: err?.message || String(err)
        });
    }
};

export const createCustomer = async (req: Request, res: Response) => {
    try {
        const { name, phone, address, latitude, longitude } = req.body;

        const parsedLatitude = Number(latitude);
        const parsedLongitude = Number(longitude);

        if (
            !isNonEmptyString(name) ||
            !isNonEmptyString(phone) ||
            !isNonEmptyString(address)
        ) {
            return res.status(400).json({
                error: "Name, phone and address are required"
            });
        }

        if (!isValidCoordinate(parsedLatitude, parsedLongitude)) {
            return res.status(400).json({
                error: "Please provide valid latitude and longitude"
            });
        }

        const sql = 'INSERT INTO customers (name, phone, address, latitude, longitude) VALUES (?, ?, ?, ?, ?)';
        const [result] = await conn.query<ResultSetHeader>(sql, [
            name.trim(),
            phone.trim(),
            address.trim(),
            parsedLatitude,
            parsedLongitude
        ]);

        return res.status(201).json({
            affected_rows: result.affectedRows,
            last_id: result.insertId
        });
    } catch (err: any) {
        console.error("Error in createCustomer:", err);
        return res.status(500).json({
            error: "Database error",
            details: err?.message || String(err)
        });
    }
};

export const deleteCustomerByID = async (req: Request, res: Response) => {
    let connection: PoolConnection | undefined;

    try {
        connection = await conn.getConnection();
        const id = req.params.id;
        await connection.beginTransaction();

        const [planRows] = await connection.query<any[]>(
            `SELECT DISTINCT rr.plan_id
             FROM route_stops rs
             JOIN orders o ON o.id = rs.order_id
             JOIN rider_routes rr ON rr.id = rs.route_id
             WHERE o.customer_id = ?`,
            [id]
        );

        const planIds = planRows.map((row) => Number(row.plan_id));
        if (planIds.length > 0) {
            const placeholders = planIds.map(() => '?').join(', ');
            await connection.query(
                `DELETE FROM delivery_plans WHERE id IN (${placeholders})`,
                planIds
            );
        }

        await connection.query('DELETE FROM orders WHERE customer_id = ?', [id]);

        const [result] = await connection.query<ResultSetHeader>(
            'DELETE FROM customers WHERE id = ?',
            [id]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: "Customer not found"
            });
        }

        await connection.commit();

        return res.status(200).json({
            message: "Deleted customer and related orders successfully",
            affected_row: result.affectedRows,
            deleted_related_plans: planIds.length
        });
    } catch (err: any) {
        if (connection) {
            await connection.rollback();
        }
        console.error("Error in deleteCustomerByID:", err);
        return res.status(500).json({
            error: 'Database error',
            details: err?.message || String(err)
        });
    } finally {
        connection?.release();
    }
};

export const updateCustomerByID = async (req: Request, res: Response) => {
    try {
        const id = req.params.id;
        const { name, phone, address, latitude, longitude } = req.body;

        const parsedLatitude = Number(latitude);
        const parsedLongitude = Number(longitude);

        if (
            !isNonEmptyString(name) ||
            !isNonEmptyString(phone) ||
            !isNonEmptyString(address)
        ) {
            return res.status(400).json({
                error: "Name, phone and address are required"
            });
        }

        if (!isValidCoordinate(parsedLatitude, parsedLongitude)) {
            return res.status(400).json({
                error: "Please provide valid latitude and longitude"
            });
        }

        const sql = `
            UPDATE customers
            SET name = ?,
                phone = ?,
                address = ?,
                latitude = ?,
                longitude = ?
            WHERE id = ?
        `;

        const [result] = await conn.query<ResultSetHeader>(sql, [
            name.trim(),
            phone.trim(),
            address.trim(),
            parsedLatitude,
            parsedLongitude,
            id
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Customer not found"
            });
        }

        return res.status(200).json({
            affected_row: result.affectedRows
        });
    } catch (err: any) {
        console.error("Error in updateCustomerByID:", err);
        return res.status(500).json({
            error: "Database error",
            details: err?.message || String(err)
        });
    }
};
