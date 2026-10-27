import express from "express";
import {
  getJobByCode,
  getJobs,
  markStopDelivered,
} from "../controllers/jobController";

export const router = express.Router();

router.get("/", getJobs);
router.post("/:code/stops/:orderId/complete", markStopDelivered);
router.get("/:code", getJobByCode);
