import { Request, Response } from "express";
import { conn } from "../config/dbconnect";
import { ResultSetHeader, RowDataPacket } from "mysql2";
import {
  CalculatePlanBody,
  PendingOrderRow,
  RiderModel,
  ROUTE_COLORS,
  ShopModel,
} from "../models/deliveryPlanModel";

// ---------- helpers ----------
function toNum(v: string | number | unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function timeToMinutes(t: string): number {
  const parts = String(t).split(":");
  const h = Number(parts[0] ?? 0);
  const m = Number(parts[1] ?? 0);
  const s = Number(parts[2] ?? 0);
  return h * 60 + m + Math.floor(s / 60);
}

function minutesToTimeString(totalMinutes: number): string {
  const m = ((Math.round(totalMinutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

function isValidDateStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function isValidTimeStr(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
}

function normalizeTime(t: string): string {
  // รับ HH:MM หรือ HH:MM:SS -> คืน HH:MM:SS
  const p = String(t).split(":");
  const h = (p[0] ?? "11").padStart(2, "0");
  const m = (p[1] ?? "30").padStart(2, "0");
  const s = (p[2] ?? "00").padStart(2, "0");
  return `${h}:${m}:${s}`;
}

// ---------- GET /api/route/shop ----------
export const getShop = async (_req: Request, res: Response) => {
  try {
    const [rows] = await conn.query("SELECT * FROM shops WHERE id = 1");
    const list = rows as ShopModel[];
    if (list.length === 0) return res.status(404).json({ error: "Shop not found" });
    return res.json(list[0]);
  } catch (err: unknown) {
    console.error("getShop:", err);
    return res.status(500).json({ error: "Database error" });
  }
};

// ---------- GET /api/route/riders ----------
export const getRiders = async (_req: Request, res: Response) => {
  try {
    const [rows] = await conn.query(
      "SELECT id, name, phone FROM riders ORDER BY id"
    );
    return res.json(rows as RiderModel[]);
  } catch (err: unknown) {
    console.error("getRiders:", err);
    return res.status(500).json({ error: "Database error" });
  }
};

// ---------- GET /api/route/pending?date=YYYY-MM-DD ----------
export const getPendingOrders = async (req: Request, res: Response) => {
  try {
    const date = String(req.query.date ?? "").trim();
    let sql = `
      SELECT o.id, o.customer_id, o.quantity,
             DATE_FORMAT(o.order_date, '%Y-%m-%d') AS order_date,
             c.name AS customer_name, c.phone, c.address,
             c.latitude, c.longitude
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.status = 'pending'`;
    const params: unknown[] = [];
    if (date) {
      if (!isValidDateStr(date)) return res.status(400).json({ error: "Invalid date format (YYYY-MM-DD)" });
      sql += ` AND DATE(o.order_date) = ?`;
      params.push(date);
    }
    sql += ` ORDER BY o.id`;
    const [rows] = await conn.query(sql, params);
    return res.json(rows);
  } catch (err: unknown) {
    console.error("getPendingOrders:", err);
    return res.status(500).json({ error: "Database error" });
  }
};

// ---------- POST /api/route/calculate ----------
export const calculatePlan = async (req: Request, res: Response) => {
  const body = req.body as CalculatePlanBody;
  const deliveryDate = String(body.delivery_date ?? "").trim();
  const requestedRiders = Number(body.rider_count ?? 3);
  const departureTime = normalizeTime(String(body.departure_time ?? "11:30:00"));
  const deadlineTime = normalizeTime(String(body.deadline_time ?? "12:30:00"));
  const speedKmh = Number(body.speed_kmh ?? 30);
  const serviceMinutes = Number(body.service_minutes ?? 2);

  if (deliveryDate && !isValidDateStr(deliveryDate)) {
    return res.status(400).json({ error: "Invalid delivery_date (YYYY-MM-DD)" });
  }
  if (!Number.isInteger(requestedRiders) || requestedRiders < 1 || requestedRiders > 10) {
    return res.status(400).json({ error: "rider_count must be between 1 and 10" });
  }
  if (!isValidTimeStr(departureTime) || !isValidTimeStr(deadlineTime)) {
    return res.status(400).json({ error: "Invalid time format (HH:MM:SS)" });
  }
  if (timeToMinutes(deadlineTime) <= timeToMinutes(departureTime)) {
    return res.status(400).json({ error: "deadline_time must be after departure_time" });
  }
  if (!(speedKmh > 0 && speedKmh <= 120)) {
    return res.status(400).json({ error: "speed_kmh must be between 1 and 120" });
  }
  if (!Number.isInteger(serviceMinutes) || serviceMinutes < 0 || serviceMinutes > 30) {
    return res.status(400).json({ error: "service_minutes must be between 0 and 30" });
  }

  try {
    // 1. ร้าน
    const [shopRows] = await conn.query("SELECT * FROM shops WHERE id = 1");
    const shops = shopRows as ShopModel[];
    if (shops.length === 0) return res.status(500).json({ error: "Shop not configured" });
    const shop = shops[0]!;
    const shopLat = toNum(shop.latitude);
    const shopLng = toNum(shop.longitude);
    const pricePerBox = toNum(shop.price_per_box, 65);
    const costPerBox = toNum(shop.cost_per_box, 40);
    const baseFee = toNum(shop.rider_base_fee, 15);
    const perBoxKm = toNum(shop.rider_per_box_km, 2);

    // 2. ออเดอร์ pending (กรองตามวันที่ถ้าส่งมา)
    let orderSql = `
      SELECT o.id, o.customer_id, o.quantity,
             DATE_FORMAT(o.order_date, '%Y-%m-%d') AS order_date,
             c.name AS customer_name, c.phone, c.address,
             c.latitude, c.longitude
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.status = 'pending'`;
    const orderParams: unknown[] = [];
    if (deliveryDate) {
      orderSql += ` AND DATE(o.order_date) = ?`;
      orderParams.push(deliveryDate);
    }
    orderSql += ` ORDER BY o.id`;
    const [orderRows] = await conn.query(orderSql, orderParams);
    const orders = orderRows as PendingOrderRow[];
    if (orders.length === 0) {
      return res.status(400).json({ error: "No pending orders for this date" });
    }
    const effectiveDate =
      deliveryDate || String((orders[0] as unknown as { order_date: string }).order_date ?? new Date().toISOString().slice(0, 10));

    // 3. ไรเดอร์
    const [riderRows] = await conn.query(
      "SELECT id, name, phone FROM riders ORDER BY id"
    );
    const allRiders = riderRows as RiderModel[];
    if (allRiders.length === 0) return res.status(400).json({ error: "No riders available" });

    // กติกา: 1 เส้นทางห้ามเกิน 3 จุด (chk_stop_sequence) -> ต้องมีไรเดอร์อย่างน้อย ceil(orders/3)
    const minRequired = Math.ceil(orders.length / 3);
    const effectiveRiderCount = Math.max(requestedRiders, minRequired);
    if (effectiveRiderCount > allRiders.length) {
      return res.status(400).json({
        error: `Not enough riders (need ${effectiveRiderCount}, have ${allRiders.length})`,
      });
    }
    const riders = allRiders.slice(0, effectiveRiderCount);

    // 4. แบ่งออเดอร์: เรียงตามมุมจากร้าน แล้วตัดเป็นช่วงๆ แล้วจัดลำดับ nearest-neighbor ในแต่ละช่วง
    type Scored = PendingOrderRow & { angle: number; distFromShop: number };
    const scored: Scored[] = orders.map((o) => {
      const lat = toNum(o.latitude);
      const lng = toNum(o.longitude);
      return {
        ...o,
        angle: Math.atan2(lat - shopLat, lng - shopLng),
        distFromShop: haversineKm(shopLat, shopLng, lat, lng),
      };
    });
    scored.sort((a, b) => a.angle - b.angle);

    const chunks: Scored[][] = riders.map(() => []);
    // แจกแบบ round-robin ตามมุม เพื่อให้แต่ละคนได้โซนใกล้กันและไม่เกิน 3 จุด
    // วิธี: ตัดเป็นช่วงต่อเนื่อง chunkSize = ceil(n / k)
    const chunkSize = Math.ceil(scored.length / riders.length);
    riders.forEach((_, i) => {
      chunks[i] = scored.slice(i * chunkSize, (i + 1) * chunkSize);
    });

    // nearest-neighbor ภายในแต่ละไรเดอร์
    interface PlannedStop extends Scored {
      seqDist: number; // ระยะจากจุดก่อนหน้า
    }
    const plannedRoutes: PlannedStop[][] = chunks.map((chunk) => {
      const remaining = [...chunk];
      const ordered: PlannedStop[] = [];
      let curLat = shopLat;
      let curLng = shopLng;
      while (remaining.length > 0) {
        let best = 0;
        let bestD = Number.POSITIVE_INFINITY;
        remaining.forEach((o, idx) => {
          const d = haversineKm(curLat, curLng, toNum(o.latitude), toNum(o.longitude));
          if (d < bestD) {
            bestD = d;
            best = idx;
          }
        });
        const picked = remaining.splice(best, 1)[0]!;
        ordered.push({ ...picked, seqDist: bestD });
        curLat = toNum(picked.latitude);
        curLng = toNum(picked.longitude);
      }
      return ordered;
    });

    // 5. คำนวณเวลา/ต้นทุน
    const departureMin = timeToMinutes(departureTime);
    const deadlineMin = timeToMinutes(deadlineTime);

    let totalBoxes = 0;
    let totalDist = 0;
    let totalDeliveryCost = 0;
    let lastArrivalMin = departureMin;

    const routeSummaries = plannedRoutes.map((stops, i) => {
      const rider = riders[i]!;
      const boxes = stops.reduce((s, o) => s + Number(o.quantity), 0);
      const dist = stops.reduce((s, o) => s + o.seqDist, 0);
      const travelMin = (dist / speedKmh) * 60;
      const duration = Math.round(travelMin + serviceMinutes * stops.length);
      // arrival แต่ละจุด
      let acc = 0;
      let prevLat = shopLat;
      let prevLng = shopLng;
      const arrivals: string[] = [];
      stops.forEach((o) => {
        const d = haversineKm(prevLat, prevLng, toNum(o.latitude), toNum(o.longitude));
        acc += (d / speedKmh) * 60 + serviceMinutes;
        arrivals.push(minutesToTimeString(departureMin + acc));
        prevLat = toNum(o.latitude);
        prevLng = toNum(o.longitude);
      });
      const lastArr = arrivals.length > 0 ? timeToMinutes(arrivals[arrivals.length - 1]!) : departureMin;
      const cost = baseFee + perBoxKm * boxes * dist;
      totalBoxes += boxes;
      totalDist += dist;
      totalDeliveryCost += cost;
      if (lastArr > lastArrivalMin) lastArrivalMin = lastArr;
      const color = ROUTE_COLORS[i % ROUTE_COLORS.length]!;
      return { rider, stops, boxes, dist, duration, arrivals, cost, color };
    });

    const revenue = totalBoxes * pricePerBox;
    const foodCost = totalBoxes * costPerBox;
    const profit = revenue - foodCost - totalDeliveryCost;
    const lastArrivalTime = minutesToTimeString(lastArrivalMin);
    const allOnTime = lastArrivalMin <= deadlineMin ? 1 : 0;

    // 6. บันทึกลง DB (transaction)
    const poolConn = await conn.getConnection();
    try {
      await poolConn.beginTransaction();

      const [planResult] = await poolConn.query<ResultSetHeader>(
        `INSERT INTO delivery_plans
         (delivery_date, departure_time, deadline_time,
          rider_count, total_orders, total_boxes, distance_km,
          delivery_cost, revenue, food_cost, profit,
          last_arrival_time, all_on_time)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          effectiveDate,
          departureTime,
          deadlineTime,
          effectiveRiderCount,
          orders.length,
          totalBoxes,
          totalDist.toFixed(2),
          totalDeliveryCost.toFixed(2),
          revenue.toFixed(2),
          foodCost.toFixed(2),
          profit.toFixed(2),
          lastArrivalTime,
          allOnTime,
        ]
      );
      const planId = planResult.insertId;

      const routesOut: unknown[] = [];
      for (let i = 0; i < routeSummaries.length; i++) {
        const rs = routeSummaries[i]!;
        if (rs.stops.length === 0) continue;
        const jobCode = `JOB${String(planId).padStart(6, "0")}-${String(i + 1).padStart(2, "0")}`;
        const geometry = [
          [shopLat, shopLng],
          ...rs.stops.map((s) => [toNum(s.latitude), toNum(s.longitude)]),
        ];
        const navUrl =
          `https://www.google.com/maps/dir/` +
          [`${shopLat},${shopLng}`, ...rs.stops.map((s) => `${s.latitude},${s.longitude}`)].join("/");

        const [routeResult] = await poolConn.query<ResultSetHeader>(
          `INSERT INTO rider_routes
           (plan_id, rider_id, rider_number, job_code, color,
            total_boxes, distance_km, duration_minutes, delivery_cost, geometry, navigation_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            planId,
            rs.rider.id,
            i + 1,
            jobCode,
            rs.color,
            rs.boxes,
            rs.dist.toFixed(2),
            rs.duration,
            rs.cost.toFixed(2),
            JSON.stringify(geometry),
            navUrl,
          ]
        );
        const routeId = routeResult.insertId;

        for (let s = 0; s < rs.stops.length; s++) {
          const st = rs.stops[s]!;
          await poolConn.query(
            `INSERT INTO route_stops
             (route_id, order_id, stop_sequence, customer_name, phone, address,
              latitude, longitude, quantity, arrival_time, distance_from_previous_km)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              routeId,
              st.id,
              s + 1,
              st.customer_name,
              st.phone,
              st.address ?? "",
              st.latitude,
              st.longitude,
              st.quantity,
              rs.arrivals[s],
              (st.seqDist as number).toFixed(2),
            ]
          );
        }

        routesOut.push({
          route_id: routeId,
          rider_id: rs.rider.id,
          rider_number: i + 1,
          rider_name: rs.rider.name,
          rider_phone: rs.rider.phone,
          color: rs.color,
          total_boxes: rs.boxes,
          distance_km: Number(rs.dist.toFixed(2)),
          duration_minutes: rs.duration,
          delivery_cost: Number(rs.cost.toFixed(2)),
          job_code: jobCode,
          navigation_url: navUrl,
          geometry,
          stops: rs.stops.map((st, si) => ({
            order_id: st.id,
            stop_sequence: si + 1,
            customer_name: st.customer_name,
            phone: st.phone,
            address: st.address,
            latitude: toNum(st.latitude),
            longitude: toNum(st.longitude),
            quantity: Number(st.quantity),
            arrival_time: rs.arrivals[si],
            distance_from_previous_km: Number((st.seqDist as number).toFixed(2)),
          })),
        });
      }

      await poolConn.commit();

      return res.status(201).json({
        plan_id: planId,
        delivery_date: effectiveDate,
        departure_time: departureTime,
        deadline_time: deadlineTime,
        rider_count: effectiveRiderCount,
        total_orders: orders.length,
        total_boxes: totalBoxes,
        distance_km: Number(totalDist.toFixed(2)),
        delivery_cost: Number(totalDeliveryCost.toFixed(2)),
        revenue: Number(revenue.toFixed(2)),
        food_cost: Number(foodCost.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        last_arrival_time: lastArrivalTime,
        all_on_time: allOnTime === 1,
        shop: {
          name: shop.name,
          latitude: shopLat,
          longitude: shopLng,
        },
        routes: routesOut,
      });
    } catch (txErr) {
      await poolConn.rollback();
      throw txErr;
    } finally {
      poolConn.release();
    }
  } catch (err: unknown) {
    console.error("calculatePlan:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: "Database error", details: msg });
  }
};

// ---------- GET /api/route/plans ----------
export const getPlans = async (_req: Request, res: Response) => {
  try {
    const [rows] = await conn.query(
      `SELECT id, DATE_FORMAT(delivery_date, '%Y-%m-%d') AS delivery_date,
              departure_time, deadline_time, rider_count, total_orders, total_boxes,
              distance_km, delivery_cost, revenue, food_cost, profit,
              last_arrival_time, all_on_time, created_at
       FROM delivery_plans ORDER BY created_at DESC LIMIT 20`
    );
    return res.json(rows);
  } catch (err: unknown) {
    console.error("getPlans:", err);
    return res.status(500).json({ error: "Database error" });
  }
};

// ---------- GET /api/route/plans/:id ----------
export const getPlanById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const [planRows] = await conn.query(
      `SELECT id, DATE_FORMAT(delivery_date, '%Y-%m-%d') AS delivery_date,
              departure_time, deadline_time,
              rider_count, total_orders, total_boxes, distance_km, delivery_cost,
              revenue, food_cost, profit, last_arrival_time, all_on_time
       FROM delivery_plans WHERE id = ?`,
      [id]
    );
    const plans = planRows as RowDataPacket[];
    if (plans.length === 0) return res.status(404).json({ error: "Plan not found" });

    const [routeRows] = await conn.query(
      `SELECT rr.*, r.name AS rider_name, r.phone AS rider_phone
       FROM rider_routes rr
       JOIN riders r ON r.id = rr.rider_id
       WHERE rr.plan_id = ? ORDER BY rr.rider_number`,
      [id]
    );
    const routes = routeRows as RowDataPacket[];

    for (const r of routes) {
      const [stopRows] = await conn.query(
        `SELECT order_id, stop_sequence, customer_name, phone, address,
                latitude, longitude, quantity, arrival_time, distance_from_previous_km
         FROM route_stops WHERE route_id = ? ORDER BY stop_sequence`,
        [(r as { id: number }).id]
      );
      (r as Record<string, unknown>).stops = stopRows;
      // parse geometry ถ้าเป็น string
      const g = (r as Record<string, unknown>).geometry;
      if (typeof g === "string") {
        try {
          (r as Record<string, unknown>).geometry = JSON.parse(g);
        } catch {
          /* keep raw */
        }
      }
    }

    return res.json({ ...(plans[0] as object), routes });
  } catch (err: unknown) {
    console.error("getPlanById:", err);
    return res.status(500).json({ error: "Database error" });
  }
};
