import { Router } from 'express';
import { register, login, getProfile } from '../controllers/auth.controller.js';
import { authenticate } from '../middlewares/auth.js';
const router = Router();
// Rutas públicas
router.post('/register', register);
router.post('/login', login);
// Ruta protegida (requiere token)
router.get('/profile', authenticate, getProfile);
export default router;
