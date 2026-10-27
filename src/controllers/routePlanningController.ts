import { Request, Response } from "express";
import { conn } from "../config/dbconnect";
import { ResultSetHeader } from "mysql2";
import { ShopModel } from "../models/deliveryPlanModel";
import { RiderModel } from "../models/riderModel";
import { PendingOrderModel } from "../models/orderModel";

interface RoutePoint {
  latitude: number;
  longitude: number;
}

interface RoadMatrixResponse {
  code: string;
  distances?: (number | null)[][];
  durations?: (number | null)[][];
}

interface RoadRoute {
  distance: number;
  duration: number;
  geometry: {
    coordinates: [number, number][];
  };
  legs: {
    distance: number;
    duration: number;
  }[];
}

interface OsrmRouteResponse {
  code: string;
  routes: RoadRoute[];
}

async function getRoadRoute(
  points: { latitude: number; longitude: number }[]
): Promise<RoadRoute> {
  const coordinates = points
    .map((point) => `${point.longitude},${point.latitude}`)
    .join(';');

  const url =
    `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
    '?overview=full&geometries=geojson&steps=false';

  const response = await fetch(url);
  const data = (await response.json()) as OsrmRouteResponse;

  if (!response.ok || data.code !== 'Ok' || data.routes.length === 0) {
    throw new Error('หาเส้นทางถนนไม่พบ');
  }

  return data.routes[0]!;
}

async function getRoadMatrix(points: RoutePoint[]) {
  const coordinates = points
    .map((point) => `${point.longitude},${point.latitude}`)
    .join(';');

  const url =
    `https://router.project-osrm.org/table/v1/driving/${coordinates}` +
    '?annotations=distance,duration';

  const response = await fetch(url);
  const data = (await response.json()) as RoadMatrixResponse;

  if (!response.ok || data.code !== 'Ok' || !data.distances || !data.durations) {
    throw new Error('หาเส้นทางถนนระหว่างจุดไม่ได้');
  }

  return {
    distances: data.distances,
    durations: data.durations
  };
}

function isValidDateStr(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function formatSqlTime(totalMinutes: number): string {
  const minutesInDay = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = String(Math.floor(minutesInDay / 60)).padStart(2, "0");
  const minutes = String(minutesInDay % 60).padStart(2, "0");
  return `${hours}:${minutes}:00`;
}

// ---------- GET /api/plans/shop ----------
export const getShop = async (_req: Request, res: Response) => {
  try {
    const [rows] = await conn.query("SELECT * FROM shops WHERE id = 1");
    const shops = rows as ShopModel[];
    if (shops.length === 0) return res.status(404).json({ error: "Shop not found" });
    return res.json(shops[0]);
  } catch (err: unknown) {
    console.error("getShop:", err);
    return res.status(500).json({ error: "Database error" });
  }
};

// ---------- GET /api/plans/riders ----------
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

// ---------- GET /api/plans/pending?date=YYYY-MM-DD ----------
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
      if (!isValidDateStr(date)) {
        return res.status(400).json({ error: "Invalid date format (YYYY-MM-DD)" });
      }
      sql += " AND DATE(o.order_date) = ?";
      params.push(date);
    }
    sql += " ORDER BY o.id";
    const [rows] = await conn.query(sql, params);
    return res.json(rows);
  } catch (err: unknown) {
    console.error("getPendingOrders:", err);
    return res.status(500).json({ error: "Database error" });
  }
};

export const calculatePlan = async (req: Request, res: Response) => {
  const deliveryDate = String(req.body.delivery_date ?? '').trim();
  const riderCount = Number(req.body.rider_count);

  if (!isValidDateStr(deliveryDate)) {
    return res.status(400).json({
      error: 'delivery_date ต้องเป็นวันที่รูปแบบ YYYY-MM-DD'
    });
  }

  if (!Number.isInteger(riderCount) || riderCount < 1 || riderCount > 10) {
    return res.status(400).json({
      error: 'rider_count ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 10'
    });
  }

  try {
    const [shopRows] = await conn.query(
      `SELECT id, name, latitude, longitude, price_per_box, cost_per_box,
              rider_base_fee, rider_per_box_km
       FROM shops WHERE id = 1`
    );
    const shops = shopRows as ShopModel[];
    const shop = shops[0];

    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const sql = `
      SELECT o.id, o.customer_id, o.quantity,
      c.name AS customer_name, c.phone, c.address,
      c.latitude, c.longitude
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.status = 'pending'
      AND DATE(o.order_date) = ?
      ORDER BY o.id
    `

    const [ordersQuery] = await conn.query(sql, [deliveryDate]);

    const orders = ordersQuery as PendingOrderModel[];

    if (orders.length === 0) {
      return res.status(400).json({
        error: 'ไม่มีออเดอร์ pending ในวันที่เลือก'
      });
    }

    const [ridersQuery] = await conn.query(
      'SELECT id, name, phone FROM riders ORDER BY id'
    );

    const riders = ridersQuery as RiderModel[];

    if (riders.length < riderCount) {
      return res.status(400).json({
        error: `เลือกไรเดอร์ ${riderCount} คน แต่ในระบบมีแค่ ${riders.length} คน`
      });
    }

    if (orders.length > riderCount * 3) {
      return res.status(400).json({
        error: `มี ${orders.length} ออเดอร์ แต่ไรเดอร์ ${riderCount} คนรับได้สูงสุด ${riderCount * 3} จุด`
      });
    }

    const routePoints = [
      {
        latitude: Number(shop.latitude),
        longitude: Number(shop.longitude)
      },
      ...orders.map((order) => ({
        latitude: Number(order.latitude),
        longitude: Number(order.longitude)
      }))
    ];

    const { distances, durations } = await getRoadMatrix(routePoints);

    const remainingOrders = orders.map((order, index) => ({
      order,
      pointIndex: index + 1,
    }));

    const routes = riders.slice(0, riderCount).map((rider, riderIndex) => {
      const stops: PendingOrderModel[] = [];
      const ridersLeft = riderCount - riderIndex;
      const targetStops = Math.min(
        3,
        Math.ceil(remainingOrders.length / ridersLeft)
      );
      let currentPoint = 0;
      let totalDistanceMeters = 0;
      let totalDurationSeconds = 0;

      while (stops.length < targetStops && remainingOrders.length > 0) {
        let nearestIndex = -1;
        let shortestDistance = Infinity;
        let nearestDuration = 0;

        for (let i = 0; i < remainingOrders.length; i++) {
          const candidate = remainingOrders[i]!;
          const distance = distances[currentPoint]?.[candidate.pointIndex];
          const duration = durations[currentPoint]?.[candidate.pointIndex];

          if (
            distance !== null &&
            distance !== undefined &&
            duration !== null &&
            duration !== undefined &&
            distance < shortestDistance
          ) {
            shortestDistance = distance;
            nearestDuration = duration;
            nearestIndex = i;
          }
        }

        if (nearestIndex === -1) break;

        const next = remainingOrders.splice(nearestIndex, 1)[0];
        if (!next) break;

        stops.push(next.order);
        totalDistanceMeters += shortestDistance;
        totalDurationSeconds += nearestDuration;
        currentPoint = next.pointIndex;
      }

      const totalBoxes = stops.reduce(
        (sum, stop) => sum + Number(stop.quantity),
        0
      );
      const travelMinutes = Math.ceil(totalDurationSeconds / 60);

      return {
        rider,
        total_boxes: totalBoxes,
        stops: stops.map((stop, index) => ({
          ...stop,
          stop_sequence: index + 1
        })),
        distance_km: Number((totalDistanceMeters / 1000).toFixed(2)),
        travel_minutes: travelMinutes,
      };
    });

    if (remainingOrders.length > 0) {
      return res.status(400).json({
        error: 'หาเส้นทางไปยังออเดอร์บางรายการไม่ได้',
        unassigned_order_ids: remainingOrders.map((item) => item.order.id)
      });
    }

    const routesWithGeometry = await Promise.all(
      routes.map(async (route) => {
        if (route.stops.length === 0) {
          return { ...route, geometry: [] }
        }

        const points = [
          {
            latitude: Number(shop.latitude),
            longitude: Number(shop.longitude)
          },
          ...route.stops.map((stop) => ({
            latitude: Number(stop.latitude),
            longitude: Number(stop.longitude)
          }))
        ];

        const roadRoute = await getRoadRoute(points);

        return {
          ...route,
          distance_km: Number((roadRoute.distance / 1000).toFixed(2)),
          travel_minutes: Math.ceil(roadRoute.duration / 60),
          geometry: roadRoute.geometry.coordinates.map(
            ([longitude, latitude]) => [latitude, longitude]
          ),
        }
      })
    );

    const activeRoutes = routesWithGeometry.filter((route) => route.stops.length > 0);
    const totalBoxes = activeRoutes.reduce((sum, route) => sum + route.total_boxes, 0);
    const totalDistanceKm = activeRoutes.reduce((sum, route) => sum + route.distance_km, 0);
    const pricePerBox = Number(shop.price_per_box);
    const costPerBox = Number(shop.cost_per_box);
    const riderBaseFee = Number(shop.rider_base_fee);
    const riderPerBoxKm = Number(shop.rider_per_box_km);
    const routeCosts = activeRoutes.map((route) =>
      riderBaseFee + riderPerBoxKm * route.total_boxes * route.distance_km
    );
    const totalDeliveryCost = routeCosts.reduce((sum, cost) => sum + cost, 0);
    const revenue = totalBoxes * pricePerBox;
    const foodCost = totalBoxes * costPerBox;
    const profit = revenue - foodCost - totalDeliveryCost;
    const longestRouteMinutes = Math.max(...activeRoutes.map((route) => route.travel_minutes));
    const lastArrivalTime = formatSqlTime(11 * 60 + 30 + longestRouteMinutes);
    const allOnTime = activeRoutes.every((route) => route.travel_minutes <= 60);

    const connection = await conn.getConnection();
    let planId = 0;
    const savedRoutes: Record<string, unknown>[] = [];

    try {
      await connection.beginTransaction();

      const [planResult] = await connection.query<ResultSetHeader>(
        `INSERT INTO delivery_plans
         (delivery_date, departure_time, deadline_time, rider_count, total_orders,
          total_boxes, distance_km, delivery_cost, revenue, food_cost, profit,
          last_arrival_time, all_on_time)
         VALUES (?, '11:30:00', '12:30:00', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          deliveryDate,
          riderCount,
          orders.length,
          totalBoxes,
          totalDistanceKm.toFixed(2),
          totalDeliveryCost.toFixed(2),
          revenue.toFixed(2),
          foodCost.toFixed(2),
          profit.toFixed(2),
          lastArrivalTime,
          allOnTime
        ]
      );
      planId = planResult.insertId;

      const routeColors = ["#dc2626", "#16a34a", "#2563eb", "#9333ea", "#ea580c", "#0891b2", "#c2410c", "#4f46e5", "#65a30d", "#db2777"];
      const orderPointIndexes = new Map(orders.map((order, index) => [order.id, index + 1]));

      for (let routeIndex = 0; routeIndex < routesWithGeometry.length; routeIndex++) {
        const route = routesWithGeometry[routeIndex]!;
        if (route.stops.length === 0) continue;

        const riderNumber = routeIndex + 1;
        const jobCode = `JOB${String(planId).padStart(6, "0")}-${String(riderNumber).padStart(2, "0")}`;
        const color = routeColors[routeIndex % routeColors.length]!;
        const routeCost = routeCosts[activeRoutes.indexOf(route)]!;
        const navigationUrl = `https://www.google.com/maps/dir/${[
          `${shop.latitude},${shop.longitude}`,
          ...route.stops.map((stop) => `${stop.latitude},${stop.longitude}`)
        ].join("/")}`;

        const [routeResult] = await connection.query<ResultSetHeader>(
          `INSERT INTO rider_routes
           (plan_id, rider_id, rider_number, job_code, color, total_boxes,
            distance_km, duration_minutes, delivery_cost, geometry, navigation_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            planId,
            route.rider.id,
            riderNumber,
            jobCode,
            color,
            route.total_boxes,
            route.distance_km.toFixed(2),
            route.travel_minutes,
            routeCost.toFixed(2),
            JSON.stringify(route.geometry),
            navigationUrl
          ]
        );
        const routeId = routeResult.insertId;

        let previousPointIndex = 0;
        let elapsedSeconds = 0;
        for (const stop of route.stops) {
          const pointIndex = orderPointIndexes.get(stop.id);
          if (pointIndex === undefined) {
            throw new Error(`ไม่พบพิกัดของออเดอร์ ${stop.id}`);
          }

          const legDistance = distances[previousPointIndex]?.[pointIndex];
          const legDuration = durations[previousPointIndex]?.[pointIndex];
          if (legDistance == null || legDuration == null) {
            throw new Error(`หาเวลา/ระยะทางของออเดอร์ ${stop.id} ไม่พบ`);
          }
          elapsedSeconds += legDuration;

          await connection.query(
            `INSERT INTO route_stops
             (route_id, order_id, stop_sequence, customer_name, phone, address,
              latitude, longitude, quantity, arrival_time, distance_from_previous_km)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              routeId,
              stop.id,
              stop.stop_sequence,
              stop.customer_name,
              stop.phone ?? "",
              stop.address ?? "",
              Number(stop.latitude),
              Number(stop.longitude),
              stop.quantity,
              formatSqlTime(11 * 60 + 30 + Math.ceil(elapsedSeconds / 60)),
              (legDistance / 1000).toFixed(2)
            ]
          );
          previousPointIndex = pointIndex;
        }

        savedRoutes.push({
          ...route,
          plan_id: planId,
          route_id: routeId,
          job_code: jobCode,
          color,
          delivery_cost: Number(routeCost.toFixed(2)),
          navigation_url: navigationUrl
        });
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return res.json({
      plan_id: planId,
      delivery_date: deliveryDate,
      rider_count: riderCount,
      total_orders: orders.length,
      total_boxes: totalBoxes,
      distance_km: Number(totalDistanceKm.toFixed(2)),
      delivery_cost: Number(totalDeliveryCost.toFixed(2)),
      revenue: Number(revenue.toFixed(2)),
      food_cost: Number(foodCost.toFixed(2)),
      profit: Number(profit.toFixed(2)),
      last_arrival_time: lastArrivalTime,
      all_on_time: allOnTime,
      routes: savedRoutes
    });
  } catch (error: unknown) {
    console.error('calculatePlan:', error);
    return res.status(500).json({
      error: 'คำนวณเส้นทางไม่สำเร็จ',
      details: error instanceof Error ? error.message : String(error)
    });
  }

};

