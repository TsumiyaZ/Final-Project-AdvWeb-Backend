export interface OrderModel {
    id:          number;
    customer_id: number;
    quantity:    number;
    order_date:  string;
    status:      string;
    is_demo:     number;
}

export interface CreateOrderModel {
    customer_id: number;
    quantity: number;
    order_date: string;
}

export interface UpdateOrderModel {
    customer_id?: number;
    quantity?: number;
    order_date?: string;
    status?: string;
}

export interface PendingOrderModel {
  id: number;
  customer_id: number;
  quantity: number;
  customer_name: string;
  phone?: string;
  address?: string;
  latitude: string | number;
  longitude: string | number;
}
