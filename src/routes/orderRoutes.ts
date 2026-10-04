import express from 'express';
import { clearDemoOrders, createOrder, deleteOrderByID, getNearbyOrders, getOrder, getOrderByID, randomOrder, updateOrderByID } from '../controllers/orderController';

export const router = express.Router();

router.get('/', getOrder);
router.get('/nearby', getNearbyOrders);
router.get('/:id', getOrderByID);
router.put('/:id', updateOrderByID);
router.post('/', createOrder);
router.delete('/demo', clearDemoOrders);
router.delete('/:id', deleteOrderByID);
router.post('/random', randomOrder);
