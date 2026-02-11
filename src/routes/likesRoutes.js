// src/routes/likesRoutes.js
import { Router } from "express";
import { getDitbinmasLikes } from "../controller/likesController.js";

const router = Router();

function logLikesRequest(req, res, next) {
  console.log("\x1b[33m%s\x1b[0m", "GET /api/likes/instagram");
  next();
}

router.get("/instagram", logLikesRequest, getDitbinmasLikes);

export default router;
