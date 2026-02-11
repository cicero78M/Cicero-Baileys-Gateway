import express from 'express';
import * as userController from '../controller/userController.js';

const router = express.Router();

// === Legacy (JSON) CRUD
router.get('/', userController.getAllUsers);
router.get('/list', userController.getUserList);

// Rute yang lebih spesifik harus didefinisikan sebelum ":id"
router.get('/by-client/:client_id', userController.getUsersByClient);
router.get('/by-client-full/:client_id', userController.getUsersByClientFull);
router.post('/create', userController.createUser);
router.put(
  '/:id/wa-notification',
  userController.updateWaNotificationPreference
);
router.put('/:id/roles', userController.updateUserRoles);
router.get('/:id', userController.getUserById);
router.post('/', userController.createUser);
router.put('/:id', userController.updateUser);
router.delete('/:id', userController.deleteUser);


export default router;
