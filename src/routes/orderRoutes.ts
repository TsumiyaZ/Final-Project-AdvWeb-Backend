import express from 'express';
import { clearDemoOrders, createOrder, deleteOrderByID, getNearbyOrders, getOrder, getOrderByID, randomOrder, updateOrderByID } from '../controllers/orderController';

//โค้ดไฟล์นี้ไม่เกี่ยวกับงาน HW5 Backend นะครับ backend มีเเค่ Customer, order
export const router = express.Router();

router.get('/', getOrder);
router.get('/nearby', getNearbyOrders);
router.get('/:id', getOrderByID);
router.put('/:id', updateOrderByID);
router.post('/', createOrder);
router.delete('/demo', clearDemoOrders);
router.delete('/:id', deleteOrderByID);
router.post('/random', randomOrder);
