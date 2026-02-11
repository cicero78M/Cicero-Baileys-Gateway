import { Router } from "express";
import { getAggregator, refreshAggregator } from "../controller/aggregatorController.js";

const router = Router();

router.get("/", getAggregator);
router.post("/refresh", refreshAggregator);

export default router;
