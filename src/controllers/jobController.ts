import { Request, Response } from "express";
import { conn } from "../config/dbconnect";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

interface JobRecord extends RowDataPacket {
  route_id: number;
  geometry: unknown;
  stops?: RowDataPacket[];
}


// GET /api/jobs?search=
export const getJobs = async (req: Request, res: Response) => {
  try {
    const search = String(req.query.search ?? "").trim();
    let sql = `
      SELECT rr.job_code,
             DATE_FORMAT(p.delivery_date, '%Y-%m-%d') AS delivery_date,
             p.id AS plan_id,
             rr.id AS route_id, rr.rider_number, rr.rider_id,
             r.name AS rider_name, r.phone AS rider_phone, rr.color,
             rr.total_boxes, rr.distance_km, rr.duration_minutes,
             rr.delivery_cost, rr.navigation_url,
             (SELECT COUNT(*) FROM route_stops rs WHERE rs.route_id = rr.id) AS total_orders
      FROM rider_routes rr
      JOIN delivery_plans p ON p.id = rr.plan_id
      JOIN riders r ON r.id = rr.rider_id
      WHERE p.is_active = TRUE`;
    const params: unknown[] = [];
    if (search) {
      sql += ` AND (rr.job_code LIKE ? OR r.name LIKE ? OR r.phone LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    sql += ` ORDER BY rr.id DESC LIMIT 100`;
    const [rows] = await conn.query(sql, params);
    return res.json(rows);
  } catch (err: unknown) {
    console.error("getJobs:", err);
    return res.status(500).json({ error: "Database error" });
  }
};

// GET /api/jobs/:code
export const getJobByCode = async (req: Request, res: Response) => {
  try {
    const code = req.params.code;
    const [rows] = await conn.query<JobRecord[]>(
      `SELECT rr.job_code,
              DATE_FORMAT(p.delivery_date, '%Y-%m-%d') AS delivery_date,
              p.id AS plan_id, p.departure_time, p.deadline_time,
              p.last_arrival_time, p.all_on_time,
              rr.id AS route_id, rr.rider_number, rr.rider_id,
              r.name AS rider_name, r.phone AS rider_phone, rr.color,
              rr.total_boxes, rr.distance_km, rr.duration_minutes,
              rr.delivery_cost, rr.geometry, rr.navigation_url
       FROM rider_routes rr
       JOIN delivery_plans p ON p.id = rr.plan_id
       JOIN riders r ON r.id = rr.rider_id
       WHERE rr.job_code = ? AND p.is_active = TRUE`,
      [code]
    );
    const job = rows[0];
    if (!job) return res.status(404).json({ error: "Job not found" });

    const [stops] = await conn.query<RowDataPacket[]>(
      `SELECT rs.order_id, rs.stop_sequence, rs.customer_name, rs.phone, rs.address,
              rs.latitude, rs.longitude, rs.quantity, rs.arrival_time,
              rs.distance_from_previous_km, o.status
       FROM route_stops rs
       JOIN orders o ON o.id = rs.order_id
       WHERE rs.route_id = ?
       ORDER BY rs.stop_sequence`,
      [job.route_id]
    );
    job.stops = stops;

    if (typeof job.geometry === "string") {
      try {
        job.geometry = JSON.parse(job.geometry);
      } catch {
        // ถ้า JSON ในฐานข้อมูลไม่ถูกต้อง ให้ส่งค่าเดิมกลับไป
      }
    }
    return res.json(job);
  } catch (err: unknown) {
    console.error("getJobByCode:", err);
    return res.status(500).json({ error: "Database error" });
  }
};

// POST /api/jobs/:code/stops/:orderId/complete
export const markStopDelivered = async (req: Request, res: Response) => {
  const jobCode = String(req.params.code ?? "").trim();
  const orderIdText = String(req.params.orderId ?? "");

  if (!jobCode || !/^[1-9]\d*$/.test(orderIdText)) {
    return res.status(400).json({ error: "Invalid job code or order ID" });
  }

  let connection: PoolConnection | undefined;

  try {
    connection = await conn.getConnection();
    await connection.beginTransaction();

    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT o.id, o.status
       FROM rider_routes rr
       JOIN delivery_plans p ON p.id = rr.plan_id
       JOIN route_stops rs ON rs.route_id = rr.id
       JOIN orders o ON o.id = rs.order_id
       WHERE rr.job_code = ?
         AND p.is_active = TRUE
         AND o.id = ?
       FOR UPDATE`,
      [jobCode, Number(orderIdText)]
    );

    const order = rows[0];
    if (!order) {
      await connection.rollback();
      return res.status(404).json({ error: "Order was not found in this active job" });
    }

    if (order.status === "cancelled") {
      await connection.rollback();
      return res.status(409).json({ error: "Cancelled orders cannot be marked as delivered" });
    }

    if (order.status === "delivered") {
      await connection.commit();
      return res.json({
        message: "Order was already delivered",
        order_id: Number(order.id),
        status: "delivered"
      });
    }

    const [result] = await connection.query<ResultSetHeader>(
      "UPDATE orders SET status = 'delivered' WHERE id = ? AND status = 'pending'",
      [Number(order.id)]
    );

    if (result.affectedRows !== 1) {
      await connection.rollback();
      return res.status(409).json({ error: "Order status changed. Reload the job and try again" });
    }

    await connection.commit();
    return res.json({
      message: "Order marked as delivered",
      order_id: Number(order.id),
      status: "delivered"
    });
  } catch (err: unknown) {
    if (connection) await connection.rollback();
    console.error("markStopDelivered:", err);
    return res.status(500).json({ error: "Database error" });
  } finally {
    connection?.release();
  }
};
