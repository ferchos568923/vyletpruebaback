import { Router } from 'express';
import { getGoogleMapsKey } from '../controllers/config.controller.js';

const router = Router();

router.get('/config/google-maps-key', getGoogleMapsKey);

export default router;
