import { Request, Response } from "express";
import { conn } from "../config/dbconnect";
import { CustomerModel } from "../models/customerModel";
import { ResultSetHeader } from "mysql2";

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

        if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
        ) {
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
        const cusotmers = rows as CustomerModel[];

        return res.status(200).json(cusotmers);
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

        const sql = 'INSERT INTO customers (name, phone, address, latitude, longitude) VALUES (?, ?, ?, ?, ?)';
        const [result] = await conn.query<ResultSetHeader>(sql, [name, phone, address, latitude, longitude]);

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
    try {
        const id = req.params.id;
        await conn.query('DELETE FROM orders WHERE customer_id = ?', [id]);

        const [result] = await conn.query<ResultSetHeader>('DELETE FROM customers WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: "Customer not found"
            });
        }

        return res.status(200).json({
            message: "Deleted customer and related orders successfully",
            affected_row: result.affectedRows
        });
    } catch (err: any) {
        console.error("Error in deleteCustomerByID:", err);
        return res.status(500).json({
            error: 'Database error',
            details: err?.message || String(err)
        });
    }
};

export const updateCustomerByID = async (req: Request, res: Response) => {
    try {
        const id = req.params.id;
        const { name, phone, address, latitude, longitude } = req.body;

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
            name,
            phone,
            address,
            latitude,
            longitude,
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
