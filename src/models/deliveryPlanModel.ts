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

