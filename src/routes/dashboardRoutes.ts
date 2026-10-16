import express from "express";
import { getDashboard } from "../controllers/dashboardController";

export const router = express.Router();

router.get("/", getDashboard);
