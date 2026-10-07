export interface ShopModel {
  id: number;
  name: string;
  latitude: string | number;
  longitude: string | number;
  price_per_box: string | number;
  cost_per_box: string | number;
  rider_base_fee: string | number;
  rider_per_box_km: string | number;
}

export interface RiderModel {
  id: number;
  name: string;
  phone: string;
}

export interface PendingOrderRow {
  id: number;
  customer_id: number;
  quantity: number;
  order_date: string;
  customer_name: string;
  phone: string;
  address: string;
  latitude: string | number;
  longitude: string | number;
}

export interface CalculatePlanBody {
  delivery_date?: string;
  rider_count?: number;
  departure_time?: string;
  deadline_time?: string;
  speed_kmh?: number;
  service_minutes?: number;
}

export interface PlanDetail {
  id: number;
  delivery_date: string;
  departure_time: string;
  deadline_time: string;
  rider_count: number;
  total_orders: number;
  total_boxes: number;
  distance_km: number;
  delivery_cost: number;
  revenue: number;
  food_cost: number;
  profit: number;
  last_arrival_time: string;
  all_on_time: number | boolean;
  routes?: RouteDetail[];
}

export interface RouteDetail {
  id: number;
  plan_id: number;
  rider_id: number;
  rider_number: number;
  rider_name: string;
  rider_phone: string;
  color: string;
  total_boxes: number;
  distance_km: number;
  duration_minutes: number;
  delivery_cost: number;
  geometry?: unknown;
  navigation_url: string;
  job_code?: string | null;
  stops?: StopDetail[];
}

export interface StopDetail {
  id?: number;
  route_id?: number;
  order_id: number;
  stop_sequence: number;
  customer_name: string;
  phone: string;
  address: string;
  latitude: number | string;
  longitude: number | string;
  quantity: number;
  arrival_time: string;
  distance_from_previous_km: number;
}

export const ROUTE_COLORS: string[] = [
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#84cc16',
  '#6366f1',
];
