import express from 'express';
import * as userController from '../controller/userController.js';

const router = express.Router();

router.route('/update').put(userController.updateUserRoleIds).post(userController.updateUserRoleIds);

export default router;
