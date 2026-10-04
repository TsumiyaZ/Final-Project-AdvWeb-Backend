import { Request, Response } from "express";
import { conn } from "../config/dbconnect";
import { RowDataPacket } from "mysql2";

// GET /api/jobs?search=
export const getJobs = async (req: Request, res: Response) => {
  try {
    const search = String(req.query.search ?? "").trim();
    let sql = `
      SELECT j.code AS job_code, j.status AS job_status,
             DATE_FORMAT(p.delivery_date, '%Y-%m-%d') AS delivery_date,
             p.id AS plan_id,
             rr.id AS route_id, rr.rider_number, rr.rider_id,
             rr.rider_name, rr.rider_phone, rr.color, rr.color_name,
             rr.total_boxes, rr.distance_km, rr.duration_minutes,
             rr.delivery_cost, rr.navigation_url,
             COUNT(rs.id) AS total_orders
      FROM rider_jobs j
      JOIN rider_routes rr ON rr.id = j.route_id
      JOIN delivery_plans p ON p.id = rr.plan_id
      LEFT JOIN route_stops rs ON rs.route_id = rr.id
      WHERE 1=1`;
    const params: unknown[] = [];
    if (search) {
      sql += ` AND (j.code LIKE ? OR rr.rider_name LIKE ? OR rr.rider_phone LIKE ?)`;
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    sql += ` GROUP BY j.code ORDER BY j.issued_at DESC LIMIT 100`;
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
    const [rows] = await conn.query(
      `SELECT j.code AS job_code, j.status AS job_status, j.issued_at,
              DATE_FORMAT(p.delivery_date, '%Y-%m-%d') AS delivery_date,
              p.id AS plan_id, p.departure_time, p.deadline_time,
              p.last_arrival_time, p.all_on_time,
              rr.id AS route_id, rr.rider_number, rr.rider_id,
              rr.rider_name, rr.rider_phone, rr.color, rr.color_name,
              rr.total_boxes, rr.distance_km, rr.duration_minutes,
              rr.delivery_cost, rr.geometry, rr.navigation_url
       FROM rider_jobs j
       JOIN rider_routes rr ON rr.id = j.route_id
       JOIN delivery_plans p ON p.id = rr.plan_id
       WHERE j.code = ?`,
      [code]
    );
    const list = rows as RowDataPacket[];
    if (list.length === 0) return res.status(404).json({ error: "Job not found (เช่น JOB001)" });
    const job = list[0] as Record<string, unknown>;

    const [stops] = await conn.query(
      `SELECT order_id, stop_sequence, customer_name, phone, address,
              latitude, longitude, quantity, arrival_time, distance_from_previous_km
       FROM route_stops WHERE route_id = ? ORDER BY stop_sequence`,
      [(job as { route_id: number }).route_id]
    );
    (job as Record<string, unknown>).stops = stops;

    const g = (job as Record<string, unknown>).geometry;
    if (typeof g === "string") {
      try {
        (job as Record<string, unknown>).geometry = JSON.parse(g);
      } catch {
        /* keep */
      }
    }
    return res.json(job);
  } catch (err: unknown) {
    console.error("getJobByCode:", err);
    return res.status(500).json({ error: "Database error" });
  }
};
