import express from "express";
import {
  calculatePlan,
  getPendingOrders,
  getPlanById,
  getPlans,
  getRiders,
  getShop,
} from "../controllers/routePlanningController";

//โค้ดไฟล์นี้ไม่เกี่ยวกับงาน HW5 Backend นะครับ backend มีเเค่ Customer, order
export const router = express.Router();

// ต้องวาง /calculate และ path คงที่ก่อน /:id เพื่อกันชนกัน
router.post("/calculate", calculatePlan);
router.get("/plans", getPlans);
router.get("/plans/:id", getPlanById);
router.get("/pending", getPendingOrders);
router.get("/riders", getRiders);
router.get("/shop", getShop);
