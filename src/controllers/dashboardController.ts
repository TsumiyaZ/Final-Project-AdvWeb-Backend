import { Request, Response } from "express";
import { RowDataPacket } from "mysql2";
import { conn } from "../config/dbconnect";
import { DashboardModel } from "../models/dashboardModel";

function getBangkokDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")!.value;
  const month = parts.find((part) => part.type === "month")!.value;
  const day = parts.find((part) => part.type === "day")!.value;
  return `${year}-${month}-${day}`;
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return !value.startsWith("0000-") &&
    !Number.isNaN(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === value;
}

// GET /api/dashboard?date=YYYY-MM-DD
export const getDashboard = async (req: Request, res: Response) => {
  const deliveryDate = req.query.date === undefined ? getBangkokDate() : req.query.date;

  if (!isValidDate(deliveryDate)) {
    return res.status(400).json({ error: "Invalid date format (YYYY-MM-DD)" });
  }

  try {
    const [summaryRows] = await conn.query(
      `SELECT COUNT(*) AS total_orders,
              COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN quantity ELSE 0 END), 0) AS total_boxes,
              COALESCE(SUM(status = 'pending'), 0) AS pending_orders,
              COALESCE(SUM(status = 'delivered'), 0) AS delivered_orders,
              COALESCE(SUM(status = 'cancelled'), 0) AS cancelled_orders
       FROM orders
       WHERE order_date = ?`,
      [deliveryDate]
    );
    const summary = (summaryRows as RowDataPacket[])[0]!;

    const [planRows] = await conn.query(
      `SELECT p.id AS plan_id, p.total_orders, p.total_boxes,
              p.revenue, p.food_cost, p.delivery_cost, p.profit,
              p.last_arrival_time, p.all_on_time,
              (SELECT COUNT(DISTINCT rr.rider_id)
               FROM rider_routes rr WHERE rr.plan_id = p.id) AS rider_count
       FROM delivery_plans p
       WHERE p.delivery_date = ?
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT 1`,
      [deliveryDate]
    );
    const plan = (planRows as RowDataPacket[])[0];
    const dashboard: DashboardModel = {
      delivery_date: deliveryDate,
      total_orders: Number(summary.total_orders),
      total_boxes: Number(summary.total_boxes),
      rider_count: plan ? Number(plan.rider_count) : 0,
      pending_orders: Number(summary.pending_orders),
      delivered_orders: Number(summary.delivered_orders),
      cancelled_orders: Number(summary.cancelled_orders),
      plan_matches_orders: false,
      latest_plan: null,
    };

    if (plan) {
      const foodCost = Number(plan.food_cost);
      const deliveryCost = Number(plan.delivery_cost);
      dashboard.latest_plan = {
        plan_id: Number(plan.plan_id),
        total_orders: Number(plan.total_orders),
        total_boxes: Number(plan.total_boxes),
        rider_count: Number(plan.rider_count),
        revenue: Number(plan.revenue),
        food_cost: foodCost,
        delivery_cost: deliveryCost,
        total_cost: Number((foodCost + deliveryCost).toFixed(2)),
        profit: Number(plan.profit),
        last_arrival_time: String(plan.last_arrival_time),
        all_on_time: Number(plan.all_on_time) === 1,
      };

      const [orderRows] = await conn.query(
        `SELECT o.id AS order_id, o.quantity,
                c.name AS customer_name, c.phone, c.address,
                c.latitude, c.longitude
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         WHERE o.order_date = ? AND o.status <> 'cancelled'
         ORDER BY o.id`,
        [deliveryDate]
      );
      const [stopRows] = await conn.query(
        `SELECT rs.order_id, rs.quantity, rs.customer_name, rs.phone,
                rs.address, rs.latitude, rs.longitude
         FROM route_stops rs
         JOIN rider_routes rr ON rr.id = rs.route_id
         WHERE rr.plan_id = ?
         ORDER BY rs.order_id`,
        [plan.plan_id]
      );
      const orders = orderRows as RowDataPacket[];
      const stops = stopRows as RowDataPacket[];

      // Compare the saved stop details with current orders and customers to detect a stale plan.
      dashboard.plan_matches_orders =
        Number(plan.total_orders) === orders.length &&
        Number(plan.total_boxes) === orders.reduce((total, order) => total + Number(order.quantity), 0) &&
        orders.length === stops.length &&
        orders.every((order, index) =>
          String(order.order_id) === String(stops[index]!.order_id) &&
          Number(order.quantity) === Number(stops[index]!.quantity) &&
          String(order.customer_name) === String(stops[index]!.customer_name) &&
          String(order.phone) === String(stops[index]!.phone) &&
          String(order.address) === String(stops[index]!.address) &&
          Number(order.latitude) === Number(stops[index]!.latitude) &&
          Number(order.longitude) === Number(stops[index]!.longitude)
        );
    }

    return res.json(dashboard);
  } catch (err: unknown) {
    console.error("getDashboard:", err);
    return res.status(500).json({ error: "Database error" });
  }
};
