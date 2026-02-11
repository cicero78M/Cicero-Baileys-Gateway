import { Router } from "express";
import { getInstagramPostsFiltered } from "../controller/instaController.js";

const router = Router();

router.get("/posts", getInstagramPostsFiltered);

export default router;
