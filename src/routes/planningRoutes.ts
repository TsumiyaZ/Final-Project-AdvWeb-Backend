import express from "express";
import {
  calculatePlan,
  getPendingOrders,
  getRiders,
  getShop,
} from "../controllers/routePlanningController";

export const router = express.Router();

router.get("/pending", getPendingOrders);
router.get("/riders", getRiders);
router.get("/shop", getShop);
router.post("/calculate", calculatePlan);
