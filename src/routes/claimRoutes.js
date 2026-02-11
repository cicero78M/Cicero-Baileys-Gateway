import express from 'express';
import {
  requestOtp,
  verifyOtpController,
  getUserData,
  updateUserData,
  validateEmail,
} from '../controller/claimController.js';

const router = express.Router();

// Routes for OTP flow via email
router.post('/request-otp', requestOtp); // body: { nrp, email }
router.post('/verify-otp', verifyOtpController); // body: { nrp, email, otp }
router.post('/user-data', getUserData); // body: { nrp, email }
router.put('/update', updateUserData); // body: { nrp, email, ... }
router.post('/validate-email', validateEmail); // body: { email }

export default router;
