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

type DistanceMatrix = (number | null)[][];

interface RoutePathResult {
  orders: PendingOrderModel[];
  distanceMeters: number;
  durationSeconds: number;
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

function getPermutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];

  const permutations: T[][] = [];
  for (let index = 0; index < items.length; index++) {
    const first = items[index]!;
    const rest = items.filter((_, itemIndex) => itemIndex !== index);
    for (const tail of getPermutations(rest)) {
      permutations.push([first, ...tail]);
    }
  }
  return permutations;
}

function getBestRoutePath(
  routeOrders: PendingOrderModel[],
  pointIndexes: Map<number, number>,
  distances: DistanceMatrix,
  durations: DistanceMatrix
): RoutePathResult | null {
  let bestPath: RoutePathResult | null = null;

  for (const orderSequence of getPermutations(routeOrders)) {
    let previousPoint = 0;
    let distanceMeters = 0;
    let durationSeconds = 0;
    let valid = true;

    for (const order of orderSequence) {
      const pointIndex = pointIndexes.get(order.id);
      const distance = pointIndex === undefined ? null : distances[previousPoint]?.[pointIndex];
      const duration = pointIndex === undefined ? null : durations[previousPoint]?.[pointIndex];

      if (distance == null || duration == null) {
        valid = false;
        break;
      }

      distanceMeters += distance;
      durationSeconds += duration;
      previousPoint = pointIndex!;
    }

    if (!valid) continue;
    if (
      !bestPath ||
      distanceMeters < bestPath.distanceMeters ||
      (distanceMeters === bestPath.distanceMeters && durationSeconds < bestPath.durationSeconds)
    ) {
      bestPath = { orders: orderSequence, distanceMeters, durationSeconds };
    }
  }

  return bestPath;
}

function getBoxDistanceScore(path: RoutePathResult): number {
  const boxes = path.orders.reduce((sum, order) => sum + Number(order.quantity), 0);
  return path.distanceMeters * boxes;
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

    const pointIndexes = new Map(orders.map((order, index) => [order.id, index + 1]));
    const activeRiderCount = Math.min(riderCount, orders.length);
    const selectedRiders = riders.slice(0, activeRiderCount);
    const baseStopsPerRider = Math.floor(orders.length / activeRiderCount);
    const extraStops = orders.length % activeRiderCount;
    const targetStops = selectedRiders.map((_, index) =>
      baseStopsPerRider + (index < extraStops ? 1 : 0)
    );
    const assignedOrders: PendingOrderModel[][] = selectedRiders.map(() => []);

    // วางออเดอร์ที่มีระยะทาง x กล่องสูงก่อน แล้วเลือกกลุ่มที่เพิ่มค่าส่งน้อยที่สุด
    const ordersByDistance = [...orders].sort((a, b) => {
      const aDistance = distances[0]?.[pointIndexes.get(a.id)!] ?? -1;
      const bDistance = distances[0]?.[pointIndexes.get(b.id)!] ?? -1;
      return bDistance * Number(b.quantity) - aDistance * Number(a.quantity) || a.id - b.id;
    });

    for (const order of ordersByDistance) {
      let bestRiderIndex = -1;
      let bestPath: RoutePathResult | null = null;
      let smallestAddedCostScore = Infinity;

      for (let riderIndex = 0; riderIndex < selectedRiders.length; riderIndex++) {
        if (assignedOrders[riderIndex]!.length >= targetStops[riderIndex]!) continue;

        const currentPath = getBestRoutePath(
          assignedOrders[riderIndex]!, pointIndexes, distances, durations
        );
        const candidatePath = getBestRoutePath(
          [...assignedOrders[riderIndex]!, order], pointIndexes, distances, durations
        );
        if (!currentPath || !candidatePath) continue;

        const addedCostScore = getBoxDistanceScore(candidatePath) - getBoxDistanceScore(currentPath);
        if (
          addedCostScore < smallestAddedCostScore ||
          (addedCostScore === smallestAddedCostScore && candidatePath.durationSeconds < (bestPath?.durationSeconds ?? Infinity))
        ) {
          bestRiderIndex = riderIndex;
          bestPath = candidatePath;
          smallestAddedCostScore = addedCostScore;
        }
      }

      if (bestRiderIndex < 0 || !bestPath) {
        return res.status(400).json({
          error: `หาเส้นทางถนนสำหรับออเดอร์ ${order.id} ไม่ได้`,
          unassigned_order_ids: [order.id]
        });
      }
      assignedOrders[bestRiderIndex] = bestPath.orders;
    }

    // สลับออเดอร์ข้ามไรเดอร์เพื่อหาการแบ่งกลุ่มที่ลดค่าส่งรวม โดยระยะทางเป็นตัวตัดสินรอง
    let routePaths = assignedOrders.map((group) =>
      getBestRoutePath(group, pointIndexes, distances, durations)
    );
    let improved = true;
    let optimizationRounds = 0;

    while (improved && optimizationRounds < 100) {
      improved = false;
      optimizationRounds++;
      let bestSwap: {
        firstRoute: number;
        secondRoute: number;
        firstOrder: number;
        secondOrder: number;
        firstPath: RoutePathResult;
        secondPath: RoutePathResult;
        improvement: number;
        distanceImprovement: number;
      } | null = null;

      for (let firstRoute = 0; firstRoute < assignedOrders.length; firstRoute++) {
        for (let secondRoute = firstRoute + 1; secondRoute < assignedOrders.length; secondRoute++) {
          for (let firstOrder = 0; firstOrder < assignedOrders[firstRoute]!.length; firstOrder++) {
            for (let secondOrder = 0; secondOrder < assignedOrders[secondRoute]!.length; secondOrder++) {
              const firstGroup = [...assignedOrders[firstRoute]!];
              const secondGroup = [...assignedOrders[secondRoute]!];
              [firstGroup[firstOrder], secondGroup[secondOrder]] =
                [secondGroup[secondOrder]!, firstGroup[firstOrder]!];

              const firstPath = getBestRoutePath(firstGroup, pointIndexes, distances, durations);
              const secondPath = getBestRoutePath(secondGroup, pointIndexes, distances, durations);
              if (!firstPath || !secondPath) continue;

              const oldFirstPath = routePaths[firstRoute]!;
              const oldSecondPath = routePaths[secondRoute]!;
              const improvement = getBoxDistanceScore(oldFirstPath) + getBoxDistanceScore(oldSecondPath)
                - getBoxDistanceScore(firstPath) - getBoxDistanceScore(secondPath);
              const distanceImprovement = oldFirstPath.distanceMeters + oldSecondPath.distanceMeters
                - firstPath.distanceMeters - secondPath.distanceMeters;
              if (
                improvement > 0 &&
                (!bestSwap || improvement > bestSwap.improvement ||
                  (improvement === bestSwap.improvement && distanceImprovement > bestSwap.distanceImprovement))
              ) {
                bestSwap = {
                  firstRoute,
                  secondRoute,
                  firstOrder,
                  secondOrder,
                  firstPath,
                  secondPath,
                  improvement,
                  distanceImprovement
                };
              }
            }
          }
        }
      }

      if (bestSwap) {
        assignedOrders[bestSwap.firstRoute] = bestSwap.firstPath.orders;
        assignedOrders[bestSwap.secondRoute] = bestSwap.secondPath.orders;
        routePaths[bestSwap.firstRoute] = bestSwap.firstPath;
        routePaths[bestSwap.secondRoute] = bestSwap.secondPath;
        improved = true;
      }
    }

    const routes = selectedRiders.map((rider, riderIndex) => {
      const path = routePaths[riderIndex];
      if (!path) throw new Error(`หาเส้นทางของไรเดอร์ ${rider.id} ไม่ได้`);

      const totalBoxes = path.orders.reduce((sum, order) => sum + Number(order.quantity), 0);
      return {
        rider,
        total_boxes: totalBoxes,
        stops: path.orders.map((stop, index) => ({
          ...stop,
          stop_sequence: index + 1
        })),
        distance_km: Number((path.distanceMeters / 1000).toFixed(2)),
        travel_minutes: Math.ceil(path.durationSeconds / 60)
      };
    });

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

      // การคำนวณซ้ำแทนแผนที่ใช้งานอยู่ของวันเดียวกัน แต่เก็บแผนเก่าไว้
      await connection.query(
        `UPDATE delivery_plans
         SET is_active = FALSE
         WHERE delivery_date = ? AND is_active = TRUE`,
        [deliveryDate]
      );

      const [planResult] = await connection.query<ResultSetHeader>(
        `INSERT INTO delivery_plans
         (delivery_date, departure_time, deadline_time, rider_count, total_orders,
          total_boxes, distance_km, delivery_cost, revenue, food_cost, profit,
          last_arrival_time, all_on_time)
         VALUES (?, '11:30:00', '12:30:00', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          deliveryDate,
          activeRiderCount,
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
      rider_count: activeRiderCount,
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

