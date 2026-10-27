import { Request, Response } from "express";
import { conn } from "../config/dbconnect";
import { ResultSetHeader, RowDataPacket } from "mysql2";
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

function getTodayDateBangkok(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
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
  durations: DistanceMatrix,
  excludedOrderSequence?: number[],
  excludedPointSequence?: string[]
): RoutePathResult | null {
  let bestPath: RoutePathResult | null = null;

  for (const orderSequence of getPermutations(routeOrders)) {
    if (
      excludedOrderSequence &&
      orderSequence.length === excludedOrderSequence.length &&
      orderSequence.every((order, index) => order.id === excludedOrderSequence[index])
    ) {
      continue;
    }
    if (excludedPointSequence && samePointSequence(getPointSequence(orderSequence), excludedPointSequence)) {
      continue;
    }

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

function getPointSequence(orders: PendingOrderModel[]): string[] {
  return orders.map((order) =>
    `${Number(order.latitude).toFixed(6)},${Number(order.longitude).toFixed(6)}`
  );
}

function samePointSequence(first: string[] | undefined, second: string[] | undefined): boolean {
  return Boolean(first && second && first.length === second.length &&
    first.every((point, index) => point === second[index]));
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

// ---------- GET /api/plans/current ----------
export const getCurrentPlan = async (_req: Request, res: Response) => {
  try {
    const deliveryDate = getTodayDateBangkok();
    const [planRows] = await conn.query<RowDataPacket[]>(
      `SELECT id, DATE_FORMAT(delivery_date, '%Y-%m-%d') AS delivery_date,
              rider_count, total_orders, total_boxes, distance_km, delivery_cost,
              revenue, food_cost, profit, TIME_FORMAT(last_arrival_time, '%H:%i:%s') AS last_arrival_time,
              all_on_time
       FROM delivery_plans
       WHERE delivery_date = ? AND is_active = TRUE
       ORDER BY id DESC
       LIMIT 1`,
      [deliveryDate]
    );

    const plan = planRows[0];
    if (!plan) {
      return res.status(404).json({ error: 'วันนี้ยังไม่มีแผนจัดส่ง' });
    }

    const [routeRows] = await conn.query<RowDataPacket[]>(
      `SELECT rr.id AS route_id, rr.plan_id, rr.rider_number, rr.job_code,
              rr.color, rr.total_boxes, rr.distance_km,
              rr.duration_minutes AS travel_minutes, rr.delivery_cost,
              rr.geometry, rr.navigation_url,
              r.id AS rider_id, r.name AS rider_name, r.phone AS rider_phone
       FROM rider_routes rr
       JOIN riders r ON r.id = rr.rider_id
       WHERE rr.plan_id = ?
       ORDER BY rr.rider_number`,
      [plan.id]
    );

    const routeIds = routeRows.map((route) => Number(route.route_id));
    let stopsByRoute = new Map<number, RowDataPacket[]>();

    if (routeIds.length > 0) {
      const placeholders = routeIds.map(() => '?').join(', ');
      const [stopRows] = await conn.query<RowDataPacket[]>(
        `SELECT rs.route_id, rs.order_id AS id, o.customer_id,
                rs.stop_sequence, rs.customer_name, rs.phone, rs.address,
                rs.latitude, rs.longitude, rs.quantity,
                TIME_FORMAT(rs.arrival_time, '%H:%i:%s') AS arrival_time,
                rs.distance_from_previous_km
         FROM route_stops rs
         JOIN orders o ON o.id = rs.order_id
         WHERE rs.route_id IN (${placeholders})
         ORDER BY rs.route_id, rs.stop_sequence`,
        routeIds
      );

      stopsByRoute = new Map<number, RowDataPacket[]>();
      for (const stop of stopRows) {
        const routeId = Number(stop.route_id);
        const routeStops = stopsByRoute.get(routeId) ?? [];
        routeStops.push(stop);
        stopsByRoute.set(routeId, routeStops);
      }
    }

    const routes = routeRows.map((route) => {
      let geometry: unknown = route.geometry;
      if (typeof geometry === 'string') {
        try {
          geometry = JSON.parse(geometry);
        } catch {
          geometry = [];
        }
      }

      return {
        plan_id: Number(route.plan_id),
        route_id: Number(route.route_id),
        job_code: route.job_code,
        color: route.color,
        delivery_cost: Number(route.delivery_cost),
        navigation_url: route.navigation_url,
        rider: {
          id: Number(route.rider_id),
          name: route.rider_name,
          phone: route.rider_phone
        },
        total_boxes: Number(route.total_boxes),
        stops: (stopsByRoute.get(Number(route.route_id)) ?? []).map((stop) => ({
          id: Number(stop.id),
          customer_id: Number(stop.customer_id),
          quantity: Number(stop.quantity),
          customer_name: stop.customer_name,
          phone: stop.phone,
          address: stop.address,
          latitude: Number(stop.latitude),
          longitude: Number(stop.longitude),
          stop_sequence: Number(stop.stop_sequence),
          arrival_time: stop.arrival_time,
          distance_from_previous_km: Number(stop.distance_from_previous_km)
        })),
        distance_km: Number(route.distance_km),
        travel_minutes: Number(route.travel_minutes),
        geometry
      };
    });

    return res.json({
      plan_id: Number(plan.id),
      delivery_date: plan.delivery_date,
      rider_count: Number(plan.rider_count),
      total_orders: Number(plan.total_orders),
      total_boxes: Number(plan.total_boxes),
      distance_km: Number(plan.distance_km),
      delivery_cost: Number(plan.delivery_cost),
      revenue: Number(plan.revenue),
      food_cost: Number(plan.food_cost),
      profit: Number(plan.profit),
      last_arrival_time: plan.last_arrival_time,
      all_on_time: Boolean(plan.all_on_time),
      routes
    });
  } catch (error: unknown) {
    console.error('getCurrentPlan:', error);
    return res.status(500).json({ error: 'โหลดแผนจัดส่งปัจจุบันไม่สำเร็จ' });
  }
};

export const calculatePlan = async (_req: Request, res: Response) => {
  const deliveryDate = getTodayDateBangkok();

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

    const riderCount = Math.ceil(orders.length / 3);
    if (riderCount > 10) {
      return res.status(400).json({
        error: `มี ${orders.length} ออเดอร์ ต้องใช้ไรเดอร์ ${riderCount} คน ซึ่งเกินขีดจำกัด 10 คน (สูงสุด 30 ออเดอร์)`
      });
    }

    const [ridersQuery] = await conn.query(
      'SELECT id, name, phone FROM riders ORDER BY id'
    );

    const riders = ridersQuery as RiderModel[];

    if (riders.length < riderCount) {
      return res.status(400).json({
        error: `ออเดอร์ ${orders.length} รายการต้องใช้ไรเดอร์ ${riderCount} คน แต่ในระบบมีแค่ ${riders.length} คน`
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

    // ถ้าผลที่คำนวณได้เหมือนแผน active เดิม ให้เลือกทางเลือกถัดไปที่ต้นทุนใกล้ที่สุด
    const [previousStops] = await conn.query<RowDataPacket[]>(
      `SELECT rr.rider_id, rs.order_id, rs.stop_sequence, rs.latitude, rs.longitude
       FROM delivery_plans p
       JOIN rider_routes rr ON rr.plan_id = p.id
       JOIN route_stops rs ON rs.route_id = rr.id
       WHERE p.delivery_date = ? AND p.is_active = TRUE
       ORDER BY rr.rider_number, rs.stop_sequence`,
      [deliveryDate]
    );

    const previousPointSequenceByRider = new Map<number, string[]>();
    for (const stop of previousStops) {
      const riderId = Number(stop.rider_id);
      const pointSequence = previousPointSequenceByRider.get(riderId) ?? [];
      pointSequence.push(
        `${Number(stop.latitude).toFixed(6)},${Number(stop.longitude).toFixed(6)}`
      );
      previousPointSequenceByRider.set(riderId, pointSequence);
    }

    const sameAsPreviousPlan = previousStops.length === orders.length &&
      selectedRiders.every((rider, riderIndex) =>
        samePointSequence(
          getPointSequence(routePaths[riderIndex]!.orders),
          previousPointSequenceByRider.get(rider.id)
        )
      );

    if (sameAsPreviousPlan) {
      let bestAlternative: {
        firstRoute: number;
        secondRoute: number;
        firstPath: RoutePathResult;
        secondPath: RoutePathResult;
        costScore: number;
        distanceMeters: number;
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

              const candidatePointSequences = routePaths.map((path) => getPointSequence(path!.orders));
              candidatePointSequences[firstRoute] = getPointSequence(firstPath.orders);
              candidatePointSequences[secondRoute] = getPointSequence(secondPath.orders);
              const sameAsSavedGeometry = selectedRiders.every((rider, riderIndex) =>
                samePointSequence(
                  candidatePointSequences[riderIndex],
                  previousPointSequenceByRider.get(rider.id)
                )
              );
              if (sameAsSavedGeometry) continue;

              const costScore = getBoxDistanceScore(firstPath) + getBoxDistanceScore(secondPath);
              const distanceMeters = firstPath.distanceMeters + secondPath.distanceMeters;
              if (
                !bestAlternative ||
                costScore < bestAlternative.costScore ||
                (costScore === bestAlternative.costScore && distanceMeters < bestAlternative.distanceMeters)
              ) {
                bestAlternative = {
                  firstRoute,
                  secondRoute,
                  firstPath,
                  secondPath,
                  costScore,
                  distanceMeters
                };
              }
            }
          }
        }
      }

      if (bestAlternative) {
        assignedOrders[bestAlternative.firstRoute] = bestAlternative.firstPath.orders;
        assignedOrders[bestAlternative.secondRoute] = bestAlternative.secondPath.orders;
        routePaths[bestAlternative.firstRoute] = bestAlternative.firstPath;
        routePaths[bestAlternative.secondRoute] = bestAlternative.secondPath;
      } else if (assignedOrders.length === 1) {
        const riderId = selectedRiders[0]!.id;
        const previousPointSequence = previousPointSequenceByRider.get(riderId);
        const alternativePath = getBestRoutePath(
          assignedOrders[0]!, pointIndexes, distances, durations, undefined, previousPointSequence
        );
        if (alternativePath) {
          assignedOrders[0] = alternativePath.orders;
          routePaths[0] = alternativePath;
        }
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

