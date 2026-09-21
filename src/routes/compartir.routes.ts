import { Router } from 'express';
import * as compartir from '../controllers/compartir.controller.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.post('/compartir-contenido', authenticate, compartir.compartirContenido);

export default router;
