export interface OrderModel {
    id:          number;
    customer_id: number;
    quantity:    number;
    order_date:  string;
    status:      string;
    is_demo:     number;
    created_at:  string;
    updated_at:  string;
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
