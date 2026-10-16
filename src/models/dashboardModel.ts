export interface DashboardPlanModel {
  plan_id: number;
  total_orders: number;
  total_boxes: number;
  rider_count: number;
  revenue: number;
  food_cost: number;
  delivery_cost: number;
  total_cost: number;
  profit: number;
  last_arrival_time: string;
  all_on_time: boolean;
}

export interface DashboardModel {
  delivery_date: string;
  total_orders: number;
  total_boxes: number;
  rider_count: number;
  pending_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  plan_matches_orders: boolean;
  latest_plan: DashboardPlanModel | null;
}
