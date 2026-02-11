// src/routes/instaRoutes.js
import { Router } from "express";
import {
  getInstaRekapLikes,
  getInstaPosts,
  getInstaPostsKhusus,
  getRapidInstagramPosts,
  getRapidInstagramProfile,
  getRapidInstagramInfo,
  getInstagramProfile,
  getInstagramUser,
  getRapidInstagramPostsStore,
  getRapidInstagramPostsByMonth,
} from "../controller/instaController.js";

const router = Router();
router.get("/rekap-likes", getInstaRekapLikes);
router.get("/posts", getInstaPosts);
router.get("/posts-khusus", getInstaPostsKhusus);
router.get("/rapid-posts", getRapidInstagramPosts);
router.get("/rapid-posts-month", getRapidInstagramPostsByMonth);
router.get("/rapid-posts-store", getRapidInstagramPostsStore);
router.get("/rapid-profile", getRapidInstagramProfile);
router.get("/rapid-info", getRapidInstagramInfo);
router.get("/profile", getInstagramProfile);
router.get("/instagram-user", getInstagramUser);

export default router;
