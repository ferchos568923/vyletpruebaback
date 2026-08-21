import { Router } from 'express';
import * as favoritoController from '../controllers/favorito.controller.js';
import { authenticate } from '../middlewares/auth.js';

const router = Router();

router.get('/mis-favoritos', authenticate, favoritoController.listarMios);
router.get('/sucursales/:id/favorito', authenticate, favoritoController.estado);
router.post('/sucursales/:id/favorito', authenticate, favoritoController.agregar);
router.delete('/sucursales/:id/favorito', authenticate, favoritoController.quitar);

export default router;