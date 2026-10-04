import express from "express";
import { getJobByCode, getJobs } from "../controllers/jobController";

export const router = express.Router();

router.get("/", getJobs);
router.get("/:code", getJobByCode);
